import type { ServerEmployee } from "./staff-list";

export type StaffOrg = { id: string; name: string };
export type StaffDraft = { fullName: string; phone: string; organizationId: string; status: "active" | "archived" };

export function staffDraft(employee: ServerEmployee | null, organizations: StaffOrg[]): StaffDraft {
  const organizationId = employee?.organizationId && organizations.some((item) => item.id === employee.organizationId)
    ? employee.organizationId
    : !employee && organizations.length === 1 ? organizations[0].id : "";
  return {
    fullName: employee?.fullName ?? "",
    phone: employee?.phone ?? "",
    organizationId,
    status: employee?.status === "archived" ? "archived" : "active",
  };
}

export function staffBody(draft: StaffDraft, employee: ServerEmployee | null, requestId: string) {
  const fullName = draft.fullName.trim();
  const phone = draft.phone.trim();
  const shared = { requestId, fullName, organizationId: draft.organizationId, phone: phone || null };
  if (!employee) return { ...shared, userId: null };
  return { ...shared, userId: employee.userId, expectedVersion: employee.version, status: draft.status };
}

export function staffWriteError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли запись сотрудника недоступна.";
  if (status === 409 && code === "stale_version") return "Карточка уже изменена. Обновите её и повторите.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Этот запрос относится к другому изменению. Прочитайте карточку перед повтором.";
  if (status === 409) return "Запись не выполнена: конфликт данных. Проверьте телефон и связанные поля.";
  if (status === 422) return "Организация или связанный вход не подходят. Запись не сохранена.";
  if (status === 400) return "Сервер не принял имя, телефон или организацию.";
  if (status === null) return "Нет ответа сервера. Запись не подтверждена.";
  return "Сервер не подтвердил запись.";
}

export function canWriteStaff(role: string) {
  return role === "director";
}

export function canImportStaff(role: string) {
  return role === "director" || role === "hr";
}

export function staffRequest(previous: { id: string; key: string }, key: string, createId: () => string) {
  return previous.id && previous.key === key ? previous : { id: createId(), key };
}
