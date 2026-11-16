import test from "node:test";
import assert from "node:assert/strict";
import { canWriteTaskDraft, taskDraftBody, taskDraftError, taskDraftValidation, taskQuantity, zonedInstant, type TaskDraft } from "./task-draft.ts";

const draft: TaskDraft = {
  zoneId: "zone",
  workTypeId: "type",
  title: "  Бетонирование  ",
  workDate: "2026-11-12",
  plannedQuantity: "2,5",
  assigneeEmployeeId: "employee",
  responsibleUserId: "user",
  start: "08:00",
  end: "17:00",
  rdReference: "",
  materialBatchId: "",
};

test("a worker cannot create a draft and the quantity stays text", () => {
  assert.equal(canWriteTaskDraft("director"), true);
  assert.equal(canWriteTaskDraft("master"), true);
  assert.equal(canWriteTaskDraft("worker"), false);
  assert.equal(taskQuantity("2,50"), "2.50");
  assert.equal(taskQuantity("0"), "");
  assert.equal(taskQuantity("1.2345"), "");
});

test("the draft body uses the work type unit and omits the old task fields", () => {
  const body = taskDraftBody(draft, "req-1", "Europe/Moscow");
  assert.equal(body.plannedQuantity, "2.5");
  assert.equal(body.title, "Бетонирование");
  assert.equal(body.rdReference, null);
  assert.equal(body.plannedStart, zonedInstant("2026-11-12", "08:00", "Europe/Moscow"));
  assert.equal(new Date(body.plannedStart).toISOString(), "2026-11-12T05:00:00.000Z");
  assert.equal("unit" in body, false);
  assert.equal("status" in body, false);
  assert.equal("organizationId" in body, false);
  assert.equal("expectedVersion" in body, false);
  const update = taskDraftBody({ ...draft, rdReference: " РД-4 " }, "req-2", "Europe/Moscow", 3);
  assert.equal(update.expectedVersion, 3);
  assert.equal(update.rdReference, "РД-4");
});

test("field and schedule problems stay distinct from a lost server answer", () => {
  assert.match(taskDraftValidation({ ...draft, start: "17:00", end: "08:00" }, false), /позже начала/);
  assert.match(taskDraftValidation(draft, true), /рабочая документация/);
  assert.equal(taskDraftValidation(draft, false), "");
  assert.match(taskDraftError(400, "invalid_quantity"), /объём/);
  assert.match(taskDraftError(400, "invalid_interval"), /дня объекта/);
  assert.match(taskDraftError(422, "rd_required"), /документация/);
  assert.match(taskDraftError(403, "role_denied"), /роли/);
  assert.match(taskDraftError(null), /Нет подтверждения/);
});
