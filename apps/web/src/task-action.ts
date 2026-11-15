export type TaskActionName = "submit" | "publish" | "reject" | "reopen" | "cancel";

const labels: Record<TaskActionName, string> = {
  submit: "Отправить",
  publish: "Опубликовать",
  reject: "Вернуть",
  reopen: "Вернуть в черновик",
  cancel: "Отменить",
};

export function taskActionLabel(action: TaskActionName) {
  return labels[action];
}

export function taskNeedsReason(action: TaskActionName) {
  return action === "reject" || action === "reopen" || action === "cancel";
}

export function taskActions(role: string, status: string): TaskActionName[] {
  if (role !== "director" && role !== "master") return [];
  const actions: TaskActionName[] = [];
  if (status === "draft") actions.push("submit");
  if (role === "director" && status === "pending_approval") actions.push("publish", "reject", "reopen");
  if (role === "master" && status === "pending_approval") actions.push("reopen");
  if (status === "draft" || status === "pending_approval" || (role === "director" && status === "published")) actions.push("cancel");
  return actions;
}

export function taskActionBody(action: TaskActionName, version: number, requestId: string, reason = "") {
  const body = { requestId, expectedVersion: version };
  return taskNeedsReason(action) ? { ...body, reason: reason.trim() } : body;
}

export function taskActionProblem(action: TaskActionName, reason: string) {
  if (!taskNeedsReason(action)) return "";
  const text = reason.trim();
  if (!text || text.length > 500) return "Напишите причину, до 500 символов.";
  return "";
}

export function taskActionError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли этот переход недоступен.";
  if (status === 404) return "Задание недоступно этому входу.";
  if (status === 409 && code === "stale_version") return "Задание уже изменено. Прочитайте актуальную версию перед повтором.";
  if (status === 409 && code === "invalid_task_state") return "Сервер не принял переход из текущего статуса.";
  if (status === 409 && code === "assignment_overlap") return "Время пересекается с другим опубликованным заданием этого исполнителя.";
  if (status === 409 && code === "template_changed") return "Шаблон фронта изменился. Публикация не выполнена.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Номер попытки относится к другому переходу. Прочитайте актуальную версию.";
  if(status===409&&code==='route_snapshot_required')return 'Это задание отправлено до настройки маршрута. Мастер должен вернуть его в черновик и отправить РП заново.';
  if(status===422&&['route_not_configured','route_participant_inactive'].includes(code))return 'Маршрут не настроен: администратор должен назначить активных мастера и РП этого объекта.';
  if (status === 422 && code === "task_not_ready") return "Сервер не опубликовал задание: допуск, фронт или обязательный модуль ещё блокируют.";
  if (status === 422) return "Сервер не разрешил этот переход.";
  if (status === 409) return "Конфликт данных. Статус не изменён.";
  return "Нет подтверждения сервера. Повторите тот же переход.";
}
