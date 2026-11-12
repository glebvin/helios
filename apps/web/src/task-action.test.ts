import test from "node:test";
import assert from "node:assert/strict";
import { taskActionBody, taskActionError, taskActionProblem, taskActions } from "./task-action.ts";

test("the master submits, the director publishes, and a worker gets no transition", () => {
  assert.deepEqual(taskActions("master", "draft"), ["submit", "cancel"]);
  assert.deepEqual(taskActions("director", "pending_approval"), ["publish", "reject", "reopen", "cancel"]);
  assert.deepEqual(taskActions("master", "pending_approval"), ["reopen", "cancel"]);
  assert.deepEqual(taskActions("worker", "published"), []);
  assert.deepEqual(taskActions("director", "published"), ["cancel"]);
});

test("a transition body repeats the same command and does not invent a reason history", () => {
  const submit = taskActionBody("submit", 4, "req-1");
  assert.deepEqual(submit, { requestId: "req-1", expectedVersion: 4 });
  assert.equal("reason" in submit, false);
  assert.equal("status" in submit, false);
  const again = taskActionBody("submit", 4, "req-1");
  assert.equal(again.requestId, submit.requestId);
  assert.equal(again.expectedVersion, submit.expectedVersion);
  assert.deepEqual(taskActionBody("reject", 5, "req-2", "  нет допуска  "), { requestId: "req-2", expectedVersion: 5, reason: "нет допуска" });
  assert.equal(taskActionProblem("cancel", ""), "Напишите причину, до 500 символов.");
});

test("readiness and a time overlap stay different from a lost answer", () => {
  assert.match(taskActionError(422, "task_not_ready"), /блокируют/);
  assert.match(taskActionError(409, "assignment_overlap"), /пересекается/);
  assert.match(taskActionError(403, "role_denied"), /роли/);
  assert.match(taskActionError(null), /Нет подтверждения/);
});
