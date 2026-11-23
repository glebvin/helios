import assert from 'node:assert/strict';
import { randomUUID as id } from 'node:crypto';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { createPool, adminUrl } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { AllExceptionsFilter } from '../src/http.js';
import { checkHttpContract } from './contract-check.js';

const admin = createPool(adminUrl);
const tenant = id(), director = id(), sub = id(), empty = id();
const ownOrg = id(), otherOrg = id(), own = id(), mate = id(), foreign = id();
let app: INestApplication | undefined, base = '';
const tokens = new Map<string, string>();

async function call(user: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenant, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  checkHttpContract(`/api/v1${path}`, method, response.status, payload, response.headers);
  return { status: response.status, body: payload };
}

test.before(async () => {
  const port = (await admin.query('SELECT inet_server_port() AS port')).rows[0].port;
  const directory = (await admin.query('SHOW data_directory')).rows[0].data_directory as string;
  assert.equal(String(port), process.env.CI ? '54339' : '54611');
  if (!process.env.CI) assert.match(directory, /svoi-rabotniki\/\.data\/pg-54611$/);
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Subcontractor fixture','Europe/Moscow')`, [tenant]);
  for (const [user, email] of [[director, 'director'], [sub, 'sub'], [empty, 'empty']] as const) {
    await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`, [user, `${email}@svoi.test`, hashPassword('svoi-pass')]);
  }
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director'),($1,$3,'subcontractor'),($1,$4,'subcontractor')`, [tenant, director, sub, empty]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'subcontractor','Own'),($1,$3,'own','Other')`, [tenant, ownOrg, otherOrg]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name,user_id) VALUES($1,$2,$3,'Свой',$4)`, [tenant, own, ownOrg, sub]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Напарник'),($1,$4,$5,'Чужой')`, [tenant, mate, ownOrg, foreign, otherOrg]);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const [user, email] of [[director, 'director'], [sub, 'sub'], [empty, 'empty']] as const) {
    const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${email}@svoi.test`, password: 'svoi-pass' }) });
    assert.equal(login.status, 201);
    tokens.set(user, (await login.json()).token);
  }
});

test.after(async () => {
  try { await app?.close(); } finally {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const table of ['employees', 'organizations', 'memberships']) await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
      await client.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [[director, sub, empty]]);
      await client.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[director, sub, empty]]);
      await client.query('DELETE FROM tenants WHERE id=$1', [tenant]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await admin.end(); }
  }
});

test('a subcontractor reads only workers of their own employer', async () => {
  const list = await call(sub, '/employees');
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((item: { fullName: string }) => item.fullName).sort(), ['Напарник', 'Свой']);
  const mateRead = await call(sub, `/employees/${mate}`);
  assert.equal(mateRead.status, 200);
  assert.equal(mateRead.body.fullName, 'Напарник');
  const hidden = await call(sub, `/employees/${foreign}`);
  assert.equal(hidden.status, 404);
  const denied = await call(sub, '/employees', { requestId: id(), fullName: 'Новый', organizationId: ownOrg });
  assert.equal(denied.status, 403);
  const none = await call(empty, '/employees');
  assert.equal(none.status, 200);
  assert.equal(none.body.total, 0);
  const directorList = await call(director, '/employees');
  assert.equal(directorList.body.total, 3);
  await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`, [tenant, sub]);
  const revoked = await call(sub, '/employees');
  assert.equal(revoked.status, 403);
});
