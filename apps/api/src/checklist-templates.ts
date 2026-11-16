import { checklistTemplateIssues, type ChecklistItem, type ChecklistKind } from "@helios/domain";
import { httpError } from "./errors.js";
import { uuid } from "./api-input.js";
import { integer, object, text } from "./people-input.js";

const kinds: ChecklistKind[] = ["yes_no", "number", "photo", "document", "batch"];
const itemKeys = ["id", "prompt", "kind", "required", "critical", "unit", "min", "max", "pass"];
const decisions = ["accept", "review", "approve", "return", "revise"] as const;
export type ChecklistDecision = typeof decisions[number];
export type ChecklistEditionStatus = "draft" | "pending_responsible" | "in_review" | "pending_approval" | "approved" | "returned";

export function checklistItems(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 40) throw httpError(400, "invalid_template");
  const items = value.map((row) => {
    const body = object(row, itemKeys);
    const kind = body.kind;
    if (typeof kind !== "string" || !kinds.includes(kind as ChecklistKind)) throw httpError(400, "invalid_template");
    if (typeof body.required !== "boolean" || typeof body.critical !== "boolean") throw httpError(400, "invalid_template");
    const item: ChecklistItem = { id: text(body.id, 64), prompt: text(body.prompt, 200), kind: kind as ChecklistKind, required: body.required, critical: body.critical };
    if (item.kind === "yes_no") {
      if (body.pass !== "yes" && body.pass !== "no") throw httpError(400, "invalid_template");
      if (body.unit !== undefined || body.min !== undefined || body.max !== undefined) throw httpError(400, "invalid_template");
      item.pass = body.pass;
    } else if (item.kind === "number") {
      if (body.pass !== undefined) throw httpError(400, "invalid_template");
      item.unit = text(body.unit, 40);
      if (body.min !== undefined) item.min = text(body.min, 40);
      if (body.max !== undefined) item.max = text(body.max, 40);
    } else if (body.pass !== undefined || body.unit !== undefined || body.min !== undefined || body.max !== undefined) throw httpError(400, "invalid_template");
    return item;
  });
  if (checklistTemplateIssues(items).length) throw httpError(400, "invalid_template");
  return items;
}

export function checklistDraft(input: unknown) {
  const body = object(input, ["requestId", "title", "items"]);
  return { requestId: uuid(body.requestId).toLowerCase(), title: text(body.title, 120), items: checklistItems(body.items) };
}

export function checklistSave(input: unknown) {
  const body = object(input, ["requestId", "expectedVersion", "title", "items"]);
  return { requestId: uuid(body.requestId).toLowerCase(), expectedVersion: integer(body.expectedVersion), title: text(body.title, 120), items: checklistItems(body.items) };
}

export function checklistSubmit(input: unknown) {
  const body = object(input, ["requestId", "expectedVersion"]);
  return { requestId: uuid(body.requestId).toLowerCase(), expectedVersion: integer(body.expectedVersion) };
}

export function checklistDecision(input: unknown) {
  const body = object(input, ["requestId", "expectedVersion", "action", "reason", "title", "items"]);
  const action = body.action;
  if (typeof action !== "string" || !decisions.includes(action as ChecklistDecision)) throw httpError(400, "invalid_action");
  if (action === "return" && (typeof body.reason !== "string" || !body.reason.trim())) throw httpError(400, "reason_required");
  if (action !== "return" && body.reason !== undefined && body.reason !== null) throw httpError(400, "invalid_action");
  const reason = action === "return" ? text(body.reason, 500) : null;
  const content = action === "revise" && body.title !== undefined
    ? { title: text(body.title, 120), items: checklistItems(body.items) }
    : null;
  if (action === "revise" && body.title === undefined && body.items !== undefined) throw httpError(400, "invalid_template");
  return { requestId: uuid(body.requestId).toLowerCase(), expectedVersion: integer(body.expectedVersion), action: action as ChecklistDecision, reason, content };
}

export function nextChecklistStatus(status: ChecklistEditionStatus, action: ChecklistDecision, reviewsDone: number): ChecklistEditionStatus | null {
  if (action === "return" && ["pending_responsible", "in_review", "pending_approval"].includes(status)) return "returned";
  if (status === "pending_responsible" && action === "accept") return "in_review";
  if (status === "in_review" && action === "review") return reviewsDone + 1 >= 2 ? "pending_approval" : "in_review";
  if (status === "pending_approval" && action === "approve" && reviewsDone >= 2) return "approved";
  if ((status === "approved" || status === "returned") && action === "revise") return "draft";
  return null;
}
