import test from "node:test";
import assert from "node:assert/strict";
import type { ServerTask } from "./task-read.ts";
import { clockLabel, dayReadError, dayReadPath, durationLabel, employeeListPath, ownEmployee, shiftListPath, shiftReading, visibleWorkerTasks, type DayEmployee, type DayShift } from "./worker-day.ts";

const person = (patch: Partial<DayEmployee> = {}): DayEmployee => ({
  id: "emp-1", fullName: "Иван Работяга", userId: "user-1", status: "active", ...patch,
});

const task = (patch: Partial<ServerTask> = {}): ServerTask => ({
  id: "task-1", projectId: "project-1", title: "Кладка", workDate: "2026-11-12", plannedQuantity: "2.500", unit: "м2",
  assigneeEmployeeId: "emp-1", status: "published", version: 1, workflowKind: "managed02b", planRevision: null,
  zoneId: null, workTypeId: null, responsibleUserId: null, rdReference: null, plannedStart: null, plannedEnd: null, publicationSnapshotId: null,
  ...patch,
});

const shift = (patch: Partial<DayShift> = {}): DayShift => ({
  id: "shift-1", projectId: "project-1", employeeId: "emp-1", startedAt: "2026-11-12T05:00:00.000Z", endedAt: null, ...patch,
});

test("the worker reads only the active card linked to this login", () => {
  assert.equal(ownEmployee([person(), person({ id: "emp-2", userId: "user-2", fullName: "Другой" })], "user-1")?.id, "emp-1");
  assert.equal(ownEmployee([person({ userId: "user-2", fullName: "Другой" })], "user-1"), null);
  assert.equal(ownEmployee([], "user-1"), null);
  assert.equal(ownEmployee([person({ status: "archived" })], "user-1"), null);
  assert.equal(ownEmployee([person(), person({ id: "emp-2" })], "user-1"), null);
});

test("published and legacy tasks of this person stay, drafts and other people do not", () => {
  const rows = visibleWorkerTasks([
    task(),
    task({ id: "legacy", workflowKind: "legacy", status: "assigned", title: "Старое" }),
    task({ id: "draft", status: "draft", title: "Черновик" }),
    task({ id: "other", assigneeEmployeeId: "emp-2", title: "Чужое" }),
  ], "emp-1");
  assert.deepEqual(rows.map((item) => item.id), ["task-1", "legacy"]);
});

test("an open shift is taken only from a complete page of this person", () => {
  assert.equal(shiftReading([shift({ endedAt: "2026-11-12T14:00:00.000Z" })], 1, "emp-1", "project-1").kind, "none");
  assert.equal(shiftReading([shift()], 1, "emp-1", "project-1").kind, "one");
  assert.equal(shiftReading([shift(), shift({ id: "shift-2" })], 2, "emp-1", "project-1").kind, "many");
  assert.equal(shiftReading([shift()], 2, "emp-1", "project-1").kind, "incomplete");
  assert.equal(shiftReading([shift({ employeeId: "emp-2" })], 1, "emp-1", "project-1").kind, "incomplete");
});

test("day paths ask for this employee and do not invent a status", () => {
  assert.equal(employeeListPath("project 1"), "/employees?projectId=project%201&limit=100");
  assert.equal(dayReadPath("project-1", "emp-1", "2026-11-12"), "/projects/project-1/execution/employees/emp-1/day?day=2026-11-12");
  const shifts = shiftListPath("project-1", "emp-1");
  assert.match(shifts, /employeeId=emp-1/);
  assert.equal(shifts.includes("status="), false);
});

test("durations stay blank when the server text is not a whole millisecond count", () => {
  assert.equal(durationLabel("90000"), "1 мин");
  assert.equal(durationLabel("0"), "0 мин");
  assert.equal(durationLabel("7500000"), "2 ч 5 мин");
  assert.equal(durationLabel("1.5"), "");
  assert.equal(durationLabel(""), "");
});

test("the clock uses the tenant zone and a missing assignment is not a load failure", () => {
  assert.equal(clockLabel("2026-11-12T05:00:00.000Z", "Europe/Moscow"), "08:00");
  assert.equal(dayReadError(404, "day"), "Назначение на этот объект недоступно.");
  assert.equal(dayReadError(404, "tasks"), "Объект этому входу недоступен.");
  assert.notEqual(dayReadError(404, "day"), dayReadError(null, "day"));
  assert.match(dayReadError(403, "people"), /недоступен/);
});
