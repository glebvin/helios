export type VolumeShiftRow = {
  id: string;
  employeeId: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  endEvent?: { requestId: string } | null;
};

export type VolumeSegment = {
  shiftId: string;
  employeeId: string;
  projectId: string;
  mode: string;
  taskId: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type VolumeReport = {
  reportId: string;
  shiftId: string;
  taskId: string;
  employeeId: string;
  projectId: string;
  submittedQuantity: string;
  unit: string;
  provisional: boolean;
  acceptedQuantity: string | null;
};

export type ClosedShift = { id: string; endedAt: string; endRequestId: string };

const quantityPattern = /^(?!0+(?:\.0+)?$)\d{1,11}(?:\.\d{1,3})?$/;

export function canWriteVolume(role: string) {
  return role === "worker" || role === "director";
}

export function volumeNeedsReason(role: string) {
  return role === "director";
}

export function volumeQuantity(value: string) {
  const text = value.trim().replace(",", ".");
  return quantityPattern.test(text) ? text : "";
}

export function volumeProblem(online: boolean, quantity: string, reason: string, needsReason: boolean) {
  void online;
  if (!volumeQuantity(quantity)) return "Укажите объём больше нуля, до трёх знаков после запятой.";
  if (needsReason && !reason.trim()) return "Напишите, почему объём записывается за работника.";
  return "";
}

export function reportListPath(projectId: string, employeeId = "") {
  const query = new URLSearchParams({ limit: "100", offset: "0" });
  if (employeeId) query.set("employeeId", employeeId);
  return `/projects/${projectId}/execution/reports?${query}`;
}

export function civilDay(iso: string, timezone: string) {
  const date = new Date(iso);
  if (!timezone || Number.isNaN(date.valueOf())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : "";
}

export function volumeShift(shifts: VolumeShiftRow[], total: number, employeeId: string, projectId: string, day: string, timezone: string) {
  if (total !== shifts.length || shifts.some((shift) => shift.employeeId !== employeeId || shift.projectId !== projectId)) return { kind: "incomplete" as const };
  const closed = shifts.filter((shift) => shift.endedAt && civilDay(shift.startedAt, timezone) === day);
  if (closed.length === 0) return { kind: "none" as const };
  if (closed.length > 1) return { kind: "many" as const, count: closed.length };
  const shift = closed[0];
  return { kind: "one" as const, shift: { id: shift.id, endedAt: shift.endedAt ?? "", endRequestId: shift.endEvent?.requestId ?? "" } };
}

export function positiveWork(segments: VolumeSegment[], total: number, shiftId: string, employeeId: string, projectId: string, taskId: string) {
  if (total !== segments.length || segments.some((row) => row.shiftId !== shiftId || row.employeeId !== employeeId || row.projectId !== projectId)) return "incomplete" as const;
  const worked = segments.some((row) => row.mode === "work" && row.taskId === taskId && row.endedAt !== null && Date.parse(row.endedAt) > Date.parse(row.startedAt));
  return worked ? "yes" as const : "no" as const;
}

export function volumeLines(reports: VolumeReport[], total: number) {
  if (total !== reports.length || reports.some((row) => row.provisional !== true || row.acceptedQuantity !== null)) return null;
  const lines: Record<string, { reportId: string; submittedQuantity: string }[]> = {};
  for (const row of reports) (lines[row.taskId] ??= []).push({ reportId: row.reportId, submittedQuantity: row.submittedQuantity });
  return lines;
}

export function reportsForTask(reports: VolumeReport[], total: number, taskId: string) {
  if (total !== reports.length || reports.some((row) => row.taskId === taskId && (row.provisional !== true || row.acceptedQuantity !== null))) return { kind: "incomplete" as const };
  return { kind: "ready" as const, items: reports.filter((row) => row.taskId === taskId) };
}

export function volumeOccurredAt(now: string, endedAt: string) {
  const end = Date.parse(endedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(end) || !Number.isFinite(current)) return "";
  return new Date(current >= end ? current : end).toISOString();
}

export function volumeEventBody(input: {
  requestId: string;
  employeeId: string;
  projectId: string;
  shiftId: string;
  expectedVersion: number;
  occurredAt: string;
  taskId: string;
  reportId: string;
  submittedQuantity: string;
  previousEventId?: string;
  onBehalfReason?: string;
}) {
  const quantity = volumeQuantity(input.submittedQuantity);
  const event: Record<string, unknown> = {
    kind: "submit_volume",
    requestId: input.requestId,
    employeeId: input.employeeId,
    projectId: input.projectId,
    shiftId: input.shiftId,
    expectedVersion: input.expectedVersion,
    occurredAt: input.occurredAt,
    taskId: input.taskId,
    reportId: input.reportId,
    submittedQuantity: quantity,
  };
  if (input.previousEventId) event.previousEventId = input.previousEventId;
  const reason = input.onBehalfReason?.trim();
  if (reason) event.onBehalfReason = reason;
  return { events: [event] };
}

export type VolumeBatchRow = {
  outcome?: string;
  status?: number;
  code?: string;
  result?: { version?: number; submittedQuantity?: string; provisional?: boolean; acceptedQuantity?: string | null };
};

export function volumeBatchError(row: VolumeBatchRow | undefined, httpStatus: number | null) {
  if (httpStatus === null) return "Нет подтверждения сервера. Повторите в этой форме, не закрывая её.";
  if (httpStatus === 401) return "Сессия закончилась. Войдите снова.";
  if (!row) return "Сервер не вернул результат объёма.";
  if (row.outcome === "success" || row.outcome === "duplicate") {
    const result = row.result;
    if (!result?.version || result.provisional !== true || result.acceptedQuantity !== null || !result.submittedQuantity) return "Сервер не подтвердил, что объём только сообщён.";
    return "";
  }
  const code = row.code ?? "";
  if (code === "stale_version") return "Версия дня на сервере уже другая. Прочитайте день заново.";
  if (code === "final_report_already_submitted") return "По этой смене объём уже сдан. Второй отчёт не создаётся.";
  if (code === "final_report_requires_closed_shift") return "Объём принимается только после закрытой смены.";
  if (code === "report_before_shift_end") return "Время отчёта раньше конца смены. Объём не записан.";
  if (code === "positive_closed_task_work_required") return "В этой смене нет закрытой работы по заданию.";
  if (code === "published_managed_task_required") return "Задание не опубликовано. Объём не записан.";
  if (code === "admission_required") return "Допуск не позволяет сдать объём.";
  if (code === "on_behalf_reason_required") return "Для записи за работника нужна причина.";
  if (code === "role_denied" || row.status === 403) return "Этому входу объём не разрешён.";
  return `Сервер не записал объём${code ? `: ${code}` : ""}.`;
}
