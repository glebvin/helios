import assert from "node:assert/strict";
import test from "node:test";
import { checkPassword, hashPassword, hashPasswordCurrent, passwordHashInFlight, verifyPassword } from "../src/password.js";

test("старый хеш принимается и помечается к замене", async () => {
  const stored = hashPassword("old-password-value");
  assert.deepEqual(await checkPassword("old-password-value", stored), { ok: true, stale: true });
  assert.equal((await checkPassword("wrong-password-value", stored)).ok, false);
});

test("новый хеш проверяется и чужая цена не считается", async () => {
  const stored = await hashPasswordCurrent("new-password-value");
  assert.match(stored, /^scrypt:2:131072:8:1:[0-9a-f]+:[0-9a-f]{64}$/);
  assert.deepEqual(await checkPassword("new-password-value", stored), { ok: true, stale: false });
  assert.equal(verifyPassword("new-password-value", stored), true, "previous AuthService can verify an upgraded row through the compatibility bridge");
  assert.equal(verifyPassword("wrong-password-value", stored), false);
  assert.equal((await checkPassword("new-password-value", "scrypt:2:1:8:1:abcd:abcd")).ok, false);
});

test("вычисления ограничены настройкой, цикл событий не встаёт", async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 10);
  const pending = ["a", "b", "c", "d"].map((item) => hashPasswordCurrent(`parallel-${item}-password`));
  assert.equal(passwordHashInFlight(), Number(process.env.HELIOS_PASSWORD_HASH_CONCURRENCY ?? 2));
  await Promise.all(pending);
  clearInterval(timer);
  assert.ok(ticks >= 1);
});
