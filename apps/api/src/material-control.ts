import { pinChecklist, validateChecklist, type ChecklistAnswer, type ChecklistItem, type ChecklistSnapshot, type ChecklistVerdict } from "@helios/domain";
import { httpError } from "./errors.js";
import { uuid } from "./api-input.js";
import { integer, object, text } from "./people-input.js";

export type ControlAction = "prepare" | "data" | "responsible" | "review";
export type ControlVerdict = "awaiting" | "accepted" | "rejected";
export type ControlStep = { action: ControlAction; decision: string | null; dataMark: string | null };

const actions: ControlAction[] = ["prepare", "data", "responsible", "review"];

export type MaterialControlCommand =
  | { requestId: string; expectedVersion: number; action: "prepare"; zoneId: string; workTypeId: string; templateId: string; answers: ChecklistAnswer[] }
  | { requestId: string; expectedVersion: number; action: "data"; dataMark: "provided" | "overdue" }
  | { requestId: string; expectedVersion: number; action: "responsible" }
  | { requestId: string; expectedVersion: number; action: "review"; decision: "agree" | "return"; reason: string | null };

export function materialControlCommand(input: unknown): MaterialControlCommand {
  const body = object(input, ["requestId", "expectedVersion", "action", "zoneId", "workTypeId", "templateId", "answers", "dataMark", "decision", "reason"]);
  if (typeof body.action !== "string" || !actions.includes(body.action as ControlAction)) throw httpError(400, "invalid_action");
  const action = body.action as ControlAction;
  const requestId = uuid(body.requestId).toLowerCase();
  const expectedVersion = integer(body.expectedVersion, 0);
  if (action === "prepare") {
    return {
      requestId, expectedVersion, action: "prepare",
      zoneId: uuid(body.zoneId).toLowerCase(),
      workTypeId: uuid(body.workTypeId).toLowerCase(),
      templateId: uuid(body.templateId).toLowerCase(),
      answers: answers(body.answers),
    };
  }
  if (body.zoneId !== undefined || body.workTypeId !== undefined || body.templateId !== undefined || body.answers !== undefined) throw httpError(400, "invalid_body");
  if (action === "data") {
    if (body.dataMark !== "provided" && body.dataMark !== "overdue") throw httpError(400, "invalid_action");
    if (body.decision !== undefined || body.reason !== undefined) throw httpError(400, "invalid_body");
    return { requestId, expectedVersion, action: "data", dataMark: body.dataMark };
  }
  if (action === "responsible") {
    if (body.dataMark !== undefined || body.decision !== undefined || body.reason !== undefined) throw httpError(400, "invalid_body");
    return { requestId, expectedVersion, action: "responsible" };
  }
  if (body.dataMark !== undefined) throw httpError(400, "invalid_body");
  if (body.decision !== "agree" && body.decision !== "return") throw httpError(400, "invalid_action");
  if (body.decision === "return" && (typeof body.reason !== "string" || !body.reason.trim())) throw httpError(400, "reason_required");
  if (body.decision !== "return" && body.reason !== undefined) throw httpError(400, "invalid_body");
  return { requestId, expectedVersion, action: "review", decision: body.decision, reason: body.decision === "return" ? text(body.reason, 500) : null };
}

function answers(value: unknown): ChecklistAnswer[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw httpError(400, "invalid_answers");
  return value.map((row) => {
    const body = object(row, ["itemId", "value"]);
    return { itemId: text(body.itemId, 64), value: text(body.value, 80) };
  });
}

export function pinApprovedChecklist(templateId: string, edition: number, items: ChecklistItem[]): ChecklistSnapshot {
  return pinChecklist({ id: templateId, version: edition, items });
}

/** Результат после последнего подготовки. Согласие не отменяет критичный отказ. Просроченные данные не подставляют ответ. */
export function controlVerdict(checklist: ChecklistVerdict, steps: readonly ControlStep[]): ControlVerdict {
  let prepare = -1;
  steps.forEach((step, index) => { if (step.action === "prepare") prepare = index; });
  if (prepare < 0) return "awaiting";
  if (checklist.refused) return "rejected";
  if (!checklist.ok) return "awaiting";
  const tail = steps.slice(prepare + 1);
  const data = tail.some((step) => step.action === "data");
  const responsible = tail.some((step) => step.action === "responsible");
  let review = -1;
  tail.forEach((step, index) => { if (step.action === "review") review = index; });
  if (data && responsible && review >= 0 && tail[review]?.decision === "agree") return "accepted";
  return "awaiting";
}

export const controlLabels: Record<ControlVerdict, string> = {
  awaiting: "Ожидает входного контроля",
  accepted: "Принята",
  rejected: "Отклонена",
};
