import type { ServerTask } from "./task-read";

export type TaskDraft = {
  zoneId: string;
  workTypeId: string;
  title: string;
  workDate: string;
  plannedQuantity: string;
  assigneeEmployeeId: string;
  responsibleUserId: string;
  start: string;
  end: string;
  rdReference: string;
  materialBatchId: string;
};

const quantityPattern = /^\d{1,11}(?:\.\d{1,3})?$/;
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export function canWriteTaskDraft(role: string) {
  return role === "director" || role === "master";
}

export function taskQuantity(value: string) {
  const text = value.trim().replace(",", ".");
  if (!quantityPattern.test(text) || !/[1-9]/.test(text)) return "";
  return text;
}

export function taskDraftValidation(draft: TaskDraft, requiresRd: boolean, requiresMaterial = false) {
  if (!draft.zoneId) return "Выберите зону.";
  if (!draft.workTypeId) return "Выберите вид работ.";
  if (!draft.title.trim() || draft.title.trim().length > 200) return "Напишите название до 200 символов.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.workDate)) return "Укажите день.";
  if (!taskQuantity(draft.plannedQuantity)) return "Укажите объём числом, до трёх знаков после запятой.";
  if (!draft.assigneeEmployeeId) return "Выберите исполнителя.";
  if (!draft.responsibleUserId) return "Выберите ответственного.";
  if (!clockPattern.test(draft.start) || !clockPattern.test(draft.end) || draft.start >= draft.end) return "Конец интервала должен быть позже начала в этот же день.";
  if (requiresRd && !draft.rdReference.trim()) return "Для этого вида нужна рабочая документация.";
  if (requiresMaterial && !draft.materialBatchId) return "Выберите принятую партию этой зоны и вида работ.";
  if (draft.rdReference.trim().length > 500) return "Ссылка на документацию длиннее 500 символов.";
  return "";
}

export function taskDraftBody(draft: TaskDraft, requestId: string, timezone: string, expectedVersion?: number) {
  const body = {
    requestId,
    zoneId: draft.zoneId,
    workTypeId: draft.workTypeId,
    title: draft.title.trim(),
    workDate: draft.workDate,
    plannedQuantity: taskQuantity(draft.plannedQuantity),
    assigneeEmployeeId: draft.assigneeEmployeeId,
    responsibleUserId: draft.responsibleUserId,
    plannedStart: zonedInstant(draft.workDate, draft.start, timezone),
    plannedEnd: zonedInstant(draft.workDate, draft.end, timezone),
    rdReference: draft.rdReference.trim() ? draft.rdReference.trim() : null,
    materialBatchId: draft.materialBatchId || null,
  };
  return expectedVersion === undefined ? body : { ...body, expectedVersion };
}

export function taskDraftFrom(task: ServerTask | null, day: string, responsibleUserId: string, timezone: string): TaskDraft {
  return {
    zoneId: task?.zoneId ?? "",
    workTypeId: task?.workTypeId ?? "",
    title: task?.title ?? "",
    workDate: task?.workDate ?? day,
    plannedQuantity: task?.plannedQuantity ?? "",
    assigneeEmployeeId: task?.assigneeEmployeeId ?? "",
    responsibleUserId: task?.responsibleUserId ?? responsibleUserId,
    start: clockInZone(task?.plannedStart ?? null, timezone) || "08:00",
    end: clockInZone(task?.plannedEnd ?? null, timezone) || "17:00",
    rdReference: task?.rdReference ?? "",
    materialBatchId: task?.materialBatchId ?? "",
  };
}

export function taskDraftError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли черновик задания недоступен.";
  if (status === 404) return "Зона, вид работ, исполнитель или ответственный не найдены.";
  if (status === 409 && code === "stale_version") return "Черновик уже изменён в другом окне. Прочитайте актуальную версию перед повтором.";
  if (status === 409 && code === "material_not_accepted") return "Эта партия не принята для выбранных зоны и вида работ.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Номер попытки относится к другому черновику. Прочитайте актуальную версию.";
  if (status === 409) return "Конфликт данных. Черновик не записан.";
  if (status === 400 && code === "invalid_quantity") return "Сервер не принял объём. Нужно число до трёх знаков после запятой.";
  if (status === 400 && code === "invalid_interval") return "Интервал должен лежать внутри выбранного дня объекта.";
  if (status === 400) return "Сервер не принял поля черновика.";
  if (status === 422 && code === "rd_required") return "Для этого вида нужна рабочая документация.";
  if (status === 422 && code === "responsible_not_ready") return "Ответственный не руководитель и не прораб этого объекта.";
  if (status === 422 && code === "employee_not_ready") return "У исполнителя нет действующего входа.";
  if (status === 422 && code === "reference_denied") return "Зона, вид работ или человек недоступны для нового задания.";
  if (status === 422) return "Сервер не разрешил этот черновик.";
  return "Нет подтверждения сервера. Повторите попытку с теми же данными.";
}

export function zonedInstant(day: string, time: string, timeZone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, date, hour, minute, 0);
  let offset = zoneOffsetMinutes(timeZone, new Date(wall));
  let instant = wall - offset * 60_000;
  const next = zoneOffsetMinutes(timeZone, new Date(instant));
  if (next !== offset) instant = wall - next * 60_000;
  return new Date(instant).toISOString();
}

export function clockInZone(value: string | null, timeZone: string) {
  if (!value || !timeZone) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

function zoneOffsetMinutes(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const hour = read("hour") % 24;
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), hour, read("minute"), read("second"));
  return Math.round((asUtc - date.getTime()) / 60_000);
}
