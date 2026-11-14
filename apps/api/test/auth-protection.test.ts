import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { authProtection, bindAuthProtection, consumeLogin } from "../src/auth-protection.js";
import { AuthService } from "../src/auth.service.js";
import { hashPassword } from "../src/password.js";
import type { Pool } from "pg";

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
  for (let n = 0; n < 10000; n += 1) protection.takeLogin(`u${n}@flood.test`);
  assert.ok(protection.bucketCount() <= 4096);
  assert.equal(protection.takeLogin("u0@flood.test"), null);
  now += 61_000;
  protection.takeLogin("after@flood.test");
  assert.equal(protection.bucketCount(), 1);
});

test("выдуманные адреса не закрывают первый вход настоящей учётки", () => {
  const protection = authProtection({ install: false });
  for (let n = 0; n < 10000; n += 1) protection.takeLogin(`unknown-${n}@flood.test`, false);
  assert.equal(protection.bucketCount(), 1);
  assert.equal(protection.takeLogin("real@sessii.test", true), null);
  for (let n = 0; n < 2000; n += 1) assert.equal(protection.takeLogin(`person-${n}@sessii.test`, true), null);
  assert.equal(protection.bucketCount(), 2002);
});

test("вход отличает найденную учётку от потока неизвестных адресов", async () => {
  authProtection();
  const stored = hashPassword("synthetic-r41-value");
  const pool = { async query(sql: string, values: unknown[]) {
    if (sql.includes("FROM users")) return { rows: values[0] === "real@sessii.test" ? [{ id: "synthetic-user", email: values[0], name: "QA", password_hash: stored }] : [] };
    return { rows: [] };
  } } as unknown as Pool;
  const service = new AuthService(pool);
  try {
    for (let n = 0; n < 200; n += 1) {
      await assert.rejects(service.login({ email: `unknown-${n}@flood.test`, password: "synthetic-r41-value" }), (error: unknown) => [401, 429].includes((error as { status: number }).status));
    }
    assert.equal((await service.login({ email: "REAL@sessii.test", password: "synthetic-r41-value" })).user.id, "synthetic-user");
  } finally {
    bindAuthProtection({ takeLogin: () => null });
  }
});

test("и dev, и staging entry включают лимит без отдельной договорённости", () => {
  try {
    const protection = authProtection();
    assert.equal(consumeLogin("bound@sessii.test", true), null);
    const parked = authProtection({ install: false });
    for (let n = 0; n < 40; n += 1) parked.takeLogin("bound@sessii.test");
    assert.ok((parked.takeLogin("bound@sessii.test") ?? 0) > 0);
    assert.equal(consumeLogin("bound@sessii.test", true), null);
    for (let n = 0; n < 38; n += 1) assert.equal(consumeLogin("bound@sessii.test", true), null);
    assert.ok((consumeLogin("bound@sessii.test", true) ?? 0) > 0);
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
