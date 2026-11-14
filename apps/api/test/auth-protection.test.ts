import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { authProtection, bindAuthProtection, consumeLogin } from "../src/auth-protection.js";

test("одна почта не закрывает другую, регистр общий, чужой адрес не сбрасывает счётчик", () => {
  let now = 1_000;
  const protection = authProtection({ install: false, now: () => now });
  for (let n = 0; n < 40; n += 1) assert.equal(protection.takeLogin("  A@Sessii.test "), null);
  assert.ok((protection.takeLogin("a@sessii.test") ?? 0) > 0);
  assert.equal(protection.takeLogin("b@sessii.test"), null);
  let passed = 0;
  for (let n = 0; n < 41; n += 1) {
    protection({ path: "/api/v1/auth/login", method: "POST", headers: { "x-forwarded-for": `203.0.113.${n}` } }, { setHeader: () => undefined, status: () => ({ json: () => undefined }) }, () => { passed += 1; });
  }
  assert.equal(passed, 41);
  now += 61_000;
  assert.equal(protection.takeLogin("a@sessii.test"), null);
});

test("случайные почты не раздувают таблицу и просроченные записи уходят", () => {
  let now = 1_000;
  const protection = authProtection({ install: false, now: () => now });
  for (let n = 0; n < 1000; n += 1) protection.takeLogin(`u${n}@flood.test`);
  assert.ok(protection.bucketCount() <= 128);
  assert.equal(protection.takeLogin("u0@flood.test"), null);
  now += 61_000;
  protection.takeLogin("after@flood.test");
  assert.equal(protection.bucketCount(), 1);
});

test("и dev, и staging entry включают лимит без отдельной договорённости", () => {
  try {
    const protection = authProtection();
    assert.equal(consumeLogin("bound@sessii.test"), null);
    const parked = authProtection({ install: false });
    for (let n = 0; n < 40; n += 1) parked.takeLogin("bound@sessii.test");
    assert.ok((parked.takeLogin("bound@sessii.test") ?? 0) > 0);
    assert.equal(consumeLogin("bound@sessii.test"), null);
    for (let n = 0; n < 38; n += 1) assert.equal(consumeLogin("bound@sessii.test"), null);
    assert.ok((consumeLogin("bound@sessii.test") ?? 0) > 0);
    const entry = readFileSync(new URL("../../../deploy/helios-staging/entry.mjs", import.meta.url), "utf8");
    const dev = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    for (const source of [entry, dev]) {
      assert.match(source, /bindAuthProtection\(protection\)/);
      assert.match(source, /app\.use\(protection\)/);
    }
  } finally {
    bindAuthProtection({ takeLogin: () => null });
  }
});
