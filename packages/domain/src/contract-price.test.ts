import assert from "node:assert/strict";
import test from "node:test";
import { conflictingPrices, quoteContractReadiness, validateContractPrice, type ContractPrice, type PricedVolume } from "./index.js";

function price(patch: Partial<ContractPrice> = {}): ContractPrice {
  return {
    projectId: "object-1",
    workTypeId: "work-1",
    unit: "м²",
    price: "1000",
    start: "2026-01-01",
    end: "2026-12-31",
    version: 1,
    ...patch,
  };
}

const volume: PricedVolume = {
  projectId: "object-1",
  workTypeId: "work-1",
  unit: "м²",
  accepted: "50",
  closed: "30",
  on: "2026-06-01",
};

test("50 м² принято и 30 м² закрыто по 1000 дают 30000 готово и 20000 не готово", () => {
  assert.deepEqual(quoteContractReadiness([price()], 1, volume), {
    outcome: "calculated",
    version: 1,
    ready: "30000",
    notReady: "20000",
  });
});

test("нулевая цена считается, отсутствующая версия не становится нулём", () => {
  assert.deepEqual(quoteContractReadiness([price({ price: "0" })], 1, volume), {
    outcome: "calculated",
    version: 1,
    ready: "0",
    notReady: "0",
  });
  assert.deepEqual(quoteContractReadiness([price()], 2, volume), { outcome: "missing" });
});

test("другая единица и день вне периода не считаются этой ценой", () => {
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, unit: "м" }).outcome, "unit_mismatch");
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, on: "2026-01-01" }).outcome, "calculated");
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, on: "2026-12-31" }).outcome, "calculated");
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, on: "2025-12-31" }).outcome, "outside_period");
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, on: "2027-01-01" }).outcome, "outside_period");
});

test("пересекающиеся периоды и повтор версии обнаруживаются до расчёта", () => {
  const next = price({ version: 2, start: "2026-12-31", end: "2027-06-30", price: "2000" });
  assert.equal(conflictingPrices([price(), next])[0]?.reason, "period");
  assert.deepEqual(conflictingPrices([price(), price({ version: 2, start: "2027-01-01", end: "2027-06-30" })]), []);
  const duplicate = price({ price: "2000" });
  assert.equal(conflictingPrices([price(), duplicate])[0]?.reason, "version");
  assert.equal(quoteContractReadiness([price(), duplicate], 1, volume).outcome, "version_conflict");
});

test("новая цена не меняет результат уже выбранной версии", () => {
  const first = price();
  const before = quoteContractReadiness([first], 1, volume);
  const after = quoteContractReadiness([first, price({ version: 2, start: "2027-01-01", end: "2027-12-31", price: "2500" })], 1, volume);
  assert.deepEqual(before, after);
  assert.equal(before.outcome, "calculated");
});

test("дробные рубли не теряют копейки и не входят в соседний объект", () => {
  const quoted = quoteContractReadiness([price({ price: "19.99" })], 1, { ...volume, accepted: "3", closed: "3" });
  assert.deepEqual(quoted, { outcome: "calculated", version: 1, ready: "59.97", notReady: "0" });
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, projectId: "object-2" }).outcome, "missing");
  assert.equal(validateContractPrice(price({ price: "-1" })), "invalid_price");
  assert.equal(quoteContractReadiness([price()], 1, { ...volume, closed: "51" }).outcome, "invalid_volume");
  assert.equal(validateContractPrice(price({ end: "2025-12-31" })), "invalid_period");
  assert.equal(quoteContractReadiness([price({ price: "0.000001" })], 1, { ...volume, accepted: "0.000001", closed: "0.000001" }).outcome, "inexact");
});
