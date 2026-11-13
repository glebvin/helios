import { mkdir, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const minFreeBytes = 64 * 1024 * 1024;
const workerStaleMs = 30_000;

export type ReadyReport = {
  ok: boolean;
  ms: number;
  checks: {
    db: "ok" | "down";
    evidence: "ok" | "missing" | "full";
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
    return disk.bavail * disk.bsize < minFreeBytes ? "full" : "ok";
  } catch {
    return "missing";
  }
}

export async function workerCheck(file: string | undefined, now: number): Promise<ReadyReport["checks"]["worker"]> {
  if (!file) return "not_configured";
  if (!isAbsolute(file)) return "stale";
  try {
    const seen = await stat(file);
    return now - seen.mtimeMs > workerStaleMs ? "stale" : "ok";
  } catch {
    return "stale";
  }
}

export async function writeWorkerHeartbeat(file: string): Promise<void> {
  if (!isAbsolute(file)) throw new Error("heartbeat_path");
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, "ok\n", { mode: 0o600 });
}

export async function collectReady(deps: {
  db: () => Promise<unknown>;
  evidence: () => Promise<ReadyReport["checks"]["evidence"]>;
  queue: () => Promise<boolean>;
  worker: () => Promise<ReadyReport["checks"]["worker"]>;
  log?: (line: string) => void;
}): Promise<ReadyReport> {
  const started = Date.now();
  const checks: ReadyReport["checks"] = {
    db: "down",
    evidence: "missing",
    queue: "down",
    worker: "not_configured",
    backup: "not_configured",
  };
  try {
    await deps.db();
    checks.db = "ok";
  } catch {
    checks.db = "down";
  }
  try {
    checks.evidence = await deps.evidence();
  } catch {
    checks.evidence = "missing";
  }
  try {
    checks.queue = (await deps.queue()) ? "ok" : "down";
  } catch {
    checks.queue = "down";
  }
  try {
    checks.worker = await deps.worker();
  } catch {
    checks.worker = "stale";
  }
  const failed = [
    checks.db === "down" ? "db" : "",
    checks.evidence === "ok" ? "" : "evidence",
    checks.queue === "down" ? "queue" : "",
    checks.worker === "stale" ? "worker" : "",
  ].filter(Boolean);
  if (failed.length > 0) (deps.log ?? ((line) => console.error(line)))(`ready ${failed.join(",")}`);
  return { ok: failed.length === 0, ms: Date.now() - started, checks };
}
