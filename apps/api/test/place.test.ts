import assert from "node:assert/strict";
import test from "node:test";
import { parsePlace } from "../src/place.js";

test("parsePlace keeps a map point and a manual address", () => {
  assert.deepEqual(parsePlace({ address: "  Учебная, 1  ", latitude: 55.7512444, longitude: 37.6184234 }), {
    address: "Учебная, 1",
    latitude: 55.751244,
    longitude: 37.618423,
  });
});

test("parsePlace rejects a point outside the earth", () => {
  assert.equal(parsePlace({ address: "", latitude: 91, longitude: 0 }), null);
  assert.equal(parsePlace({ address: "", latitude: 0, longitude: 181 }), null);
  assert.equal(parsePlace({ address: "", latitude: "нет", longitude: 0 }), null);
});
