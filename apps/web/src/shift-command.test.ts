import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { canWriteShift, shiftBatchError, shiftEventBody, shiftNeedsReason, shiftProblem } from "./shift-command.ts";

const base = {
  requestId: "req-1", employeeId: "emp-1", projectId: "project-1", shiftId: "shift-1",
  expectedVersion: 4, occurredAt: "2026-11-12T05:00:00.000Z", kind: "shift_start" as const,
};

test("new shift commands omit coordinates even if an old-shaped caller supplies them", () => {
  const oldInput = { ...base, geo: { latitude: 55.75, longitude: 37.62, accuracyMeters: 12, capturedAt: base.occurredAt } };
  for (const kind of ["shift_start", "shift_end"] as const) {
    const body = shiftEventBody({ ...oldInput, kind });
    assert.equal("geo" in body.events[0], false);
    assert.equal(JSON.stringify(body).includes('"latitude"'), false);
    assert.equal(body.events[0].requestId, base.requestId);
    assert.equal(body.events[0].occurredAt, base.occurredAt);
  }
});

test("the web app does not introduce browser location collection APIs", () => {
  const root = new URL("./", import.meta.url);
  for (const name of readdirSync(root).filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))) {
    assert.doesNotMatch(readFileSync(new URL(name, root), "utf8"), /\b(?:geolocation|getCurrentPosition|watchPosition)\b/, name);
  }
});

test("the same command keeps its version, and a master reason is not a status", () => {
  const first = shiftEventBody(base);
  const repeat = shiftEventBody(base);
  assert.deepEqual(repeat, first);
  assert.equal(first.events[0].expectedVersion, 4);
  assert.equal("status" in first.events[0], false);
  const master = shiftEventBody({ ...base, kind: "shift_end", onBehalfReason: "  работник без телефона  ", previousEventId: "start-1" });
  assert.equal(master.events[0].onBehalfReason, "работник без телефона");
  assert.equal(master.events[0].previousEventId, "start-1");
});

test("offline, a closed shift and a missing reason stay different from a version conflict", () => {
  assert.equal(shiftProblem(false, "shift_start", false, "", false), "");
  assert.match(shiftProblem(true, "shift_end", false, "", false), /нет/);
  assert.match(shiftProblem(true, "shift_start", false, "  ", true), /почему/);
  assert.equal(shiftProblem(true, "shift_start", false, "", false), "");
  assert.match(shiftBatchError({ results: [{ outcome: "error", status: 409, code: "stale_version" }] }, 200), /уже другая/);
  assert.equal(shiftBatchError({ results: [{ outcome: "duplicate", result: { version: 5 } }] }, 200), "");
  assert.match(shiftBatchError(null, null), /Нет подтверждения/);
  assert.notEqual(shiftBatchError({ results: [{ outcome: "error", code: "admission_required" }] }, 200), shiftBatchError({ results: [{ outcome: "error", code: "stale_version" }] }, 200));
  assert.equal(canWriteShift("worker"), true);
  assert.equal(canWriteShift("director"), false);
  assert.equal(shiftNeedsReason("master"), true);
  assert.equal(shiftNeedsReason("worker"), false);
});
