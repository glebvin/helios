// Session revocation and per-account login limit. Refuses every port except this contour.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from '../apps/api/src/password.ts';

const api = process.env.HELIOS_R41_API ?? 'http://127.0.0.1:4379';
const adminUrl = new URL(process.env.HELIOS_R41_ADMIN_DATABASE_URL ?? 'postgres://helios:helios@127.0.0.1:54441/helios');
assert.equal(adminUrl.hostname, '127.0.0.1');
assert.equal(adminUrl.port, '54441');
assert.equal(new URL(api).port, '4379');
const tenantId = randomUUID();
const password = `Local!${randomBytes(7).toString('hex')}`;
const first = { id: randomUUID(), email: `rp.${tenantId.slice(0, 6)}@r41.test` };
const second = { id: randomUUID(), email: `rp2.${tenantId.slice(0, 6)}@r41.test` };
const db = new pg.Client({ connectionString: adminUrl.href });
await db.connect();
assert.equal(String((await db.query('SELECT inet_server_port() port')).rows[0].port), '54441');
try {
  await db.query('BEGIN');
  await db.query('INSERT INTO tenants(id, name) VALUES($1, $2)', [tenantId, 'Изолированные сессии R41']);
  for (const account of [first, second]) {
    await db.query('INSERT INTO users(id, email, name, password_hash) VALUES($1, $2, $3, $4)', [account.id, account.email, 'Руководитель сессии', hashPassword(password)]);
    await db.query('INSERT INTO memberships(tenant_id, user_id, role) VALUES($1, $2, $3)', [tenantId, account.id, 'director']);
  }
  await db.query('COMMIT');
  await mkdir('.data/r41', { recursive: true });
  await writeFile('.data/r41/access.md', `# Локальные входы R41\n\nНе публиковать.\n\n- ${first.email} / ${password}\n- ${second.email} / ${password}\n`, { mode: 0o600 });
  await chmod('.data/r41/access.md', 0o600);

  const opened = await login(first.email, password);
  assert.equal(opened.status, 201);
  const token = opened.body.token;
  const goodbye = await fetch(`${api}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId } });
  assert.equal(goodbye.status, 201);
  const reused = await fetch(`${api}/api/v1/me`, { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId } });
  assert.equal(reused.status, 401);

  let limited = null;
  let accepted = 1;
  while (accepted < 40) {
    const attempt = await login(accepted % 2 === 0 ? first.email : first.email.toUpperCase(), password);
    assert.equal(attempt.status, 201);
    accepted += 1;
  }
  limited = await login(first.email.toUpperCase(), `${password}-no`);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'auth_rate_limited');
  assert.ok(Number(limited.retryAfter) > 0);
  const other = await login(second.email, password, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(other.status, 201);
  const still = await db.query('SELECT count(*)::int AS n FROM users WHERE id = ANY($1)', [[first.id, second.id]]);
  assert.equal(still.rows[0].n, 2);
  console.log(JSON.stringify({ ok: true, revoked: 401, otherAccount: 201, rateLimited: true }));
} catch (error) {
  await mkdir('.data/r41', { recursive: true });
  await writeFile('.data/r41/failure.txt', error instanceof Error ? error.stack ?? error.message : String(error));
  throw error;
} finally {
  await db.end();
}

async function login(email, value, headers = {}) {
  const response = await fetch(`${api}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email, password: value }),
  });
  const body = await response.json();
  return { status: response.status, body, retryAfter: response.headers.get('retry-after') };
}
