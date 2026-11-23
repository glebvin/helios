import assert from "node:assert/strict";
import test from "node:test";
import { personIntervalFacts } from "./person-intervals.ts";

const source = (breakMs: string, downtimeMs: string, hasOpenIntervals = false) => ({ totals: { breakMs, downtimeMs }, hasOpenIntervals });

test("день без интервалов не показывает ноль", () => {
  assert.deepEqual(personIntervalFacts({ recorded: false, source: source("0", "0") }), {
    breakLabel: "—",
    downtimeLabel: "—",
    note: "За этот день сервер не записал интервалы.",
  });
});

test("записанные ноль и простой остаются разными", () => {
  assert.deepEqual(personIntervalFacts({ recorded: true, source: source("0", "90000") }), {
    breakLabel: "0 мин",
    downtimeLabel: "1 мин",
    note: "Это записанные интервалы дня, не утверждённые часы.",
  });
});

test("открытый интервал не выглядит закрытым", () => {
  assert.equal(personIntervalFacts({ recorded: true, source: source("0", "0", true) }).note, "Есть открытый интервал: длительность ещё растёт.");
});
