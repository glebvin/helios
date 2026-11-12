import test from "node:test";
import assert from "node:assert/strict";
import { positiveWork, reportListPath, reportsForTask, volumeBatchError, volumeEventBody, volumeLines, volumeOccurredAt, volumeProblem, volumeQuantity, volumeShift, type VolumeReport, type VolumeSegment, type VolumeShiftRow } from "./volume.ts";

const shift = (patch: Partial<VolumeShiftRow> = {}): VolumeShiftRow => ({
  id: "shift-1", employeeId: "emp-1", projectId: "project-1", startedAt: "2026-11-12T05:00:00.000Z", endedAt: "2026-11-12T08:00:00.000Z", ...patch,
});

test("comma becomes a decimal and zero is not replaced", () => {
  assert.equal(volumeQuantity(" 1,25 "), "1.25");
  assert.equal(volumeQuantity("0"), "");
  assert.equal(volumeQuantity("0,000"), "");
  assert.equal(volumeQuantity("1e2"), "");
  assert.equal(volumeQuantity(""), "");
  assert.equal(volumeProblem(true, "0", "", false), "Укажите объём больше нуля, до трёх знаков после запятой.");
});

test("one closed shift of the day is kept", () => {
  assert.equal(volumeShift([shift(), shift({ id: "open", endedAt: null, startedAt: "2026-11-12T09:00:00.000Z" })], 2, "emp-1", "project-1", "2026-11-12", "Europe/Moscow").kind, "one");
  assert.equal(volumeShift([shift(), shift({ id: "shift-2", startedAt: "2026-11-12T10:00:00.000Z" })], 2, "emp-1", "project-1", "2026-11-12", "Europe/Moscow").kind, "many");
  assert.equal(volumeShift([shift({ endedAt: null })], 1, "emp-1", "project-1", "2026-11-12", "Europe/Moscow").kind, "none");
  assert.equal(volumeShift([shift()], 2, "emp-1", "project-1", "2026-11-12", "Europe/Moscow").kind, "incomplete");
  assert.equal(volumeShift([shift({ projectId: "other" })], 1, "emp-1", "project-1", "2026-11-12", "Europe/Moscow").kind, "incomplete");
});

test("positive closed work is required and a short page is not treated as empty", () => {
  const row = (patch: Partial<VolumeSegment> = {}): VolumeSegment => ({
    shiftId: "shift-1", employeeId: "emp-1", projectId: "project-1", mode: "work", taskId: "task-1",
    startedAt: "2026-11-12T05:00:00.000Z", endedAt: "2026-11-12T06:00:00.000Z", ...patch,
  });
  assert.equal(positiveWork([row()], 1, "shift-1", "emp-1", "project-1", "task-1"), "yes");
  assert.equal(positiveWork([row({ endedAt: row().startedAt })], 1, "shift-1", "emp-1", "project-1", "task-1"), "no");
  assert.equal(positiveWork([row({ mode: "break" })], 1, "shift-1", "emp-1", "project-1", "task-1"), "no");
  assert.equal(positiveWork([row()], 2, "shift-1", "emp-1", "project-1", "task-1"), "incomplete");
});

test("the volume command keeps one quantity string and does not claim acceptance", () => {
  const body = volumeEventBody({
    requestId: "req-1", employeeId: "emp-1", projectId: "project-1", shiftId: "shift-1", expectedVersion: 4,
    occurredAt: "2026-11-12T08:05:00.000Z", taskId: "task-1", reportId: "report-1", submittedQuantity: "1,250",
  });
  assert.equal(body.events[0].kind, "submit_volume");
  assert.equal(body.events[0].submittedQuantity, "1.250");
  assert.equal("geo" in body.events[0], false);
  assert.equal("status" in body.events[0], false);
  assert.equal(volumeOccurredAt("2026-11-12T07:00:00.000Z", "2026-11-12T08:00:00.000Z"), "2026-11-12T08:00:00.000Z");
  assert.equal(volumeBatchError({ outcome: "success", result: { version: 5, submittedQuantity: "1.250", provisional: true, acceptedQuantity: null } }, 200), "");
  assert.match(volumeBatchError({ outcome: "success", result: { version: 5, submittedQuantity: "1.250", provisional: false, acceptedQuantity: null } }, 200), /только сообщён/);
  assert.match(volumeBatchError({ outcome: "error", code: "final_report_already_submitted" }, 200), /Второй отчёт/);
  assert.match(volumeBatchError({ outcome: "error", code: "stale_version" }, 200), /Версия/);
  assert.match(volumeBatchError(undefined, null), /Нет подтверждения/);
  const report: VolumeReport = { reportId: "report-1", shiftId: "shift-1", taskId: "task-1", employeeId: "emp-1", projectId: "project-1", submittedQuantity: "1.250", unit: "м3", provisional: true, acceptedQuantity: null };
  assert.equal(reportsForTask([report], 2, "task-1").kind, "incomplete");
  assert.deepEqual(volumeLines([report], 1)?.["task-1"], [{ reportId: "report-1", submittedQuantity: "1.250" }]);
  assert.equal(volumeLines([report], 2), null);
  assert.match(reportListPath("project-1", "emp-1"), /employeeId=emp-1/);
});
