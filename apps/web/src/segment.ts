export type SegmentMode = "idle" | "work" | "break" | "downtime";
export type DowntimeReason = "materials" | "equipment" | "front" | "safety" | "weather" | "other";

export type SegmentRow = {
  id: string;
  shiftId: string;
  employeeId: string;
  projectId: string;
  mode: string;
  taskId: string | null;
  reasonCode: string | null;
  comment: string | null;
  startedAt: string;
  endedAt: string | null;
};

export type OpenSegment =
  | { kind: "incomplete" }
  | { kind: "none" }
  | { kind: "many" }
  | { kind: "one"; segment: SegmentRow };

export const downtimeReasons: { value: DowntimeReason; label: string }[] = [
  { value: "materials", label: "Материалы" },
  { value: "equipment", label: "Техника" },
  { value: "front", label: "Фронт" },
  { value: "safety", label: "Безопасность" },
  { value: "weather", label: "Погода" },
  { value: "other", label: "Другое" },
];

const labels: Record<string, string> = { idle: "Ожидание", work: "Работа", break: "Перерыв", downtime: "Простой" };

export function segmentListPath(projectId: string, shiftId: string) {
  return `/projects/${projectId}/execution/shifts/${shiftId}/segments?${new URLSearchParams({ limit: "100", offset: "0" })}`;
}

export function segmentLabel(mode: string) {
  return labels[mode] ?? mode;
}

export function openSegment(items: SegmentRow[], total: number, shiftId: string, employeeId: string, projectId: string): OpenSegment {
  if (total !== items.length || items.some((item) => item.shiftId !== shiftId || item.employeeId !== employeeId || item.projectId !== projectId)) return { kind: "incomplete" };
  const open = items.filter((item) => item.endedAt === null);
  if (open.length === 0) return { kind: "none" };
  if (open.length > 1) return { kind: "many" };
  return { kind: "one", segment: open[0] };
}

export function segmentActions(mode: string): SegmentMode[] {
  if (mode === "idle") return ["work"];
  if (mode === "work") return ["break", "downtime", "idle"];
  if (mode === "break" || mode === "downtime") return ["work"];
  return [];
}

export function segmentActionLabel(current: string, action: SegmentMode) {
  if (action === "work" && (current === "break" || current === "downtime")) return "Продолжить";
  if (action === "work") return "В работу";
  if (action === "break") return "Перерыв";
  if (action === "downtime") return "Простой";
  return "Завершить интервал";
}

export function segmentProblem(input: { online: boolean; mode: SegmentMode; taskId: string; reason: DowntimeReason | ""; comment: string; behalf: string; needsBehalf: boolean }) {
  void input.online;
  if ((input.mode === "work" || input.mode === "downtime") && !input.taskId) return "Выберите опубликованное задание.";
  if (input.mode === "downtime" && !input.reason) return "Выберите причину простоя.";
  if (input.mode === "downtime" && !input.comment.trim()) return "Напишите, что остановило работу.";
  if (input.needsBehalf && !input.behalf.trim()) return "Напишите, почему интервал записывается за работника.";
  return "";
}

export function segmentEventBody(input: {
  requestId: string;
  employeeId: string;
  projectId: string;
  shiftId: string;
  expectedVersion: number;
  occurredAt: string;
  mode: SegmentMode;
  taskId?: string;
  reasonCode?: DowntimeReason;
  comment?: string;
  previousEventId?: string;
  onBehalfReason?: string;
}) {
  const event: Record<string, unknown> = {
    kind: "segment_change",
    requestId: input.requestId,
    employeeId: input.employeeId,
    projectId: input.projectId,
    shiftId: input.shiftId,
    expectedVersion: input.expectedVersion,
    occurredAt: input.occurredAt,
    mode: input.mode,
  };
  if (input.mode === "work" || input.mode === "downtime") event.taskId = input.taskId;
  if (input.mode === "downtime") {
    event.reasonCode = input.reasonCode;
    event.comment = input.comment?.trim();
  }
  if (input.previousEventId) event.previousEventId = input.previousEventId;
  const behalf = input.onBehalfReason?.trim();
  if (behalf) event.onBehalfReason = behalf;
  return { events: [event] };
}

export function segmentBatchError(code: string, httpStatus: number | null) {
  if (httpStatus === null) return "Нет подтверждения сервера. Повторите в этой форме, не закрывая её.";
  if (httpStatus === 401) return "Сессия закончилась. Войдите снова.";
  if (!code) return "";
  if (code === "stale_version") return "Версия дня на сервере уже другая. Прочитайте день заново.";
  if (code === "non_chronological_interval") return "Этот интервал пересекается с уже записанным. Сервер его не принял.";
  if (code === "downtime_requires_prior_task_work") return "Простой записывается только после работы по этому заданию.";
  if (code === "published_managed_task_required") return "Для работы нужно опубликованное задание.";
  if (code === "shift_closed" || code === "shift_reference_denied") return "Открытой смены на сервере уже нет.";
  if (code === "admission_required" || code === "assignment_required") return "Допуск или назначение не позволяют записать интервал.";
  if (code === "role_denied" || code === "on_behalf_reason_required") return "Этому входу интервал не разрешён.";
  return `Сервер не записал интервал: ${code}.`;
}
