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

const qaPort = Number(process.env.HELIOS_PRIMARY_QA_DB_PORT ?? 54597);
assert.ok([54583, 54597].includes(qaPort));
const expectedPort = process.env.GITHUB_ACTIONS === 'true' ? 54339 : qaPort;
const expectedDir = fileURLToPath(new URL(`../../../.data/pg-${qaPort}`, import.meta.url));
const admin = createPool(adminUrl);
const tenant = randomUUID(), org = randomUUID(), project = randomUUID();
const master = randomUUID(), hr = randomUUID(), other = randomUUID();
const users = [master, hr, other];
const openDay = '2026-11-03', namedDay = '2026-11-04';
const hash = 'a'.repeat(64);
let app: INestApplication | undefined, base: string;
const tokens = new Map<string, string>();

before(async () => {
  const actual = (await admin.query(`SELECT inet_server_addr()::text addr, inet_server_port() port, current_setting('data_directory') dir`)).rows[0];
  assert.equal(new URL(adminUrl).hostname, '127.0.0.1');
  if (process.env.GITHUB_ACTIONS !== 'true') assert.equal(String(actual.addr).startsWith('127.0.0.1'), true, actual.addr);
  assert.equal(Number(actual.port), expectedPort);
  if (process.env.GITHUB_ACTIONS === 'true') assert.ok(String(actual.dir).endsWith('codex-api/.data/pg-54339'), actual.dir);
  else assert.equal(realpathSync(actual.dir), realpathSync(expectedDir));
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Timesheet route','Europe/Moscow')`, [tenant]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя')`, [tenant, org]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Табель')`, [tenant, project]);
  for (const [user, role, name] of [[master, 'master', 'Мастер'], [hr, 'hr', 'Служба персонала'], [other, 'hr', 'Другая служба']] as const) {
    await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [user, `${user}@timesheet-route.test`, name, hashPassword('timesheet-route-local')]);
    await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, user, role]);
    if (role === 'hr') await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, project, user]);
  }
  for (const day of [openDay, namedDay]) {
    const request = randomUUID();
    await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`, [tenant, master, request]);
    await admin.query(`INSERT INTO primary_day_closes(tenant_id,project_id,organization_id,day,version,source_hash,snapshot,actor_user_id,request_id) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)`, [tenant, project, org, day, hash, JSON.stringify({ timezone: 'Europe/Moscow', employees: [] }), master, request]);
  }
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const user of [hr, other]) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@timesheet-route.test`, password: 'timesheet-route-local' }) });
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
      for (const table of ['consolidated_time_heads', 'consolidated_time_revisions', 'primary_day_closes', 'route_config_versions', 'project_memberships', 'people_command_receipts', 'memberships', 'projects', 'organizations', 'audit_log']) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
      }
      await client.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
      await client.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`, [users]);
      await client.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await admin.end(); }
  }
});

test('named personnel approver is the only one who issues the consolidated sheet', async () => {
  const open = await post(openDay, { requestId: randomUUID(), expectedRevision: 0 }, other);
  assert.equal(open.status, 201, JSON.stringify(open.body));
  const configuration = defaultRouteConfiguration();
  configuration.routes.find(item => item.documentType === 'consolidated-timesheet')!.approvers[0]!.userId = hr;
  await admin.query(`INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,1,1,$3,$4)`, [tenant, project, JSON.stringify(configuration), hr]);
  const refused = await post(namedDay, { requestId: randomUUID(), expectedRevision: 0 }, other);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'route_denied');
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM consolidated_time_revisions WHERE tenant_id=$1 AND day=$2`, [tenant, namedDay])).rows[0].n), 0);
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND status IS NULL`, [tenant])).rows[0].n), 0);
  const body = { requestId: randomUUID(), expectedRevision: 0 };
  const issued = await post(namedDay, body, hr);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  assert.deepEqual(await post(namedDay, body, hr), issued);
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM consolidated_time_revisions WHERE tenant_id=$1 AND day=$2`, [tenant, namedDay])).rows[0].n), 1);
  const again = await post(namedDay, { requestId: randomUUID(), expectedRevision: 0 }, other);
  assert.equal(again.status, 403);
  assert.equal(again.body.error, 'route_denied');
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM consolidated_time_revisions WHERE tenant_id=$1 AND day=$2`, [tenant, namedDay])).rows[0].n), 1);
});

async function post(day: string, body: unknown, user: string) {
  const response = await fetch(`${base}/api/v1/projects/${project}/time/consolidated/${day}/revisions`, { method: 'POST', headers: { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenant, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  const result = { status: response.status, body: payload };
  checkHttpContract(`/api/v1/projects/${project}/time/consolidated/${day}/revisions`, 'POST', response.status, result.body, response.headers);
  return result;
}
