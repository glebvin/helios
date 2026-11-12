export type ServerTask = {
  id: string;
  projectId: string;
  title: string;
  workDate: string;
  plannedQuantity: string;
  unit: string;
  assigneeEmployeeId: string;
  status: string;
  version: number;
  workflowKind: string;
  planRevision: number | null;
  zoneId: string | null;
  workTypeId: string | null;
  responsibleUserId: string | null;
  rdReference: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  publicationSnapshotId: string | null;
};

export type TaskArea = "plan" | "shift" | "quality" | "other";

const plan = new Set(["draft", "pending_approval", "published", "cancelled"]);
const shift = new Set(["in_progress", "suspended"]);
const quality = new Set(["submitted", "in_review", "accepted", "closed", "needs_fix", "partially_accepted"]);
const labels: Record<string, string> = {
  draft: "Черновик",
  pending_approval: "Ждёт публикации",
  published: "Опубликовано",
  cancelled: "Отменено",
  in_progress: "В работе",
  suspended: "Приостановлено",
  submitted: "Сдано",
  in_review: "На проверке",
  accepted: "Принято",
  closed: "Закрыто",
  needs_fix: "Нужна правка",
  partially_accepted: "Принято частично",
};

export function taskArea(status: string): TaskArea {
  if (plan.has(status)) return "plan";
  if (shift.has(status)) return "shift";
  if (quality.has(status)) return "quality";
  return "other";
}

export function taskStatusText(status: string) {
  return labels[status] ?? status;
}

export function shownTaskStatus(task: { status: string }, _localMove?: string) {
  return task.status;
}

export function taskListPath(projectId: string, day: string, offset = 0) {
  const query = new URLSearchParams({ day, limit: "25", offset: String(offset) });
  return `/projects/${projectId}/tasks?${query}`;
}

export function taskError(status: number | null) {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли задания объекта недоступны.";
  if (status === 404) return "Задание или объект недоступны этому входу.";
  if (status === 400) return "Сервер не принял день или объект.";
  return "Нет подтверждения сервера. Повторите чтение.";
}
