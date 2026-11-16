import assert from "node:assert/strict";
import test from "node:test";
import { canFillChecklist, canReadChecklist, checklistStatus } from "./checklist-run.ts";

test("заполняют мастер и работник, читает ещё и ПТО", () => {
  assert.equal(canFillChecklist("master"), true);
  assert.equal(canFillChecklist("worker"), true);
  assert.equal(canFillChecklist("pto"), false);
  assert.equal(canFillChecklist("director"), false);
  assert.equal(canReadChecklist("pto"), true);
  assert.equal(canReadChecklist("hr"), false);
});

test("статусы прохождения не смешивают устройство и сервер", () => {
  const answers = [{ itemId: "seam", value: "yes" }];
  assert.equal(checklistStatus({ phase: "device", state: "pending", lastError: null, answers, files: [] }), "Сохранено на устройстве");
  assert.equal(checklistStatus({ phase: "device", state: "pending", lastError: null, answers: [], files: [] }), "");
  assert.equal(checklistStatus({ phase: "queued", state: "retry_wait", lastError: "network_error", answers, files: [] }), "Ожидает отправки");
  assert.equal(checklistStatus({ phase: "queued", state: "synced", lastError: null, answers, files: [] }), "Подтверждено сервером");
  assert.equal(checklistStatus({ phase: "queued", state: "blocked", lastError: "http_409", answers, files: [] }), "Конфликт");
  assert.equal(checklistStatus({ phase: "queued", state: "blocked", lastError: "http_422", answers, files: [] }), "Ошибка");
});
