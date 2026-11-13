import { OfflineQueueError, openOfflineQueue, type EventPayload, type OfflineQueue, type QueueState } from "../../../packages/offline/src/index.js";
import type { Session } from "./api";

type Live = { token: string; tenantId: string; actorUserId: string; generation: number };

let generationCounter = 0;
let live: Live | null = null;
let queue: OfflineQueue | null = null;
let closing = false;
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
  queue = null;
  live = null;
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

export async function openDelivery(session: Session) {
  if (queue && live?.token === session.token && live.tenantId === session.tenantId && live.actorUserId === session.userId) return;
  await closeDelivery();
  const generation = ++generationCounter;
  const next: Live = { token: session.token, tenantId: session.tenantId, actorUserId: session.userId, generation };
  live = next;
  queue = await openOfflineQueue({
    audience: `${location.origin}/api/v1`,
    tenantId: session.tenantId,
    actorUserId: session.userId,
    getSession: () => (live?.generation === generation ? live : null),
  });
  notify();
}

export async function closeDelivery() {
  closing = true;
  const previous = queue;
  queue = null;
  live = null;
  try { await previous?.closeSession(); }
  finally { closing = false; notify(); }
}

export async function flushDelivery() {
  const active = queue;
  if (!active) return;
  await active.flush();
}

export async function sendEvent(event: EventPayload): Promise<{ state: QueueState; code: string | null }> {
  const active = queue;
  if (!active) throw new OfflineQueueError("auth_required");
  const saved = await active.enqueueEvent(event);
  await active.flush();
  const row = await active.get(saved.id);
  notify();
  if (!row || !("event" in row)) return { state: "pending", code: null };
  return { state: row.state, code: row.lastError };
}

export async function deliveryNote(): Promise<string> {
  const active = queue;
  if (!active) return "";
  const rows = await active.list();
  const open = rows.filter((row) => "event" in row && row.state !== "synced");
  if (open.some((row) => row.state === "pending" || row.state === "sending" || row.state === "retry_wait")) return "Ожидает отправки";
  if (open.length) return "Сервер не принял команду. Это не сохранено.";
  return "";
}

export function deliveryError(error: unknown) {
  if (!(error instanceof OfflineQueueError)) return null;
  return "Команда не записана на этом устройстве.";
}
