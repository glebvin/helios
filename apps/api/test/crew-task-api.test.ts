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
const tenant = id(), director = id(), project = id(), other = id(), org = id(), otherOrg = id();
const zone = id(), workType = id(), first = id(), second = id(), third = id(), fourth = id(), crew = id(), mixed = id(), foreignCrew = id();
let app: INestApplication | undefined, base = '', token = '';

async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenant, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  checkHttpContract(`/api/v1${path}`, method, response.status, payload, response.headers);
  return { status: response.status, body: payload };
}

test.before(async () => {
  const port = (await admin.query('SELECT inet_server_port() AS port')).rows[0].port;
  const directory = (await admin.query('SHOW data_directory')).rows[0].data_directory as string;
  assert.equal(String(port), process.env.CI ? '54339' : '54607');
  if (!process.env.CI) assert.match(directory, /brigadnoe-zadanie\/\.data\/pg-54607$/);
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Crew fixture','Europe/Moscow')`, [tenant]);
  await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`, [director, `${director}@crew.test`, hashPassword('crew-task-pass')]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`, [tenant, director]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own'),($1,$3,'own','Other')`, [tenant, org, otherOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Object'),($1,$3,'Other')`, [tenant, project, other]);
  await admin.query(`INSERT INTO project_work_zones(tenant_id,project_id,id,name) VALUES($1,$2,$3,'Zone')`, [tenant, project, zone]);
  await admin.query(`INSERT INTO project_work_types(tenant_id,project_id,id,name,unit,requires_rd,requires_material_control,requires_predecessor_acceptance,requires_id) VALUES($1,$2,$3,'Masonry','m2',false,false,false,false)`, [tenant, project, workType]);
  for (const [employee, organization, name] of [[first, org, 'First'], [second, org, 'Second'], [third, otherOrg, 'Third'], [fourth, org, 'Fourth']] as const) {
    await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,$4)`, [tenant, employee, organization, name]);
    await admin.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id) VALUES($1,$2,$3)`, [tenant, project, employee]);
  }
  await admin.query(`INSERT INTO crews(tenant_id,project_id,id,name) VALUES($1,$2,$3,'Mason crew'),($1,$2,$4,'Mixed crew'),($1,$5,$6,'Foreign crew')`, [tenant, project, crew, mixed, other, foreignCrew]);
  for (const [crewId, employee] of [[crew, first], [crew, second], [mixed, fourth], [mixed, third]] as const) {
    await admin.query(`INSERT INTO crew_members(tenant_id,project_id,crew_id,employee_id,status) VALUES($1,$2,$3,$4,'active')`, [tenant, project, crewId, employee]);
  }
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${director}@crew.test`, password: 'crew-task-pass' }) });
  assert.equal(login.status, 201);
  token = (await login.json()).token;
});

test.after(async () => {
  try { await app?.close(); } finally {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const table of ['crew_volume_submissions', 'people_command_receipts', 'audit_log', 'daily_tasks', 'crew_members', 'crews', 'employee_project_assignments', 'project_work_zones', 'project_work_types', 'memberships', 'employees', 'organizations', 'projects']) {
        await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
      }
      await client.query('DELETE FROM sessions WHERE user_id=$1', [director]);
      await client.query('DELETE FROM users WHERE id=$1', [director]);
      await client.query('DELETE FROM tenants WHERE id=$1', [tenant]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await admin.end(); }
  }
});

function plan(crewId: string) {
  return { zoneId: zone, workTypeId: workType, title: 'Кладка', workDate: '2027-03-02', plannedQuantity: '17', crewId, responsibleUserId: director, plannedStart: '2027-03-02T08:00:00+03:00', plannedEnd: '2027-03-02T17:00:00+03:00', rdReference: null };
}

test('one crew task keeps one volume and one membership snapshot', async () => {
  const createId = id();
  const created = await call(`/projects/${project}/crew-tasks`, { requestId: createId, ...plan(crew) });
  assert.equal(created.status, 201);
  assert.equal(created.body.plannedQuantity, '17.000');
  assert.equal(created.body.crew.members.length, 2);
  assert.equal(created.body.crew.volume, null);
  assert.deepEqual(created.body.crew.members.map((member: { fullName: string }) => member.fullName).sort(), ['First', 'Second']);
  const replay = await call(`/projects/${project}/crew-tasks`, { requestId: createId, ...plan(crew) });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, created.body);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM daily_tasks WHERE tenant_id=$1 AND crew_id=$2`, [tenant, crew])).rows[0].n, 1);

  await admin.query(`UPDATE crew_members SET status='revoked' WHERE tenant_id=$1 AND crew_id=$2 AND employee_id=$3`, [tenant, crew, second]);
  const read = await call(`/projects/${project}/tasks/${created.body.id}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.crew.members.length, 2);
  assert.equal(read.body.crew.name, 'Mason crew');

  const volumeId = id();
  const volume = await call(`/projects/${project}/tasks/${created.body.id}/crew-volume`, { requestId: volumeId, expectedVersion: created.body.version, quantity: '17' });
  assert.equal(volume.status, 201);
  assert.equal(volume.body.quantity, '17.000');
  const again = await call(`/projects/${project}/tasks/${created.body.id}/crew-volume`, { requestId: id(), expectedVersion: created.body.version, quantity: '17' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_submitted');
  const same = await call(`/projects/${project}/tasks/${created.body.id}/crew-volume`, { requestId: volumeId, expectedVersion: created.body.version, quantity: '17' });
  assert.equal(same.status, 201);
  assert.deepEqual(same.body, volume.body);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM crew_volume_submissions WHERE tenant_id=$1`, [tenant])).rows[0].n, 1);
  const stale = await call(`/projects/${project}/tasks/${created.body.id}/crew-volume`, { requestId: id(), expectedVersion: created.body.version + 1, quantity: '18' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error, 'stale_version');
  const seen = await call(`/projects/${project}/tasks/${created.body.id}`);
  assert.equal(seen.body.crew.volume, '17.000');

  const mixedResult = await call(`/projects/${project}/crew-tasks`, { requestId: id(), ...plan(mixed) });
  assert.equal(mixedResult.status, 422);
  assert.equal(mixedResult.body.error, 'mixed_employer');
  const foreign = await call(`/projects/${project}/crew-tasks`, { requestId: id(), ...plan(foreignCrew) });
  assert.equal(foreign.status, 404);

  const personalBody = { requestId: id(), zoneId: zone, workTypeId: workType, title: 'Личное', workDate: '2027-03-03', plannedQuantity: '4', assigneeEmployeeId: first, responsibleUserId: director, plannedStart: '2027-03-03T08:00:00+03:00', plannedEnd: '2027-03-03T12:00:00+03:00', rdReference: null };
  const saved = await call(`/projects/${project}/tasks`, personalBody);
  assert.equal(saved.status, 201);
  assert.equal('crew' in saved.body, false);
  const personalRead = await call(`/projects/${project}/tasks/${saved.body.id}`);
  assert.equal('crew' in personalRead.body, false);
  const refused = await call(`/projects/${project}/tasks/${saved.body.id}/crew-volume`, { requestId: id(), expectedVersion: saved.body.version, quantity: '4' });
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, 'not_crew_task');
  assert.equal((await call(`/projects/${project}/tasks`, { ...personalBody, requestId: id(), crewId: crew })).status, 400);
});
