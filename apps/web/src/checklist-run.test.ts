import assert from "node:assert/strict";
import test from "node:test";
import { canFillChecklist, canReadChecklist, checklistPendingKey, samePending } from "./checklist-run.ts";

test("заполняют мастер и работник, читает ещё и ПТО", () => {
  assert.equal(canFillChecklist("master"), true);
  assert.equal(canFillChecklist("worker"), true);
  assert.equal(canFillChecklist("pto"), false);
  assert.equal(canFillChecklist("director"), false);
  assert.equal(canReadChecklist("pto"), true);
  assert.equal(canReadChecklist("hr"), false);
});

test("ожидание команды принадлежит пользователю и заданию", () => {
  assert.notEqual(checklistPendingKey("t", "a", "task"), checklistPendingKey("t", "b", "task"));
  const answers = [{ itemId: "seam", value: "yes" }];
  assert.equal(samePending({ requestId: "1", templateId: "t", edition: 1, expectedVersion: 0, answers }, { templateId: "t", edition: 1, expectedVersion: 0, answers }), true);
  assert.equal(samePending({ requestId: "1", templateId: "t", edition: 1, expectedVersion: 0, answers }, { templateId: "t", edition: 1, expectedVersion: 1, answers }), false);
});
