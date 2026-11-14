import assert from "node:assert/strict";
import test from "node:test";
import { authProtection } from "../src/auth-protection.js";

test("лимит одной почты не закрывает другую и не смотрит на переданный адрес", () => {
  const protection = authProtection();
  for (let n = 0; n < 40; n += 1) assert.equal(protection.takeLogin("A@Sessii.test"), null);
  assert.ok((protection.takeLogin("a@sessii.test") ?? 0) > 0);
  assert.equal(protection.takeLogin("b@sessii.test"), null);
  let passed = 0;
  for (let n = 0; n < 41; n += 1) {
    protection({ path: "/api/v1/auth/login", method: "POST", headers: { "x-forwarded-for": `203.0.113.${n}` } }, { setHeader: () => undefined, status: () => ({ json: () => undefined }) }, () => { passed += 1; });
  }
  assert.equal(passed, 41);
});
