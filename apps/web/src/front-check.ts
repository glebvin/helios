export type FrontItem = { id: string; label: string; critical: boolean };
export type FrontTemplate = { projectId: string; code: string; title: string; version: number; items: FrontItem[] };
export type FrontAnswer = { itemId: string; value: boolean };
export type FrontCheck = {
  id: string;
  sequence: number;
  templateCode: string;
  templateVersion: number;
  passed: boolean;
  reasons: string[];
  warnings: string[];
  answers: FrontAnswer[];
};
export type FrontReadiness = { ready: boolean; reasons: string[]; warnings: string[] };
export type FrontDraft = { code: string; title: string; items: FrontItem[] };
export type FrontAnswers = Record<string, boolean | null>;

export function canWriteFrontTemplate(role: string) {
  return role === "director";
}

export function canWriteFrontCheck(role: string) {
  return role === "director" || role === "master";
}

export function frontDraft(row: FrontTemplate | null): FrontDraft {
  return {
    code: row?.code ?? "front",
    title: row?.title ?? "",
    items: row ? row.items.map((item) => ({ ...item })) : [{ id: "point-1", label: "", critical: true }],
  };
}

export function frontTemplateValidation(draft: FrontDraft) {
  if (!draft.title.trim() || draft.title.trim().length > 200) return "Укажите название чек-листа до 200 символов.";
  if (!draft.code.trim() || draft.code.trim().length > 80) return "Укажите код чек-листа до 80 символов.";
  if (!draft.items.length || draft.items.length > 100) return "Нужен хотя бы один пункт, не больше 100.";
  if (draft.items.some((item) => !item.id.trim() || item.id.length > 80 || !item.label.trim() || item.label.trim().length > 500)) return "У каждого пункта нужны короткий номер и текст.";
  if (new Set(draft.items.map((item) => item.id)).size !== draft.items.length) return "Номера пунктов не должны повторяться.";
  return "";
}

export function frontTemplateBody(draft: FrontDraft, row: FrontTemplate | null, requestId: string) {
  const items = draft.items.map((item) => ({ id: item.id.trim(), label: item.label.trim(), critical: item.critical }));
  const shared = { requestId, title: draft.title.trim(), items };
  return row ? { ...shared, expectedVersion: row.version } : { ...shared, code: draft.code.trim() };
}

export function blankFrontAnswers(template: FrontTemplate): FrontAnswers {
  return Object.fromEntries(template.items.map((item) => [item.id, null]));
}

export function frontAnswersComplete(template: FrontTemplate, answers: FrontAnswers) {
  return template.items.every((item) => typeof answers[item.id] === "boolean");
}

export function frontCheckBody(taskVersion: number, template: FrontTemplate, answers: FrontAnswers, requestId: string) {
  return {
    requestId,
    expectedVersion: taskVersion,
    templateVersion: template.version,
    answers: template.items.map((item) => ({ itemId: item.id, value: answers[item.id] === true })),
  };
}

export type FrontCommand = { body: ReturnType<typeof frontCheckBody> };

export function frontCommand(previous: FrontCommand | null, taskVersion: number, template: FrontTemplate, answers: FrontAnswers, createId: () => string): FrontCommand {
  const body = frontCheckBody(taskVersion, template, answers, "");
  const saved = previous?.body;
  if (saved && typeof saved.requestId === "string" && Number.isInteger(saved.expectedVersion) && saved.templateVersion === body.templateVersion && JSON.stringify(saved.answers) === JSON.stringify(body.answers)) return previous!;
  return { body: { ...body, requestId: createId() } };
}

export function frontTemplateCurrent(seen: FrontTemplate, latest: FrontTemplate) {
  return seen.version === latest.version && seen.code === latest.code;
}

export function frontReason(reason: string, items: FrontItem[] = []) {
  const [code, ...tail] = reason.split(":");
  const value = tail.join(":");
  const label = items.find((item) => item.id === value)?.label ?? value;
  const text: Record<string, string> = {
    material_not_accepted: "Для этого вида нужна принятая партия этой зоны. Непроверенная и отклонённая не подходят.",
    predecessor_acceptance_unsupported: "Вид работ требует приёмку предшественника. Модуля нет, поэтому задание не готово.",
    id_unsupported: "Вид работ требует исполнительную документацию. Модуля нет, поэтому задание не готово.",
    front_missing: "Проверки фронта ещё нет.",
    front_failed: "Критичный пункт проверки не пройден.",
    front_template_changed: "Шаблон фронта изменился. Нужна новая проверка.",
    front_plan_changed: "План задания изменился после проверки.",
    front_catalog_changed: "Зона или вид работ изменились после проверки.",
    assignment_inactive: "Назначение исполнителя не действует.",
    employee_archived: "Карточка исполнителя в архиве.",
    employee_unlinked: "У исполнителя нет входа.",
    employee_member_inactive: "Вход исполнителя не действует.",
    employee_project_inactive: "У исполнителя нет доступа к объекту.",
    responsible_inactive: "Ответственный не действует на этом объекте.",
    zone_inactive: "Зона задания больше не активна.",
    work_type_inactive: "Вид работ больше не активен.",
    work_type_unit_changed: "Единица вида работ изменилась после черновика.",
    rd_required: "Для вида работ нужна рабочая документация.",
    invalid_interval: "Интервал задания не лежит в его рабочем дне.",
    invalid_tenant_timezone: "Часовой пояс организации не подтверждён.",
    no_check: "Допуск: проверки ещё нет.",
    check_failed: "Допуск: последняя проверка не пройдена.",
    not_latest_check: "Допуск: проверка не последняя.",
    template_changed: "Допуск: шаблон допуска изменился.",
    critical_failed: `Ответ «нет» на критичный пункт: ${label}`,
    noncritical_failed: `Предупреждение по пункту: ${label}`,
    qualification_missing: `Нет действующей квалификации: ${value}`,
    qualification_revoked: `Квалификация отозвана: ${value}`,
    qualification_expired: `Срок квалификации истёк: ${value}`,
    qualification_expired_on_work_date: `Квалификация не действует в день задания: ${value}`,
    qualification_changed: `Квалификация изменилась после проверки допуска: ${value}`,
  };
  if (code === "admission" && value) return frontReason(value, items);
  return text[code] ?? `Причина сервера: ${reason}`;
}

export function frontError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли проверка фронта недоступна.";
  if (status === 404) return "Задание, объект или чек-лист недоступны этому входу.";
  if (status === 409 && code === "template_changed") return "Шаблон изменён. Прочитайте текущую версию и ответьте заново.";
  if (status === 409 && code === "stale_version") return "Задание уже изменено. Прочитайте актуальную версию перед повтором.";
  if (status === 409 && code === "invalid_task_state") return "Проверка записывается, пока задание черновик или ждёт публикации.";
  if (status === 409 && code === "template_exists") return "Чек-лист объекта уже есть. Прочитайте его перед правкой.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Номер попытки относится к другим ответам. Прочитайте актуальную версию.";
  if (status === 400) return "Сервер не принял пункты или ответы.";
  if (status === 422 && code === "front_template_required") return "Сначала нужен чек-лист объекта.";
  if (status === 422) return "Сервер не разрешил эту проверку.";
  if (status === 409) return "Конфликт данных. Проверка не записана.";
  return "Нет подтверждения сервера. Повторите попытку с теми же ответами.";
}
