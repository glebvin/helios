import type { ServerTask } from "./task-read.ts";

export type DayEmployee = {
  id: string;
  fullName: string;
  userId: string | null;
  status: string;
};

export type DayReading = {
  employeeId: string;
  projectId: string;
  day: string;
  timezone: string;
  asOf: string;
  provisional: boolean;
  presenceMs: string;
  workMs: string;
  breakMs: string;
  downtimeMs: string;
  idleMs: string;
  hasOpenIntervals: boolean;
  version: number;
};

export type DayShift = {
  id: string;
  projectId: string;
  employeeId: string;
  startedAt: string;
  endedAt: string | null;
  startEvent?: { requestId: string } | null;
};

export type ShiftReading =
  | { kind: "incomplete" }
  | { kind: "none" }
  | { kind: "one"; shift: DayShift }
  | { kind: "many"; count: number };

export function employeeListPath(projectId: string) {
  return `/employees?projectId=${encodeURIComponent(projectId)}&limit=100`;
}

export function dayReadPath(projectId: string, employeeId: string, day: string) {
  return `/projects/${projectId}/execution/employees/${employeeId}/day?${new URLSearchParams({ day })}`;
}

export function shiftListPath(projectId: string, employeeId: string) {
  return `/projects/${projectId}/execution/shifts?${new URLSearchParams({ employeeId, limit: "100", offset: "0" })}`;
}

export function ownEmployee(people: DayEmployee[], userId: string) {
  const matches = people.filter((item) => item.userId === userId && item.status === "active");
  return matches.length === 1 ? matches[0] : null;
}

export function visibleWorkerTasks(tasks: ServerTask[], employeeId: string) {
  return tasks.filter((task) => task.assigneeEmployeeId === employeeId && (task.status === "published" || task.workflowKind === "legacy"));
}

export function shiftReading(shifts: DayShift[], total: number, employeeId: string, projectId: string): ShiftReading {
  if (total !== shifts.length || shifts.some((shift) => shift.employeeId !== employeeId || shift.projectId !== projectId)) return { kind: "incomplete" };
  const open = shifts.filter((shift) => shift.endedAt === null);
  if (open.length === 0) return { kind: "none" };
  if (open.length === 1) return { kind: "one", shift: open[0] };
  return { kind: "many", count: open.length };
}

export function durationLabel(ms: string) {
  if (!/^\d+$/.test(ms)) return "";
  const value = Number(ms);
  if (!Number.isSafeInteger(value)) return "";
  const minutes = Math.floor(value / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  return `${hours} ч ${rest} мин`;
}

export function clockLabel(iso: string, timezone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(date);
}

export function dayReadError(status: number | null, source: "people" | "day" | "shifts" | "tasks") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этому входу день недоступен.";
  if (status === 404 && source === "day") return "Назначение на этот объект недоступно.";
  if (status === 404) return "Объект этому входу недоступен.";
  if (status === 400) return "Сервер не принял день или объект.";
  return "Нет подтверждения сервера. Повторите чтение.";
}
