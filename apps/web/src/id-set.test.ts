import test from "node:test";
import assert from "node:assert/strict";
import { idSetError, titlesOf } from "./id-set.ts";

test("a named engineer is told apart from a role refusal", () => {
  assert.equal(idSetError(403, "route_denied"), "Комплект записывает назначенный инженер ПТО.");
  assert.equal(idSetError(403, "role_denied"), "Этой роли запись комплекта недоступна.");
  assert.deepEqual(titlesOf(" Акт \n\nСхема\nАкт "), ["Акт", "Схема", "Акт"]);
});
