import type { Desk } from "./api";

export type Lane = "assigned" | "shift" | "submitted" | "accepted";

export function amount(value: string) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export function todayKey() {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function laneOf(taskId: string, data: Desk): Lane {
  const report = data.reports.find((item) => item.task_id === taskId);
  if (report?.accepted_quantity) return "accepted";
  if (report) return "submitted";
  if (data.shifts.some((shift) => shift.task_id === taskId && shift.status === "open")) return "shift";
  return "assigned";
}

export function dayTasks(data: Desk) {
  const key = todayKey();
  return data.tasks.filter((task) => String(task.work_date).slice(0, 10) === key);
}

export function personName(data: Desk, employeeId: string) {
  return data.employees.find((item) => item.id === employeeId)?.full_name ?? "Без исполнителя";
}

export function progress(task: { planned_quantity: string }, report?: { submitted_quantity: string; accepted_quantity: string | null }) {
  const planned = Number(task.planned_quantity) || 0;
  const done = Number(report?.accepted_quantity ?? report?.submitted_quantity ?? 0);
  if (planned <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / planned) * 100)));
}

export function statusLabel(lane: Lane) {
  if (lane === "shift") return "В работе";
  if (lane === "submitted") return "Ждёт приёмки";
  if (lane === "accepted") return "Принято";
  return "Назначено";
}

export function elapsed(startedAt?: string | null, now = Date.now()) {
  if (!startedAt) return "";
  const ms = now - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return `${hours} ч ${minutes} мин`;
}

export function clock(iso?: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
