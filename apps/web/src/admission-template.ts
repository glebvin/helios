export type AdmissionItem = { id: string; label: string; critical: boolean };
export type AdmissionTemplate = { projectId: string; code: string; title: string; version: number; items: AdmissionItem[]; requiredQualificationCodes: string[] };
export type TemplateDraft = { code: string; title: string; items: AdmissionItem[]; codes: string };
export function templateDraft(row: AdmissionTemplate | null): TemplateDraft {
  return { code: row?.code ?? "", title: row?.title ?? "", items: row ? row.items.map(item => ({ ...item })) : [{ id: "item-1", label: "", critical: true }], codes: row?.requiredQualificationCodes.join("\n") ?? "" };
}
export function qualificationCodes(text: string) { return text.split(/\r?\n/).map(code => code.trim()).filter(Boolean); }
export function templateValidation(draft: TemplateDraft) {
  const codes = qualificationCodes(draft.codes);
  if (!draft.title.trim() || !draft.code.trim() || draft.title.trim().length > 200 || draft.code.trim().length > 80) return "Укажите название и код шаблона.";
  if (!draft.items.length || draft.items.length > 100 || draft.items.some(item => !item.label.trim() || item.label.trim().length > 500)) return "Нужен хотя бы один пункт с текстом; максимум 100 пунктов.";
  if (codes.length > 100 || codes.some(code => code.length > 80)) return "Укажите не более 100 кодов квалификаций, до 80 символов каждый.";
  if (new Set(codes).size !== codes.length) return "Коды квалификаций не должны повторяться.";
  return "";
}
export function templateBody(draft: TemplateDraft, row: AdmissionTemplate | null, requestId: string) {
  return { requestId, title: draft.title.trim(), items: draft.items.map(item => ({ ...item, label: item.label.trim() })), requiredQualificationCodes: qualificationCodes(draft.codes), ...(row ? { expectedVersion: row.version } : { code: draft.code.trim() }) };
}
export function templateError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли изменение шаблона недоступно.";
  if (status === 404) return "Объект недоступен этому входу.";
  if (status === 409 && code === "stale_version") return "Шаблон уже изменён в другом окне. Прочитайте актуальную версию перед повтором.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Номер попытки относится к другому изменению. Прочитайте актуальную версию.";
  if (status === 400) return "Сервер не принял пункты или коды квалификаций. Проверьте заполнение.";
  if (status === 422) return "Сервер не разрешил изменение шаблона этого объекта.";
  if (status === 409) return "Конфликт данных. Шаблон не записан.";
  return "Нет подтверждения сервера. Повторите попытку с теми же данными.";
}
