export type ProjectMembership = { projectId: string; userId: string; role: string; status: "active" | "revoked"; version: number };
export type ProjectAssignment = { projectId: string; employeeId: string; status: "active" | "revoked"; version: number; admissionCheckId: string | null; currentAdmission: { eligible: boolean; reasons: string[]; checkId: string | null; templateVersion: number | null } };
export type AccessCommand = { requestId: string; expectedVersion: number; status: "active" | "revoked"; admissionCheckId?: string };
export function accessCommand(version: number, status: "active" | "revoked", requestId: string, checkId?: string): AccessCommand {
  return { requestId, expectedVersion: version, status, ...(status === "active" && checkId ? { admissionCheckId: checkId } : {}) };
}
export function storedAccessCommand(value: string | null): AccessCommand | null {
  try {
    const row = JSON.parse(value ?? "null");
    if (!row || typeof row.requestId !== "string" || !Number.isSafeInteger(row.expectedVersion) || row.expectedVersion < 0 || !["active", "revoked"].includes(row.status) || (row.admissionCheckId !== undefined && typeof row.admissionCheckId !== "string")) return null;
    return accessCommand(row.expectedVersion, row.status, row.requestId, row.admissionCheckId);
  } catch { return null; }
}
export function accessError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли изменение доступа и назначения недоступно.";
  if (status === 404) return "Объект, сотрудник или учётная запись недоступны этому входу.";
  if (status === 409 && code === "stale_version") return "Состояние изменено в другом окне. Перечитайте его перед новой командой.";
  if (status === 409) return "Конфликт команды. Перечитайте состояние перед повтором.";
  if (status === 422 && code === "admission_required") return "Нужна актуальная успешная проверка допуска. Проверьте шаблон и квалификации, затем запишите новую проверку.";
  if (status === 422) return "Сотрудник или связанная учётная запись не подходят: проверьте архив и действующий вход.";
  if (status === 400) return "Сервер не принял данные назначения или доступа.";
  return "Изменение не подтверждено сервером. Повторите ту же команду.";
}
export function admissionReason(reason: string) {
  const [code, ...tail] = reason.split(":"), detail = tail.join(":");
  const labels: Record<string, string> = { no_check: "Нет привязанной проверки допуска", check_failed: "Проверка допуска не пройдена", not_latest_check: "Есть более новая попытка проверки", template_changed: "Шаблон допуска изменён", employee_archived: "Сотрудник в архиве", qualification_missing: "Нет действующей квалификации", qualification_revoked: "Квалификация отозвана", qualification_expired: "Срок квалификации истёк", qualification_changed: "Квалификация изменилась после проверки" };
  return `${labels[code] ?? code}${detail ? `: ${detail}` : ""}`;
}
