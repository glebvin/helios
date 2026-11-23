import assert from "node:assert/strict";
import test from "node:test";
import { boardVolumeLabel, masterDecisionMap } from "./board-volume.ts";

test("неполная страница решений не подменяет карточку", () => {
  assert.equal(masterDecisionMap([{ reportId: "a", totalAcceptedQuantity: "17.000" }], 2), null);
});

test("без решения мастера подпись прежняя", () => {
  const map = masterDecisionMap([{ reportId: "a", totalAcceptedQuantity: null }], 1);
  assert.equal(boardVolumeLabel("18.000", "м2", map?.a), "18.000 м2 · не принято");
  assert.equal(boardVolumeLabel("18.000", "м2", undefined, true), "Сообщено 18.000 м2. Не принято.");
});

test("записанное мастером количество видно на карточке", () => {
  const map = masterDecisionMap([{ reportId: "a", totalAcceptedQuantity: "17.000" }, { reportId: "b", totalAcceptedQuantity: "0.000" }], 2);
  assert.equal(boardVolumeLabel("18.000", "м2", map?.a), "18.000 м2 · принято мастером 17.000");
  assert.equal(boardVolumeLabel("18.000", "м2", map?.b, true), "Сообщено 18.000 м2. Принято мастером 0.000.");
});
