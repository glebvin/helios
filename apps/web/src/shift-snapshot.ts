import type { ServerTask } from "./task-read";
import type { DayReading, ShiftReading } from "./worker-day";

export type ShiftSnapshot = {
  tenantId: string;
  userId: string;
  projectId: string;
  projectName: string;
  day: string;
  employeeId: string;
  reading: DayReading;
  shifts: ShiftReading;
  tasks: ServerTask[];
  fetchedAt: string;
};

function key(tenantId: string, userId: string) {
  return `helios.shift-snapshot:${tenantId.toLowerCase()}:${userId.toLowerCase()}`;
}

export function saveShiftSnapshot(snapshot: ShiftSnapshot) {
  localStorage.setItem(key(snapshot.tenantId, snapshot.userId), JSON.stringify(snapshot));
}

export function readShiftSnapshot(tenantId: string, userId: string): ShiftSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(tenantId, userId)) ?? "null") as ShiftSnapshot | null;
    if (!parsed || parsed.tenantId !== tenantId || parsed.userId !== userId || parsed.projectId === "" || parsed.fetchedAt === "") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearShiftSnapshot(tenantId: string, userId: string) {
  localStorage.removeItem(key(tenantId, userId));
}

export function snapshotAge(fetchedAt: string) {
  const date = new Date(fetchedAt);
  if (!Number.isFinite(date.valueOf())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
