import test from "node:test";
import assert from "node:assert/strict";
import { evidenceAttachBody, evidenceError, evidenceKind, evidenceProblem, evidenceQueueError, evidenceReserveBody, evidenceReuse, evidenceSaved, evidenceStep, filesForReport, type EvidenceAttempt, type EvidenceFileRow } from "./evidence.ts";

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const attempt: EvidenceAttempt = {
  requestId: "req-1", fileId: "file-1", attachRequestId: "req-2", filename: "photo.png",
  contentType: "image/png", sizeBytes: png.length, sha256: "a".repeat(64), onBehalfReason: "",
};

test("only a real jpeg, png or pdf is offered, and an empty file is not replaced", () => {
  assert.equal(evidenceKind(png), "image/png");
  assert.equal(evidenceKind(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(evidenceKind(Uint8Array.from([0x25, 0x50, 0x44, 0x46])), "application/pdf");
  assert.equal(evidenceKind(Uint8Array.from([1, 2, 3, 4])), "");
  assert.match(evidenceProblem(true, "photo.png", "", 4, "", false), /JPEG/);
  assert.match(evidenceProblem(true, "photo.png", "image/png", 0, "", false), /пустой/);
  assert.equal(evidenceProblem(false, "photo.png", "image/png", 4, "", false), "");
});

test("the same bytes reuse one reservation and a pending file is not saved", () => {
  assert.equal(evidenceReuse(attempt, attempt.sha256, "").kind, "same");
  assert.equal(evidenceReuse(attempt, "b".repeat(64), "").kind, "fresh");
  assert.equal(evidenceReuse({ ...attempt, onBehalfReason: "замена" }, attempt.sha256, "").kind, "reason");
  const reserve = evidenceReserveBody(attempt, "emp-1");
  assert.equal(reserve.employeeId, "emp-1");
  assert.equal("status" in reserve, false);
  assert.deepEqual(evidenceAttachBody(attempt, "report-1").target, { kind: "final_report", reportId: "report-1" });
  const pending: EvidenceFileRow = { id: "file-1", projectId: "project-1", employeeId: "emp-1", filename: "photo.png", state: "pending", sha256: attempt.sha256, attachment: null };
  assert.equal(evidenceSaved(pending, "report-1"), false);
  assert.equal(evidenceStep(pending, "report-1"), "upload");
  assert.equal(evidenceStep({ ...pending, state: "ready" }, "report-1"), "attach");
  const saved = { ...pending, state: "ready" as const, attachment: { target: { kind: "final_report", reportId: "report-1" } } };
  assert.equal(evidenceSaved(saved, "report-1"), true);
  assert.equal(evidenceStep(saved, "report-1"), "saved");
  assert.equal(filesForReport([saved, { ...saved, id: "other", projectId: "project-2" }], 2, "report-1", "project-1", "emp-1").kind, "incomplete");
  assert.deepEqual(filesForReport([saved], 1, "report-1", "project-1", "emp-1"), { kind: "ready", items: [saved] });
  assert.match(evidenceQueueError("capacity_exceeded"), /не сохранён/);
  assert.match(evidenceQueueError("quota_exceeded"), /Хранилище устройства отказало/);
  assert.match(evidenceError(null, ""), /не считается сохранённым/);
  assert.match(evidenceError(409, "evidence_pending"), /не догружены/);
  assert.match(evidenceError(409, "evidence_already_attached"), /Второй связи/);
  assert.match(evidenceError(404, "not_found"), /другого объекта/);
});
