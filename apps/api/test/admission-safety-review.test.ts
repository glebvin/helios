import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID as id } from 'node:crypto';
import test, { before, after } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/http.js';
import { adminUrl, createPool } from '../src/db.js';
import { hashPassword } from '../src/password.js';
import { checkHttpContract } from './contract-check.js';
import { defaultRouteConfiguration } from '../src/route-config.js';

const qaPort = 54589;
const expectedPort = process.env.GITHUB_ACTIONS === 'true' ? 54339 : qaPort;
const expectedDir = fileURLToPath(new URL(`../../../.data/pg-${qaPort}`, import.meta.url));
const admin = createPool(adminUrl);
const tenant = id(), org = id(), project = id();
const director = id(), master = id(), worker = id(), safety = id(), otherSafety = id(), outsider = id(), employee = id();
const users = [director, master, worker, safety, otherSafety, outsider];
const tokens = new Map<string, string>();
let app: INestApplication | undefined, base: string;
const command = (fields: Record<string, unknown> = {}) => ({ requestId: id(), ...fields });

function headers(user: string) { return { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenant, 'content-type': 'application/json' }; }
async function req(url: string, body?: unknown, user = director, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api/v1${url}`, { method, headers: headers(user), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  checkHttpContract('/api/v1' + url, method, response.status, payload, response.headers);
  return { status: response.status, body: payload };
}

before(async () => {
  const actual = (await admin.query(`SELECT inet_server_addr()::text addr, inet_server_port() port, current_setting('data_directory') dir`)).rows[0];
  assert.equal(new URL(adminUrl).hostname, '127.0.0.1');
  if (process.env.GITHUB_ACTIONS !== 'true') assert.equal(String(actual.addr).startsWith('127.0.0.1'), true, actual.addr);
  assert.equal(Number(actual.port), expectedPort);
  if (process.env.GITHUB_ACTIONS === 'true') assert.ok(String(actual.dir).endsWith('codex-api/.data/pg-54339'), actual.dir);
  else assert.equal(realpathSync(actual.dir), realpathSync(expectedDir));
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Admission review','Europe/Moscow')`, [tenant]);
  for (const user of users) await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`, [user, `${user}@admission-review.test`, hashPassword('admission-review-local')]);
  for (const [user, role] of [[director, 'director'], [master, 'master'], [worker, 'worker'], [safety, 'safety'], [otherSafety, 'safety'], [outsider, 'safety']] as const) await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, user, role]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own')`, [tenant, org]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Допуск')`, [tenant, project]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Работник допуска')`, [tenant, employee, org]);
  for (const user of [director, master, safety, otherSafety]) await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, project, user]);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const user of users) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@admission-review.test`, password: 'admission-review-local' }) });
    assert.equal(response.status, 201);
    tokens.set(user, (await response.json()).token);
  }
});

after(async () => {
  try { await app?.close(); } finally {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      for (const table of ['admission_safety_reviews', 'employee_project_assignments', 'employee_admission_checks', 'admission_template_versions', 'admission_templates', 'employee_qualifications', 'route_config_versions', 'people_command_receipts', 'project_memberships', 'employees', 'memberships', 'projects', 'organizations', 'audit_log']) {
        if ((await client.query(`SELECT to_regclass($1) name`, [table])).rows[0].name) await client.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
      }
      await client.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
      await client.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`, [users]);
      await client.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await admin.end(); }
  }
});

test('named safety reviewer agrees a passed check; anyone else cannot', async () => {
  const items = [{ id: 'safe', label: 'Инструктаж', critical: true }];
  const answers = [{ itemId: 'safe', value: true }];
  await req(`/employees/${employee}/qualifications`, command({ code: 'safety', title: 'Инструктаж' }));
  await req(`/projects/${project}/admission-template`, command({ code: 'site', title: 'Допуск', items, requiredQualificationCodes: ['safety'] }));
  const passed = await req(`/employees/${employee}/admission-checks`, command({ projectId: project, templateVersion: 1, answers }));
  assert.equal(passed.status, 201, JSON.stringify(passed.body));
  assert.equal(passed.body.passed, true);
  const open = await req(`/employees/${employee}/admission-checks/${passed.body.id}/safety-review`);
  assert.equal(open.body.required, false);
  const first = await req(`/projects/${project}/assignments/${employee}`, command({ expectedVersion: 0, status: 'active', admissionCheckId: passed.body.id }), director, 'PUT');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.currentAdmission.eligible, true);
  const revoked = await req(`/projects/${project}/assignments/${employee}`, command({ expectedVersion: 1, status: 'revoked' }), director, 'PUT');
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  const configuration = defaultRouteConfiguration();
  configuration.routes.find(route => route.documentType === 'employee-admission')!.reviewers[0]!.userId = safety;
  await admin.query(`INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,1,1,$3,$4)`, [tenant, project, JSON.stringify(configuration), director]);
  const waiting = await req(`/projects/${project}/assignments`);
  assert.equal(waiting.body.items[0].currentAdmission.reasons.includes('safety_review_required'), true);
  const blocked = await req(`/projects/${project}/assignments/${employee}`, command({ expectedVersion: 2, status: 'active', admissionCheckId: passed.body.id }), director, 'PUT');
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, 'admission_required');
  const review = `/employees/${employee}/admission-checks/${passed.body.id}/safety-review`;
  for (const user of [master, director]) {
    const denied = await req(review, command(), user);
    assert.equal(denied.status, 403, user);
    assert.equal(denied.body.error, 'role_denied');
  }
  const wrong = await req(review, command(), otherSafety);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, 'route_denied');
  const hidden = await req(review, command(), outsider);
  assert.equal(hidden.status, 404);
  const pending = await req(review);
  assert.equal(pending.body.recorded, false);
  assert.equal(pending.body.required, true);
  const body = command();
  const agreed = await req(review, body, safety);
  assert.equal(agreed.status, 201, JSON.stringify(agreed.body));
  assert.equal(agreed.body.recorded, true);
  const replay = await req(review, body, safety);
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, agreed.body);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM admission_safety_reviews WHERE tenant_id=$1 AND check_id=$2`, [tenant, passed.body.id])).rows[0].n, 1);
  const again = await req(review, command(), safety);
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already_reviewed');
  configuration.routes.find(route => route.documentType === 'employee-admission')!.reviewers.push({ role: 'safety', userId: otherSafety });
  await admin.query(`INSERT INTO route_config_versions(tenant_id,project_id,version,schema_version,configuration,created_by) VALUES($1,$2,2,1,$3,$4)`, [tenant, project, JSON.stringify(configuration), director]);
  assert.equal((await req(review)).body.recorded, false);
  assert.equal((await req(`/projects/${project}/assignments/${employee}`, command({ expectedVersion: 2, status: 'active', admissionCheckId: passed.body.id }), director, 'PUT')).status, 422);
  assert.equal((await req(review, command(), otherSafety)).status, 201);
  assert.equal((await req(review)).body.recorded, true);
  const accepted = await req(`/projects/${project}/assignments/${employee}`, command({ expectedVersion: 2, status: 'active', admissionCheckId: passed.body.id }), director, 'PUT');
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.currentAdmission.eligible, true);
  assert.equal(accepted.body.currentAdmission.reasons.includes('safety_review_required'), false);
  const failed = await req(`/employees/${employee}/admission-checks`, command({ projectId: project, templateVersion: 1, answers: [{ itemId: 'safe', value: false }] }));
  assert.equal(failed.body.passed, false);
  const refused = await req(`/employees/${employee}/admission-checks/${failed.body.id}/safety-review`, command(), safety);
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error, 'check_not_passed');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM admission_safety_reviews WHERE check_id=$1`, [failed.body.id])).rows[0].n, 0);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND status IS NULL`, [tenant])).rows[0].n, 0);
});
