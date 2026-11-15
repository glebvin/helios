import assert from 'node:assert/strict';
import { randomUUID as id } from 'node:crypto';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { createPool, adminUrl } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { AllExceptionsFilter } from '../src/http.js';

const admin = createPool(adminUrl);
const restricted = createPool();
const tenant = id(), foreign = id(), project = id(), other = id(), foreignProject = id();
const director = id(), cost = id(), second = id(), worker = id(), outsider = id();
const users = [director, cost, second, worker, outsider];
const tokens = new Map<string, string>();
let app: INestApplication | undefined, base: string, plaster: { id: string }, zero: { id: string }, missing: { id: string }, edge: { id: string };
const command = (body: Record<string, unknown>) => ({ requestId: id(), ...body });

async function req(path: string, body: unknown, user = cost, method = body === undefined ? 'GET' : 'POST', tenantId = tenant) {
  const response = await fetch(`${base}/api/v1${path}`, {
    method, headers: { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenantId, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}
function shift(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

test.before(async () => {
  const password = hashPassword('price-password');
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Price fixture','Europe/Moscow'),($2,'Foreign prices','UTC')`, [tenant, foreign]);
  for (const user of users) await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`, [user, `${user}@prices.test`, password]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director'),($1,$3,'cost'),($1,$4,'cost'),($1,$5,'worker')`, [tenant, director, cost, second, worker]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'cost')`, [foreign, outsider]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Дом'),($1,$3,'Чужой объект'),($4,$5,'Foreign house')`, [tenant, project, other, foreign, foreignProject]);
  await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3),($1,$2,$4),($5,$6,$7)`, [tenant, project, cost, second, foreign, foreignProject, outsider]);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const user of users) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@prices.test`, password: 'price-password' }) });
    assert.equal(response.status, 201);
    tokens.set(user, (await response.json()).token);
  }
  const type = (name: string) => req(`/projects/${project}/work-types`, command({ name, unit: 'м²', requiresRd: false, requiresMaterialControl: false, requiresPredecessorAcceptance: false, requiresId: false }), director);
  plaster = (await type('Штукатурка')).body;
  zero = (await type('Нулевая')).body;
  missing = (await type('Без цены')).body;
  edge = (await type('Граница')).body;
  assert.equal(plaster.id !== undefined, true, JSON.stringify(plaster));
});

test.after(async () => {
  try { await app?.close(); } finally {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const table of ['contract_price_revisions', 'project_work_types', 'project_memberships', 'people_command_receipts', 'projects', 'memberships', 'audit_log']) {
        if ((await client.query(`SELECT to_regclass($1) name`, [table])).rows[0].name) await client.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`, [[tenant, foreign]]);
      }
      await client.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`, [[tenant, foreign]]);
      await client.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`, [users]);
      await client.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await Promise.all([admin.end(), restricted.end()]); }
  }
});

test('cost records an immutable contract price, keeps history, and refuses everyone else', async () => {
  const path = `/projects/${project}/contract-prices`;
  assert.equal((await restricted.query(`SELECT has_table_privilege(current_user,'contract_price_revisions','UPDATE') AS allowed`)).rows[0].allowed, false);
  assert.equal((await restricted.query(`SELECT has_table_privilege(current_user,'contract_price_revisions','DELETE') AS allowed`)).rows[0].allowed, false);
  const projects = await req('/contract-prices/projects', undefined);
  assert.equal(projects.status, 200);
  assert.deepEqual(projects.body.projects.map((item: { id: string }) => item.id), [project]);
  const empty = await req(path, undefined);
  const bare = empty.body.workTypes.find((item: { id: string }) => item.id === missing.id);
  assert.equal(bare.acting, null);
  assert.deepEqual(bare.revisions, []);
  const firstBody = command({ workTypeId: plaster.id, price: '19.99', start: '2026-01-01', end: '2026-06-30', expectedVersion: 0 });
  const first = await req(path, firstBody);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.price, '19.99');
  assert.equal(first.body.unit, 'м²');
  assert.equal(first.body.version, 1);
  const replay = await req(path, firstBody);
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, first.body);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM contract_price_revisions WHERE work_type_id=$1`, [plaster.id])).rows[0].n, 1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND details->>'requestId'=$2`, [tenant, firstBody.requestId])).rows[0].n, 1);
  const changed = await req(path, { ...firstBody, price: '20' });
  assert.equal(changed.status, 409);
  assert.equal(changed.body.error, 'idempotency_payload_mismatch');
  const overlap = await req(path, command({ workTypeId: plaster.id, price: '30', start: '2026-06-01', end: '2026-12-31', expectedVersion: 1 }));
  assert.equal(overlap.status, 409);
  assert.equal(overlap.body.error, 'price_period');
  const next = command({ workTypeId: plaster.id, price: '30.5', start: '2026-07-01', end: '2026-12-31', expectedVersion: 1 });
  const stale = command({ workTypeId: plaster.id, price: '31', start: '2027-01-01', end: '2027-01-31', expectedVersion: 1 });
  const [saved, raced] = await Promise.all([req(path, next), req(path, stale)]);
  const outcomes = [saved, raced].sort((left, right) => left.status - right.status);
  assert.deepEqual(outcomes.map((item) => item.status), [201, 409]);
  assert.equal(outcomes[1].body.error, 'stale_version');
  const read = await req(path, undefined, second);
  const line = read.body.workTypes.find((item: { id: string }) => item.id === plaster.id);
  assert.equal(read.status, 200);
  assert.equal(line.revisions.length, 2);
  assert.equal(line.revisions[0].price, '19.99');
  assert.equal(line.revisions[1].price, '30.5');
  assert.equal(line.headVersion, 2);
  const asOf = read.body.asOf as string;
  const zeroed = await req(path, command({ workTypeId: zero.id, price: '0', start: '2020-01-01', end: '2099-12-31', expectedVersion: 0 }));
  assert.equal(zeroed.status, 201);
  assert.equal(zeroed.body.price, '0');
  const edged = await req(path, command({ workTypeId: edge.id, price: '1.5', start: asOf, end: asOf, expectedVersion: 0 }));
  assert.equal(edged.status, 201, JSON.stringify(edged.body));
  const after = await req(path, undefined);
  const zeroLine = after.body.workTypes.find((item: { id: string }) => item.id === zero.id);
  const edgeLine = after.body.workTypes.find((item: { id: string }) => item.id === edge.id);
  const missingLine = after.body.workTypes.find((item: { id: string }) => item.id === missing.id);
  assert.equal(zeroLine.acting.price, '0');
  assert.equal(edgeLine.acting.version, 1);
  assert.equal(edgeLine.acting.start, asOf);
  assert.equal(missingLine.acting, null);
  assert.equal((await req(path, command({ workTypeId: edge.id, price: '1', start: shift(asOf, -1), end: shift(asOf, -1), expectedVersion: 1 }))).status, 201);
  assert.equal((await req(path, command({ workTypeId: plaster.id, price: '-1', start: '2028-01-01', end: '2028-01-02', expectedVersion: 2 }))).body.error, 'invalid_price');
  assert.equal((await req(path, command({ workTypeId: plaster.id, price: '1.0000001', start: '2028-01-01', end: '2028-01-02', expectedVersion: 2 }))).status, 400);
  assert.equal((await req(path, command({ workTypeId: plaster.id, price: '1', start: '2028-02-31', end: '2028-03-01', expectedVersion: 2 }))).status, 400);
  for (const [user, target, code] of [[director, path, 403], [worker, path, 403], [cost, `/projects/${other}/contract-prices`, 403], [outsider, path, 403]] as const) {
    const denied = await req(target, undefined, user, 'GET', user === outsider ? foreign : tenant);
    assert.equal(denied.status, code, JSON.stringify(denied.body));
  }
  assert.equal((await req('/employees', undefined)).status, 403);
  assert.equal((await req('/projects', undefined)).status, 403);
  assert.equal((await req(`/projects/${project}/work-types`, undefined)).status, 403);
});
