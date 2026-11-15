import { cmpDecimal, parseDecimal } from "./decimal.js";

export const CHECKLIST_PAGE = 10;
export const CHECKLIST_PHOTO_LIMIT = 20;

export type ChecklistKind = "yes_no" | "number" | "photo" | "document" | "batch";

export type ChecklistItem = {
  id: string;
  prompt: string;
  kind: ChecklistKind;
  required: boolean;
  critical: boolean;
  unit?: string;
  min?: string;
  max?: string;
  /** Для да/нет задаётся в шаблоне. По тексту вопроса не выводится. */
  pass?: "yes" | "no";
};

export type ChecklistTemplate = {
  id: string;
  version: number;
  items: ChecklistItem[];
};

export type ChecklistAnswer = {
  itemId: string;
  value: string;
};

/** Прохождение хранит копию пунктов. Новый шаблон её не меняет. */
export type ChecklistSnapshot = {
  templateId: string;
  templateVersion: number;
  items: ChecklistItem[];
};

export type ChecklistReason =
  | "critical_empty"
  | "critical_invalid"
  | "required_empty"
  | "type_mismatch"
  | "out_of_bounds"
  | "failed_condition"
  | "photo_limit"
  | "invalid_template";

export type ChecklistRefusal = { itemId: string; reason: ChecklistReason };

export type ChecklistVerdict = {
  ok: boolean;
  refused: boolean;
  refusals: ChecklistRefusal[];
};

const identifier = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function pinChecklist(template: ChecklistTemplate): ChecklistSnapshot {
  return {
    templateId: template.id,
    templateVersion: template.version,
    items: template.items.map((item) => ({ ...item })),
  };
}

export function checklistPageCount(count: number): number {
  return Math.max(1, Math.ceil(count / CHECKLIST_PAGE));
}

export function checklistPage<T>(items: readonly T[], page: number): readonly T[] {
  const index = Math.min(Math.max(page, 0), checklistPageCount(items.length) - 1);
  return items.slice(index * CHECKLIST_PAGE, index * CHECKLIST_PAGE + CHECKLIST_PAGE);
}

function refusal(itemId: string, reason: ChecklistReason, critical: boolean): ChecklistRefusal {
  if (!critical) return { itemId, reason };
  return { itemId, reason: reason === "type_mismatch" || reason === "out_of_bounds" || reason === "failed_condition" ? "critical_invalid" : "critical_empty" };
}

function decimalText(value: string): boolean {
  try {
    parseDecimal(value);
    return true;
  } catch {
    return false;
  }
}

function numberProblem(item: ChecklistItem, value: string): ChecklistReason | null {
  try {
    if (item.min !== undefined && cmpDecimal(value, item.min) < 0) return "out_of_bounds";
    if (item.max !== undefined && cmpDecimal(value, item.max) > 0) return "out_of_bounds";
  } catch {
    return "type_mismatch";
  }
  return null;
}

function answerProblem(item: ChecklistItem, value: string | undefined): ChecklistReason | null {
  const empty = value === undefined || value.trim() === "";
  if (empty) return item.required || item.critical ? "required_empty" : null;
  if (item.kind === "yes_no") {
    if (value !== "yes" && value !== "no") return "type_mismatch";
    return value === item.pass ? null : "failed_condition";
  }
  if (item.kind === "number") {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return "type_mismatch";
    return numberProblem(item, value);
  }
  return identifier.test(value) ? null : "type_mismatch";
}

function itemValid(item: ChecklistItem, ids: Set<string>): boolean {
  if (!identifier.test(item.id) || ids.has(item.id) || !item.prompt.trim()) return false;
  ids.add(item.id);
  if (item.kind === "yes_no") return item.pass === "yes" || item.pass === "no";
  if (item.kind !== "number") return true;
  if (!item.unit?.trim()) return false;
  if (item.min !== undefined && !decimalText(item.min)) return false;
  if (item.max !== undefined && !decimalText(item.max)) return false;
  if (item.min !== undefined && item.max !== undefined && cmpDecimal(item.min, item.max) > 0) return false;
  return true;
}

/** Проверка ответов по закреплённой версии. Пригодна для сервера: без интерфейса и без записи. */
export function validateChecklist(snapshot: ChecklistSnapshot, answers: readonly ChecklistAnswer[]): ChecklistVerdict {
  const ids = new Set<string>();
  const refusals: ChecklistRefusal[] = [];
  if (!snapshot.templateId || !Number.isInteger(snapshot.templateVersion) || snapshot.templateVersion < 1) {
    refusals.push({ itemId: "", reason: "invalid_template" });
  }
  for (const item of snapshot.items) {
    if (!itemValid(item, ids)) {
      refusals.push({ itemId: item.id, reason: "invalid_template" });
      continue;
    }
    const matched = answers.filter((answer) => answer.itemId === item.id);
    const problem = matched.length > 1 ? "type_mismatch" : answerProblem(item, matched[0]?.value);
    if (problem) refusals.push(refusal(item.id, problem, item.critical));
  }
  const photos = snapshot.items.filter((item) => item.kind === "photo" && answers.some((answer) => answer.itemId === item.id && answer.value.trim())).length;
  if (photos > CHECKLIST_PHOTO_LIMIT) refusals.push({ itemId: "", reason: "photo_limit" });
  return { ok: refusals.length === 0, refused: refusals.some((item) => item.reason.startsWith("critical")), refusals };
}
