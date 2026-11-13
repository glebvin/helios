import test from "node:test";
import assert from "node:assert/strict";
import { openSegment, segmentActionLabel, segmentActions, segmentBatchError, segmentEventBody, segmentListPath, segmentProblem, type SegmentRow } from "./segment.ts";

const row = (patch: Partial<SegmentRow> = {}): SegmentRow => ({
  id: "seg-1", shiftId: "shift-1", employeeId: "emp-1", projectId: "project-1", mode: "work", taskId: "task-1",
  reasonCode: null, comment: null, startedAt: "2026-11-12T05:00:00.000Z", endedAt: null, ...patch,
});

test("one open interval is kept and a foreign or partial page is not chosen", () => {
  assert.equal(openSegment([row(), row({ id: "closed", endedAt: "2026-11-12T06:00:00.000Z", mode: "idle" })], 2, "shift-1", "emp-1", "project-1").kind, "one");
  assert.equal(openSegment([row(), row({ id: "seg-2" })], 2, "shift-1", "emp-1", "project-1").kind, "many");
  assert.equal(openSegment([row({ endedAt: "2026-11-12T06:00:00.000Z" })], 1, "shift-1", "emp-1", "project-1").kind, "none");
  assert.equal(openSegment([row()], 2, "shift-1", "emp-1", "project-1").kind, "incomplete");
  assert.equal(openSegment([row({ employeeId: "emp-2" })], 1, "shift-1", "emp-1", "project-1").kind, "incomplete");
});

test("break and downtime offer continuation, and work can close", () => {
  assert.deepEqual(segmentActions("idle"), ["work"]);
  assert.deepEqual(segmentActions("work"), ["break", "downtime", "idle"]);
  assert.deepEqual(segmentActions("break"), ["work"]);
  assert.equal(segmentActionLabel("break", "work"), "Продолжить");
  assert.equal(segmentActionLabel("downtime", "work"), "Продолжить");
  assert.equal(segmentActionLabel("work", "idle"), "Завершить интервал");
});

test("a segment command has one instant, no coordinates and no client status", () => {
  const work = segmentEventBody({
    requestId: "req-1", employeeId: "emp-1", projectId: "project-1", shiftId: "shift-1",
    expectedVersion: 3, occurredAt: "2026-11-12T06:00:00.000Z", mode: "work", taskId: "task-1",
  });
  assert.equal(work.events[0].occurredAt, "2026-11-12T06:00:00.000Z");
  assert.equal("endedAt" in work.events[0], false);
  assert.equal("geo" in work.events[0], false);
  assert.equal("status" in work.events[0], false);
  const pause = segmentEventBody({ ...work.events[0], mode: "break", taskId: "task-1" } as never);
  assert.equal("taskId" in pause.events[0], false);
  const stop = segmentEventBody({
    requestId: "req-2", employeeId: "emp-1", projectId: "project-1", shiftId: "shift-1",
    expectedVersion: 4, occurredAt: "2026-11-12T07:00:00.000Z", mode: "downtime", taskId: "task-1",
    reasonCode: "weather", comment: "  дождь  ",
  });
  assert.equal(stop.events[0].reasonCode, "weather");
  assert.equal(stop.events[0].comment, "дождь");
  assert.match(segmentListPath("project-1", "shift-1"), /segments\?/);
});

test("a version conflict stays different from a missing network answer", () => {
  assert.equal(segmentProblem({ online: false, mode: "break", taskId: "", reason: "", comment: "", behalf: "", needsBehalf: false }), "");
  assert.match(segmentProblem({ online: true, mode: "downtime", taskId: "task-1", reason: "weather", comment: " ", behalf: "", needsBehalf: false }), /остановило/);
  assert.equal(segmentProblem({ online: true, mode: "break", taskId: "", reason: "", comment: "", behalf: "", needsBehalf: false }), "");
  assert.match(segmentBatchError("stale_version", 200), /уже другая/);
  assert.match(segmentBatchError("non_chronological_interval", 200), /пересекается/);
  assert.match(segmentBatchError("", null), /Нет подтверждения/);
  assert.notEqual(segmentBatchError("stale_version", 200), segmentBatchError("", null));
});
