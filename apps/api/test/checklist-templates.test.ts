import assert from "node:assert/strict";
import test from "node:test";
import { checklistDecision, checklistItems, nextChecklistStatus } from "../src/checklist-templates.js";

const yes = { id: "seam", prompt: "Шов свободен", kind: "yes_no", pass: "yes", required: true, critical: true };

test("approval cannot skip the two reviews or the responsible step", () => {
  assert.equal(nextChecklistStatus("draft", "approve", 2), null);
  assert.equal(nextChecklistStatus("pending_responsible", "approve", 2), null);
  assert.equal(nextChecklistStatus("in_review", "approve", 2), null);
  assert.equal(nextChecklistStatus("pending_approval", "approve", 1), null);
  assert.equal(nextChecklistStatus("pending_approval", "approve", 2), "approved");
  assert.equal(nextChecklistStatus("pending_responsible", "accept", 0), "in_review");
  assert.equal(nextChecklistStatus("in_review", "review", 0), "in_review");
  assert.equal(nextChecklistStatus("in_review", "review", 1), "pending_approval");
  assert.equal(nextChecklistStatus("in_review", "accept", 0), null);
  assert.equal(nextChecklistStatus("approved", "revise", 2), "draft");
  assert.equal(nextChecklistStatus("returned", "return", 0), null);
});

test("template content rejects a missing pass and reversed tolerance", () => {
  assert.equal(checklistItems([yes, { id: "thickness", prompt: "Толщина", kind: "number", required: true, critical: false, unit: "мм", min: "10", max: "20" }]).length, 2);
  assert.throws(() => checklistItems([{ ...yes, pass: undefined }]), { message: "invalid_template" });
  assert.throws(() => checklistItems([{ id: "thickness", prompt: "Толщина", kind: "number", required: true, critical: false, unit: "мм", min: "20", max: "10" }]), { message: "invalid_template" });
  assert.throws(() => checklistItems(Array.from({ length: 41 }, (_, index) => ({ ...yes, id: `item-${index + 1}` }))), { message: "invalid_template" });
});

test("return requires a reason and other actions reject one", () => {
  assert.equal(checklistDecision({ requestId: "11111111-1111-4111-8111-111111111111", expectedVersion: 2, action: "return", reason: "Нет допуска" }).reason, "Нет допуска");
  assert.throws(() => checklistDecision({ requestId: "11111111-1111-4111-8111-111111111111", expectedVersion: 2, action: "return", reason: "  " }), { message: "reason_required" });
  assert.throws(() => checklistDecision({ requestId: "11111111-1111-4111-8111-111111111111", expectedVersion: 2, action: "approve", reason: "мимо" }), { message: "invalid_action" });
});
