import test from "node:test";
import assert from "node:assert/strict";
import { shownTaskStatus, taskArea, taskListPath, taskStatusText } from "./task-read.ts";

test("a local move does not change the server status", () => {
  const task = { status: "published" };
  assert.equal(shownTaskStatus(task, "accepted"), "published");
  assert.equal(shownTaskStatus(task, "shift"), "published");
  assert.equal(taskArea(shownTaskStatus(task, "accepted")), "plan");
});

test("plan, shift and quality stay different statuses", () => {
  assert.equal(taskArea("draft"), "plan");
  assert.equal(taskArea("published"), "plan");
  assert.equal(taskArea("in_progress"), "shift");
  assert.equal(taskArea("accepted"), "quality");
  assert.equal(taskArea("needs_fix"), "quality");
  assert.equal(taskStatusText("published"), "Опубликовано");
  assert.equal(taskStatusText("made_up"), "made_up");
});

test("the day list does not ask the server to invent a status", () => {
  const path = taskListPath("6032eba7-cfb2-498d-a990-fa0bb459df1d", "2026-11-12", 25);
  assert.match(path, /\/tasks\?/);
  assert.match(path, /day=2026-11-12/);
  assert.match(path, /offset=25/);
  assert.equal(path.includes("status="), false);
});
