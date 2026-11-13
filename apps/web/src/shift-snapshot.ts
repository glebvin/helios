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
  try { localStorage.setItem(key(snapshot.tenantId, snapshot.userId), JSON.stringify(snapshot)); return true; }
  catch { return false; }
}

export function readShiftSnapshot(tenantId: string, userId: string): ShiftSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key(tenantId, userId)) ?? "null") as ShiftSnapshot | null;
    if (!parsed || parsed.tenantId !== tenantId || parsed.userId !== userId ||
      ![parsed.projectId, parsed.projectName, parsed.employeeId, parsed.day, parsed.fetchedAt].every(value => typeof value === "string" && value.length > 0) ||
      !Number.isFinite(new Date(parsed.fetchedAt).valueOf()) || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.day) ||
      !parsed.reading || parsed.reading.projectId !== parsed.projectId || parsed.reading.employeeId !== parsed.employeeId || parsed.reading.day !== parsed.day ||
      !Number.isSafeInteger(parsed.reading.version) || ![parsed.reading.presenceMs, parsed.reading.workMs, parsed.reading.breakMs, parsed.reading.downtimeMs, parsed.reading.idleMs].every(value => typeof value === "string" && /^\d+$/.test(value)) ||
      !parsed.shifts || !["none", "one", "many", "incomplete"].includes(parsed.shifts.kind) ||
      (parsed.shifts.kind === "one" && (!parsed.shifts.shift || parsed.shifts.shift.projectId !== parsed.projectId || parsed.shifts.shift.employeeId !== parsed.employeeId || typeof parsed.shifts.shift.startedAt !== "string")) ||
      !Array.isArray(parsed.tasks) || parsed.tasks.some(task => !task || typeof task.id !== "string" || typeof task.title !== "string" || typeof task.plannedQuantity !== "string" || typeof task.unit !== "string")) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearShiftSnapshot(tenantId: string, userId: string) {
  try { localStorage.removeItem(key(tenantId, userId)); } catch { /* The session is still closed independently. */ }
}

export function snapshotAge(fetchedAt: string) {
  const date = new Date(fetchedAt);
  if (!Number.isFinite(date.valueOf())) return "";
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
