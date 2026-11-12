import type { AdmissionTemplate } from "./admission-template";
export type AdmissionCheck = {
  id: string; employeeId: string; projectId: string; templateCode: string; templateVersion: number; sequence: number;
  answers: { itemId: string; value: boolean }[]; templateSnapshot: AdmissionTemplate;
  qualificationEvidence: { id: string; code: string; version: number; validUntil: string | null; status: string }[];
  checkedBy: string; checkedAt: string; civilDate: string; passed: boolean; reasons: string[]; warnings: string[];
};
export type CheckPage = { items: AdmissionCheck[]; total: number; limit: number; offset: number };
export type CheckAnswers = Record<string, boolean | null>;
export function blankAnswers(template: AdmissionTemplate): CheckAnswers { return Object.fromEntries(template.items.map(item => [item.id, null])); }
export function answersComplete(template: AdmissionTemplate, answers: CheckAnswers) { return template.items.every(item => typeof answers[item.id] === "boolean"); }
export function checkBody(projectId: string, template: AdmissionTemplate, answers: CheckAnswers, requestId: string) {
  if (!answersComplete(template, answers)) throw new Error("answer_required");
  return { requestId, projectId, templateVersion: template.version, answers: template.items.map(item => ({ itemId: item.id, value: answers[item.id] as boolean })) };
}
export function checkReason(reason: string, template: AdmissionTemplate) {
  const [code, ...tail] = reason.split(":"), value = tail.join(":");
  const label = template.items.find(item => item.id === value)?.label ?? value;
  if (code === "critical_failed") return `Ответ «нет» на критичный пункт: ${label}`;
  if (code === "noncritical_failed") return `Предупреждение по пункту: ${label}`;
  if (code === "qualification_missing") return `Нет действующей квалификации: ${value}`;
  if (code === "qualification_revoked") return `Квалификация отозвана: ${value}`;
  if (code === "qualification_expired") return `Срок квалификации истёк: ${value}`;
  return `Причина сервера: ${reason}`;
}
export function checkError(status: number | null, code = "") {
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этой роли запись проверки недоступна.";
  if (status === 404) return "Сотрудник, объект или шаблон недоступны этому входу.";
  if (status === 409 && code === "template_changed") return "Шаблон изменён. Прочитайте текущий шаблон и ответьте на его пункты заново.";
  if (status === 409 && code === "idempotency_payload_mismatch") return "Номер попытки относится к другим ответам. Перечитайте шаблон перед повтором.";
  if (status === 400) return "Сервер не принял ответы. Каждый пункт требует ответа «да» или «нет».";
  if (status === 422) return "Сервер не разрешил проверку: сотрудник может быть в архиве.";
  return "Нет подтверждения сервера. Повторите те же ответы в этой форме.";
}
