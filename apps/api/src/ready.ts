import { access, mkdir, stat, statfs, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const minFreeBytes = 64 * 1024 * 1024;
const workerStaleMs = 30_000;

export type ReadyReport = {
  ok: boolean;
  ms: number;
  checks: {
    db: "ok" | "down";
    evidence: "ok" | "missing" | "full" | "unwritable";
    queue: "ok" | "down";
    worker: "ok" | "stale" | "not_configured";
    backup: "not_configured";
  };
};

export function evidenceRoot(): string {
  const configured = process.env.HELIOS_EVIDENCE_ROOT;
  if (configured && !isAbsolute(configured)) throw new Error("HELIOS_EVIDENCE_ROOT must be absolute");
  return configured ?? resolve(fileURLToPath(new URL("../../../.data/evidence-54339", import.meta.url)));
}

export async function evidenceCheck(
  root: string,
  space: (path: string) => Promise<{ bavail: number; bsize: number }> = statfs,
): Promise<ReadyReport["checks"]["evidence"]> {
  try {
    if (!(await stat(root)).isDirectory()) return "missing";
    const disk = await space(root);
    if (disk.bavail * disk.bsize < minFreeBytes) return "full";
    try { await access(root, constants.W_OK); } catch { return "unwritable"; }
    return "ok";
  } catch {
    return "missing";
  }
}

export async function workerCheck(file: string | undefined, now: number): Promise<ReadyReport["checks"]["worker"]> {
  if (!file) return "not_configured";
  if (!isAbsolute(file)) return "stale";
  try {
    const seen = await stat(file);
    const age = now - seen.mtimeMs;
    return !seen.isFile() || age < -5000 || age > workerStaleMs ? "stale" : "ok";
  } catch {
    return "stale";
  }
}

export async function writeWorkerHeartbeat(file: string): Promise<void> {
  if (!isAbsolute(file)) throw new Error("heartbeat_path");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, "ok\n", { mode: 0o600 });
}

export type ReadyDependencies = {
  db: () => Promise<unknown>;
  evidence: () => Promise<ReadyReport["checks"]["evidence"]>;
  queue: () => Promise<boolean>;
  worker: () => Promise<ReadyReport["checks"]["worker"]>;
  log?: (line: string) => void;
  requireWorker?: boolean;
};

function bounded<T>(run: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("probe_timeout")), timeoutMs); });
  return Promise.race([Promise.resolve().then(run), deadline]).finally(() => clearTimeout(timer));
}

function failures(checks: ReadyReport["checks"], requireWorker = false): string[] {
  return [checks.db === "down" ? "db" : "", checks.evidence === "ok" ? "" : "evidence",
    checks.queue === "down" ? "queue" : "", checks.worker === "stale" || (requireWorker && checks.worker === "not_configured") ? "worker" : ""].filter(Boolean);
}

export async function collectReady(deps: ReadyDependencies, timeoutMs = 2000): Promise<ReadyReport> {
  const started = Date.now();
  const [db, evidence, queue, worker] = await Promise.all([
    bounded(deps.db, timeoutMs).then(() => "ok" as const, () => "down" as const),
    bounded(deps.evidence, timeoutMs).catch(() => "missing" as const),
    bounded(deps.queue, timeoutMs).then(ok => ok ? "ok" as const : "down" as const, () => "down" as const),
    bounded(deps.worker, timeoutMs).catch(() => "stale" as const),
  ]);
  const checks: ReadyReport["checks"] = {db, evidence, queue, worker, backup: "not_configured"};
  const failed = failures(checks, deps.requireWorker);
  if (failed.length) (deps.log ?? console.error)(`ready ${failed.join(",")}`);
  return {ok: failed.length === 0, ms: Date.now() - started, checks};
}

// One shared observation per process, at most once per five seconds. Public polling
// cannot fill the business pool or produce a log line for every request.
export function cachedReadiness(deps: ReadyDependencies, ttlMs = 5000, timeoutMs = 2000) {
  let cached: ReadyReport | null = null, expires = 0, pending: Promise<ReadyReport> | null = null;
  let previous: string | null = null;
  return (): Promise<ReadyReport> => {
    if (cached && Date.now() < expires) return Promise.resolve(cached);
    if (pending) return pending;
    pending = collectReady({...deps, log: () => {}}, timeoutMs).then(report => {
      const state = failures(report.checks, deps.requireWorker).join(",");
      if (state !== previous && (state || previous)) (deps.log ?? console.error)(state ? `ready ${state}` : "ready recovered");
      previous = state; cached = report; expires = Date.now() + ttlMs;
      return report;
    }).finally(() => { pending = null; });
    return pending;
  };
}

// Start only after boss.work registered the consumer. A failed worker-side DB/queue
// check leaves the last timestamp unchanged, so API can detect a live but stranded worker.
export function startWorkerHeartbeat(file: string, check: () => Promise<unknown>, intervalMs = 10000, log = console.error) {
  if (!isAbsolute(file)) throw new Error("heartbeat_path");
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  let failed = false;
  const beat = async () => {
    try {
      await check();
      if (!stopped) await writeWorkerHeartbeat(file);
      if (failed && !stopped) log("worker_heartbeat recovered");
      failed = false;
    } catch {
      if (!failed && !stopped) log("worker_heartbeat");
      failed = true;
    } finally {
      if (!stopped) { timer = setTimeout(beat, intervalMs); timer.unref(); }
    }
  };
  void beat();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
