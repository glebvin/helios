import { OfflineQueueError, openOfflineQueue, type EventPayload, type EvidenceInput, type OfflineQueue, type QueueState } from "../../../packages/offline/src/index.js";
import type { Session } from "./api";

type Live = { token: string; tenantId: string; actorUserId: string; generation: number };

let generationCounter = 0;
let live: Live | null = null;
let queue: OfflineQueue | null = null;
let closing = false;
let opening: Promise<void> | null = null;
let flushing: Promise<void> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let onRemote: (() => void) | null = null;
const listeners = new Set<() => void>();

function scopeOf(value: Live) {
  return JSON.stringify([`${location.origin}/api/v1`, value.tenantId.toLowerCase(), value.actorUserId.toLowerCase()]);
}

function notify() {
  for (const listener of listeners) listener();
}

const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("helios-managed-offline-auth");
channel?.addEventListener("message", (event) => {
  if (closing || !live || event.data?.scope !== scopeOf(live)) return;
  stopRetry();
  queue?.close();
  queue = null;
  live = null;
  ++generationCounter;
  notify();
  onRemote?.();
});

export function watchDelivery(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bindRemoteClose(listener: () => void) {
  onRemote = listener;
  return () => { if (onRemote === listener) onRemote = null; };
}

function stopRetry() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

export function openDelivery(session: Session): Promise<void> {
  if ((queue || opening) && live?.token === session.token && live.tenantId === session.tenantId && live.actorUserId === session.userId) return opening ?? Promise.resolve();
  // Rebinding a view is not logout: do not revoke the same actor's other tabs.
  stopRetry();
  queue?.close();
  queue = null;
  flushing = null;
  const generation = ++generationCounter;
  const next: Live = { token: session.token, tenantId: session.tenantId, actorUserId: session.userId, generation };
  live = next;
  const pending = (async () => {
    const opened = await openOfflineQueue({
      audience: `${location.origin}/api/v1`, tenantId: session.tenantId, actorUserId: session.userId,
      getSession: () => (live?.generation === generation ? live : null),
    });
    if (live?.generation !== generation) { opened.close(); return; }
    queue = opened;
    notify();
    void flushDelivery().catch(() => {});
  })();
  opening = pending;
  void pending.finally(() => { if (opening === pending) opening = null; }).catch(() => {});
  return pending;
}

export async function closeDelivery() {
  closing = true;
  stopRetry();
  ++generationCounter;
  const previous = queue;
  queue = null;
  live = null;
  opening = null;
  flushing = null;
  try { await previous?.closeSession(); }
  finally { closing = false; notify(); }
}

function rowStamp(rows: Awaited<ReturnType<OfflineQueue["list"]>>) {
  return JSON.stringify(rows.map(row => [row.id, row.stage, row.state, row.attemptCount, row.lastError]));
}

export function flushDelivery(): Promise<void> {
  if (flushing) return flushing;
  const active = queue;
  if (!active) return Promise.resolve();
  const pending = (async () => {
    stopRetry();
    const before = await active.list();
    // The browser's online flag is only a hint; the transport remains authoritative.
    if (navigator.onLine) await active.flush();
    if (queue !== active) return;
    const after = await active.list();
    if (rowStamp(before) !== rowStamp(after)) notify();
    const retryable = after.filter(row => row.state === "pending" || row.state === "retry_wait");
    if (retryable.length && navigator.onLine) {
      const due = Math.min(...retryable.map(row => row.nextAttemptAt ?? Date.now()));
      retryTimer = setTimeout(() => { void flushDelivery().catch(() => {}); }, Math.max(1000, due - Date.now()));
    }
  })();
  flushing = pending;
  void pending.finally(() => { if (flushing === pending) flushing = null; }).catch(() => {});
  return pending;
}

export async function retryDelivery() {
  const active = queue;
  if (!active) return;
  for (const row of await active.list()) {
    if (row.state === "retry_wait" || (row.state === "blocked" && row.lastError === "blocked_retry_exhausted")) await active.retry(row.id);
  }
  notify();
  await flushDelivery();
}

if (typeof window !== "undefined") {
  const resume = () => { void flushDelivery().catch(() => {}); };
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
}

export async function deliveryPredecessor(employeeId: string, projectId: string, expectedVersion: number) {
  const rows = await queue?.list() ?? [];
  return rows.filter(row => "event" in row && row.employeeId === employeeId && row.projectId === projectId && row.event.expectedVersion < expectedVersion).sort((a, b) => ("event" in b ? b.event.expectedVersion : 0) - ("event" in a ? a.event.expectedVersion : 0))[0]?.requestId;
}

export async function sendEvent(event: EventPayload): Promise<{ state: QueueState; code: string | null }> {
  const active = queue;
  if (!active) throw new OfflineQueueError("auth_required");
  const saved = await active.enqueueEvent(event);
  notify();
  await flushDelivery();
  const row = await active.get(saved.id);
  notify();
  if (!row || !("event" in row)) return { state: "pending", code: null };
  return { state: row.state, code: row.lastError };
}

export async function deliveryNote(): Promise<string> {
  const active = queue;
  if (!active) return "";
  const rows = await active.list();
  const open = rows.filter((row) => row.state !== "synced");
  if (open.some((row) => row.state === "pending" || row.state === "sending" || row.state === "retry_wait")) return "Ожидает отправки";
  if (open.length) return "Сервер не принял команду. Это не сохранено.";
  return "";
}

export function deliveryError(error: unknown) {
  if (!(error instanceof OfflineQueueError)) return null;
  return "Команда не записана на этом устройстве.";
}

export async function reportDependency(reportId: string) {
  const active = queue;
  if (!active) return null;
  const wanted = reportId.toLowerCase();
  for (const row of await active.list()) {
    if ("event" in row && row.event.kind === "submit_volume" && row.event.reportId.toLowerCase() === wanted) return row.event.requestId;
  }
  return null;
}

export async function reportFiles(reportId: string) {
  const active = queue;
  if (!active) return [];
  const wanted = reportId.toLowerCase();
  const rows = await active.list();
  return rows.flatMap((row) => "event" in row || row.target.kind !== "final_report" || row.target.reportId.toLowerCase() !== wanted ? [] : [{
    id: row.id, filename: row.reserve.filename, stage: row.stage, state: row.state, code: row.lastError,
  }]);
}

export async function sendEvidence(input: EvidenceInput) {
  const active = queue;
  if (!active) throw new OfflineQueueError("auth_required");
  // Confirmed files no longer need their Blob on this device. Keep identity
  // tombstones so an identical retry still resolves to the original server file.
  const acknowledged = (await active.list()).filter(row => !("event" in row) && row.state === "synced").map(row => row.id);
  if (acknowledged.length) {
    try { await active.cleanupAcknowledged(acknowledged); }
    catch (error) { if (!(error instanceof OfflineQueueError) || error.code !== "cleanup_requires_acknowledgement") throw error; }
  }
  const saved = await active.enqueueEvidence(input);
  notify();
  await flushDelivery();
  const row = await active.get(saved.id) ?? saved;
  notify();
  if (!row || "event" in row) return { state: "pending" as QueueState, stage: "queued" as const, code: null as string | null };
  return { state: row.state, stage: row.stage, code: row.lastError };
}
