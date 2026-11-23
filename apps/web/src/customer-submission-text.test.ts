import assert from "node:assert/strict";
import test from "node:test";
import { customerLine } from "./customer-submission-text.ts";

test("пустая внешняя заявка не становится нулём", () => {
  assert.equal(customerLine(null), "Внешней заявки ещё нет.");
  assert.equal(customerLine({ recorded: false, attemptNumber: null, openRemarks: 0, scans: [] }), "Внешней заявки ещё нет.");
  assert.equal(customerLine({ recorded: true, attemptNumber: 2, openRemarks: 0, scans: [{}] }), "Попытка 2. Открытых замечаний: 0. Скан приложен.");
});
