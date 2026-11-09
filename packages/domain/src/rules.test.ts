import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPLOYEE_A,
  TENANT_A,
  TENANT_B,
  USER_DIRECTOR,
  USER_WORKER,
  assertSameScope,
  attributeCrewVolume,
  documentaryReadiness,
  efficiency,
  eventsForSync,
  keyBelongsToTenant,
  mayPublish,
  mayReinspect,
  maySign,
  objectKey,
  partialAcceptance,
  stableEventBody,
  validateRoute,
} from "./index.js";

test("маршрут не принимает четыре визы С и двух ответственных", () => {
  assert.equal(validateRoute([["R"], ["S"], ["S"], ["S"], ["S"], ["U"]]), false);
  assert.equal(validateRoute([["R", "U"], ["S"], ["K"], ["D"]]), true);
  assert.equal(validateRoute([["R"], ["R"]]), false);
});

test("подпись только по действующему приказу на этот объект", () => {
  const authority = { active: true, project: "P", documents: ["AOSR"], start: "2026-01-01", end: "2026-11-01" };
  assert.equal(maySign(authority, "P", "AOSR", "2026-11-03"), false);
  assert.equal(maySign({ ...authority, end: "2027-01-01" }, "OTHER", "AOSR", "2026-11-03"), false);
  assert.equal(maySign({ ...authority, end: "2027-01-01" }, "P", "AOSR", "2026-11-03"), true);
});

test("публикация задания ждёт фронт, материалы и предшествующий АОСР", () => {
  assert.equal(mayPublish([true], [true], false), false);
  assert.equal(mayPublish([true], [false], true), false);
  assert.equal(mayPublish([true], [true], true), true);
});

test("повторная сдача закрыта, пока замечание не проверено", () => {
  assert.equal(
    mayReinspect([
      { resolved: true, verified: true },
      { resolved: true, verified: false },
    ]),
    false,
  );
});

test("два акта не удваивают закрытую площадь, пустая цена не становится нулём", () => {
  const lots = documentaryReadiness([
    { quantity: "30", required: ["AOSR", "SCHEME"], signed: ["AOSR", "SCHEME"], scAccepted: true, price: "1000" },
    { quantity: "20", required: ["AOSR", "SCHEME"], signed: ["AOSR"], scAccepted: true, price: "1000" },
  ]);
  assert.deepEqual(lots, { ready: "30", debt: "20", debtRub: "20000" });
  const missing = documentaryReadiness([
    { quantity: "20", required: ["AOSR"], signed: [], scAccepted: true, price: null },
  ]);
  assert.equal(missing.debtRub, null);
});

test("частичная приёмка 18 и 17 оставляет разницу, норма не выдумывается", () => {
  assert.deepEqual(partialAcceptance("18", "17"), { accepted: "17", difference: "1" });
  assert.equal(efficiency("17", "0.4", "8"), "85");
  assert.equal(efficiency("17", null, "8"), null);
  assert.throws(() => partialAcceptance("18", "19"));
});

test("бригадный объём не делится на людей", () => {
  assert.deepEqual(attributeCrewVolume("17", 4), { scope: "crew", quantity: "17", members: 4 });
});

test("офлайн-событие чужого кабинета не уходит в синхронизацию", () => {
  const mine = { tenantId: TENANT_A, userId: USER_WORKER, status: "pending", eventId: "1" };
  const foreign = { tenantId: TENANT_B, userId: USER_WORKER, status: "pending", eventId: "2" };
  const sent = { ...mine, eventId: "3", status: "sent" };
  assert.deepEqual(eventsForSync([mine, foreign, sent], { tenantId: TENANT_A, userId: USER_WORKER }), [mine]);
  assert.throws(() => assertSameScope(foreign, { tenantId: TENANT_A, userId: USER_DIRECTOR }));
});

test("ключ файла принадлежит кабинету и не собирается из чужого имени", () => {
  const key = objectKey(TENANT_A, EMPLOYEE_A, "photo.jpg");
  assert.equal(keyBelongsToTenant(TENANT_A, key), true);
  assert.equal(keyBelongsToTenant(TENANT_B, key), false);
  assert.throws(() => objectKey(TENANT_A, EMPLOYEE_A, "../secret.jpg"));
});

test("одинаковое событие имеет стабильное тело", () => {
  assert.equal(stableEventBody({ b: 1, a: { d: 2, c: 3 } }), stableEventBody({ a: { c: 3, d: 2 }, b: 1 }));
});
