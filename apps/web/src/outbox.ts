import { eventsForSync, type ScopedEvent } from "@helios/domain";

export type OutboxEvent = ScopedEvent & {
  eventId: string;
  kind: "shift_start" | "shift_end" | "submit_volume";
  occurredAt: string;
  payload: { taskId: string; employeeId?: string; quantity?: string };
  status: "pending" | "sent";
};

const keyOf = (tenantId: string, userId: string) => `helios.outbox.${tenantId}.${userId}`;

export function readOutbox(tenantId: string, userId: string): OutboxEvent[] {
  const raw = localStorage.getItem(keyOf(tenantId, userId));
  return raw ? (JSON.parse(raw) as OutboxEvent[]) : [];
}

export function writeOutbox(tenantId: string, userId: string, items: OutboxEvent[]) {
  localStorage.setItem(keyOf(tenantId, userId), JSON.stringify(items));
}

export function enqueue(event: OutboxEvent) {
  const items = readOutbox(event.tenantId, event.userId);
  writeOutbox(event.tenantId, event.userId, [...items, event]);
}

export function pendingFor(tenantId: string, userId: string) {
  return eventsForSync(readOutbox(tenantId, userId), { tenantId, userId });
}
