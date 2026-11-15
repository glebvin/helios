import type { ChecklistAnswer, ChecklistItem } from "@helios/domain";

export function canFillChecklist(role: string) {
  return role === "master" || role === "worker";
}

export function canReadChecklist(role: string) {
  return role === "director" || role === "master" || role === "worker" || role === "pto";
}

export function checklistPendingKey(tenantId: string, userId: string, taskId: string) {
  return `helios.checklist-run.${tenantId}.${userId}.${taskId}`;
}

export type ChecklistPending = {
  requestId: string;
  templateId: string;
  edition: number;
  expectedVersion: number;
  answers: ChecklistAnswer[];
};

export function samePending(saved: ChecklistPending | null, next: Omit<ChecklistPending, "requestId">) {
  return !!saved && saved.templateId === next.templateId && saved.edition === next.edition && saved.expectedVersion === next.expectedVersion && JSON.stringify(saved.answers) === JSON.stringify(next.answers);
}

export function fileKind(item: ChecklistItem) {
  if (item.kind === "photo") return { accept: "image/jpeg,image/png", types: ["image/jpeg", "image/png"] };
  if (item.kind === "document") return { accept: "application/pdf", types: ["application/pdf"] };
  return null;
}
