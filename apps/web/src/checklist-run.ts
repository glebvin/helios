import type { ChecklistAnswer, ChecklistItem } from "@helios/domain";

export function canFillChecklist(role: string) {
  return role === "master" || role === "worker";
}

export function canReadChecklist(role: string) {
  return role === "director" || role === "master" || role === "worker" || role === "pto";
}

export function checklistStatus(row: { phase: "device" | "queued"; state: string; lastError: string | null; answers: ChecklistAnswer[]; files: unknown[] } | null) {
  if (!row || (row.phase === "device" && row.answers.length === 0 && row.files.length === 0)) return "";
  if (row.phase === "device") return "Сохранено на устройстве";
  if (row.state === "pending" || row.state === "sending" || row.state === "retry_wait") return "Ожидает отправки";
  if (row.state === "synced") return "Подтверждено сервером";
  if (row.state === "blocked" && (row.lastError === "http_409" || row.lastError === "stale_version")) return "Конфликт";
  return "Ошибка";
}

export function fileKind(item: ChecklistItem) {
  if (item.kind === "photo") return { accept: "image/jpeg,image/png", types: ["image/jpeg", "image/png"] };
  if (item.kind === "document") return { accept: "application/pdf", types: ["application/pdf"] };
  return null;
}
