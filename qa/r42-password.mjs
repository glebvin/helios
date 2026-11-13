// Password upgrade on a disposable database. Refuses every port except this contour.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, chmod } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from '../apps/api/src/password.ts';

const api = process.env.HELIOS_R42_API ?? 'http://127.0.0.1:4375';
const adminUrl = new URL(process.env.HELIOS_R42_ADMIN_DATABASE_URL ?? 'postgres://helios:helios@127.0.0.1:54435/helios');
assert.equal(adminUrl.hostname, '127.0.0.1');
const review = process.env.HELIOS_RELEASE_REVIEW === '1';
const dbPort = review ? '54360' : '54435';
assert.equal(adminUrl.port, dbPort);
assert.equal(new URL(api).hostname, '127.0.0.1');
assert.equal(new URL(api).port, review ? '14370' : '4375');
const out = '.data/r42';
await mkdir(out, { recursive: true });
const tenantId = randomUUID();
const userId = randomUUID();
const email = `rp.${tenantId.slice(0, 6)}@r42.test`;
const password = `Local!${randomBytes(7).toString('hex')}`;
const db = new pg.Client({ connectionString: adminUrl.href });
await db.connect();
assert.equal(String((await db.query('SELECT inet_server_port() port')).rows[0].port), dbPort);
try {
  await db.query('BEGIN');
  await db.query('INSERT INTO tenants(id, name) VALUES($1, $2)', [tenantId, 'Изолированные пароли R42']);
  await db.query('INSERT INTO users(id, email, name, password_hash) VALUES($1, $2, $3, $4)', [userId, email, 'Руководитель пароля', hashPassword(password)]);
  await db.query('INSERT INTO memberships(tenant_id, user_id, role) VALUES($1, $2, $3)', [tenantId, userId, 'director']);
  await db.query('COMMIT');
  await writeFile(`${out}/access.md`, `# Локальный вход R42\n\nНе публиковать.\n\n- ${email} / ${password}\n`, { mode: 0o600 });
  await chmod(`${out}/access.md`, 0o600);

  const first = await login(password);
  assert.equal(first.status, 201);
  assert.equal(typeof first.body.token, 'string');
  assert.equal(JSON.stringify(first.body).includes(password), false);
  assert.equal(JSON.stringify(first.body).includes('password_hash'), false);
  const upgraded = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  assert.match(upgraded.rows[0].password_hash, /^scrypt:2:131072:8:1:/);

  const second = await login(password);
  assert.equal(second.status, 201);
  const kept = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  assert.equal(kept.rows[0].password_hash, upgraded.rows[0].password_hash);

  const wrong = await login(`${password}-no`);
  assert.equal(wrong.status, 401);
  const afterWrong = await db.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  assert.equal(afterWrong.rows[0].password_hash, upgraded.rows[0].password_hash);

  const parallel = await Promise.all([login(password), login(password), login(password), login(password)]);
  assert.deepEqual(parallel.map((item) => item.status), [201, 201, 201, 201]);

  let requests = 7;
  let limited = null;
  while (requests < 41) {
    const attempt = await login(password);
    requests += 1;
    if (requests < 41) assert.equal(attempt.status, 201);
    else limited = attempt;
  }
  assert.equal(requests, 41);
  assert.equal(limited?.status, 429);
  assert.equal(limited?.body.error, 'auth_rate_limited');
  const still = await db.query('SELECT email, password_hash FROM users WHERE id = $1', [userId]);
  assert.equal(still.rows[0].email, email);
  assert.equal(still.rows[0].password_hash, upgraded.rows[0].password_hash);
  console.log(JSON.stringify({ ok: true, upgraded: 'scrypt:2', parallel: 4, rateLimited: true, accountRemains: true }));
} catch (error) {
  await writeFile(`${out}/failure.txt`, error instanceof Error ? error.stack ?? error.message : String(error));
  throw error;
} finally {
  await db.end();
}

async function login(value) {
  const response = await fetch(`${api}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: value }),
  });
  const body = await response.json();
  return { status: response.status, body };
}
