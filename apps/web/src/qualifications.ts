export type Qualification = {
  id: string; employeeId: string; code: string; title: string;
  documentReference: string | null; validUntil: string | null;
  status: "active" | "revoked"; version: number;
};
export type QualificationPage = { items: Qualification[]; total: number; limit: number; offset: number };
export function qualificationState(row: Qualification, day: string) {
  if (row.status === "revoked") return "Отозвана";
  if (!day) return "Срок не проверен";
  if (row.validUntil !== null && row.validUntil < day) return "Истекла";
  return "Действует";
}
export function qualificationError(reason: { status?: number; message?: string }) {
  if (reason.status === 401) return "Сессия закончилась. Войдите снова.";
  if (reason.status === 403) return "Этой роли действие с квалификациями недоступно.";
  if (reason.status === 404) return "Сотрудник или квалификация недоступны этому входу.";
  if (reason.status === 409 && reason.message === "stale_version") return "Квалификация уже изменена. Прочитайте актуальную запись перед повтором.";
  if (reason.status === 409 && reason.message === "idempotency_payload_mismatch") return "Номер попытки относится к другому изменению. Прочитайте актуальную запись.";
  if (reason.status === 409) return "Конфликт данных: проверьте, нет ли квалификации с таким кодом.";
  if (reason.status === 422) return "Сервер не разрешил изменение: сотрудник или квалификация могут быть в архиве или отозваны.";
  if (reason.status === 400) return "Проверьте название, код, реквизиты и дату.";
  return "Нет подтверждения сервера. Повторите попытку с теми же данными.";
}
