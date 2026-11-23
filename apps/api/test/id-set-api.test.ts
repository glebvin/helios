import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test, { before, after } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/http.js';
import { adminUrl, createPool } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { defaultRouteConfiguration } from '../src/route-config.js';
import { checkHttpContract } from './contract-check.js';

const localPort = 54599;
const expectedPort = process.env.GITHUB_ACTIONS === 'true' ? 54339 : localPort;
const expectedDir = fileURLToPath(new URL(`../../../.data/pg-${expectedPort}`, import.meta.url));
const admin = createPool(adminUrl);
const tenant = randomUUID(), org = randomUUID(), project = randomUUID();
const director = randomUUID(), engineer = randomUUID(), other = randomUUID(), pto = randomUUID();
const users = [director, engineer, other, pto];
let app: INestApplication | undefined, base: string;
const tokens = new Map<string, string>();

before(async () => {
  const actual = (await admin.query(`SELECT inet_server_addr()::text addr, inet_server_port() port, current_setting('data_directory') dir`)).rows[0];
  assert.equal(new URL(adminUrl).hostname, '127.0.0.1');
  if (process.env.GITHUB_ACTIONS !== 'true') assert.equal(String(actual.addr).startsWith('127.0.0.1'), true, actual.addr);
  assert.equal(Number(actual.port), expectedPort);
  if (process.env.GITHUB_ACTIONS === 'true') assert.ok(String(actual.dir).endsWith('codex-api/.data/pg-54339'), actual.dir);
  else assert.equal(realpathSync(actual.dir), realpathSync(expectedDir));
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'ID set','Europe/Moscow')`, [tenant]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя')`, [tenant, org]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Комплект')`, [tenant, project]);
  for (const [user, role, name] of [[director, 'director', 'Руководитель'], [engineer, 'engineer-pto', 'Инженер'], [other, 'engineer-pto', 'Другой инженер'], [pto, 'pto', 'ПТО']] as const) {
    await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [user, `${user}@id-set.test`, name, hashPassword('id-set-local')]);
    await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, user, role]);
    if (role !== 'director') await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, project, user]);
  }
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const user of users) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@id-set.test`, password: 'id-set-local' }) });
    assert.equal(response.status, 201);
    tokens.set(user, (await response.json() as { token: string }).token);
  }
});

after(async () => {
  try { await app?.close(); } finally {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const table of ['id_set_versions', 'project_work_types', 'route_config_versions', 'project_memberships', 'people_command_receipts', 'memberships', 'projects', 'organizations', 'audit_log']) await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
      await client.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
      await client.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`, [users]);
      await client.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await admin.end(); }
  }
});

test('named engineer records one versioned document set for a work type', async () => {
  const created = await send('POST', `/projects/${project}/work-types`, { requestId: randomUUID(), name: 'Кладка', unit: 'м2', requiresRd: false, requiresMaterialControl: false, requiresPredecessorAcceptance: false, requiresId: true }, director);
  const workType = created.body.id as string;
  const empty = await send('GET', `/projects/${project}/id-sets`, undefined, engineer);
  assert.equal(empty.body.items[0].version, 0);
  assert.deepEqual(empty.body.items[0].titles, []);
  const open = await send('POST', `/projects/${project}/work-types/${workType}/id-set`, { requestId: randomUUID(), expectedVersion: 0, titles: ['Схема'] }, other);
  assert.equal(open.status, 201, JSON.stringify(open.body));
  const configuration = defaultRouteConfiguration();
  configuration.routes.find((item) => item.documentType === 'documentation-list')!.preparers[0]!.userId = engineer;
  await admin.query(`INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,1,1,$3,$4)`, [tenant, project, JSON.stringify(configuration), director]);
  const refused = await send('POST', `/projects/${project}/work-types/${workType}/id-set`, { requestId: randomUUID(), expectedVersion: 1, titles: ['Схема', 'Акт'] }, other);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'route_denied');
  const reader = await send('POST', `/projects/${project}/work-types/${workType}/id-set`, { requestId: randomUUID(), expectedVersion: 1, titles: ['Схема', 'Акт'] }, pto);
  assert.equal(reader.status, 403);
  assert.equal(reader.body.error, 'role_denied');
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM id_set_versions WHERE tenant_id=$1 AND work_type_id=$2`, [tenant, workType])).rows[0].n), 1);
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND status IS NULL`, [tenant])).rows[0].n), 0);
  const body = { requestId: randomUUID(), expectedVersion: 1, titles: ['Схема', 'Акт'] };
  const recorded = await send('POST', `/projects/${project}/work-types/${workType}/id-set`, body, engineer);
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
  assert.equal(recorded.body.version, 2);
  assert.deepEqual(await send('POST', `/projects/${project}/work-types/${workType}/id-set`, body, engineer), recorded);
  const seen = await send('GET', `/projects/${project}/id-sets`, undefined, pto);
  assert.deepEqual(seen.body.items[0].titles, ['Схема', 'Акт']);
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM id_set_versions WHERE tenant_id=$1 AND work_type_id=$2`, [tenant, workType])).rows[0].n), 2);
});

async function send(method: string, path: string, body: unknown, user: string) {
  const response = await fetch(`${base}/api/v1${path}`, { method, headers: { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenant, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  checkHttpContract(`/api/v1${path}`, method, response.status, payload, response.headers);
  if (!(method === 'POST' && response.status !== 201)) assert.equal(response.status, method === 'POST' ? 201 : 200, JSON.stringify(payload));
  return { status: response.status, body: payload };
}
