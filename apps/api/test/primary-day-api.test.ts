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

const qaPort = Number(process.env.HELIOS_PRIMARY_QA_DB_PORT ?? 54583);
assert.ok([54583,54597].includes(qaPort));
const expectedPort = process.env.GITHUB_ACTIONS === 'true' ? 54339 : qaPort;
const expectedDir = fileURLToPath(new URL(`../../../.data/pg-${qaPort}`, import.meta.url));
const restricted = createPool();
const admin = createPool(adminUrl);
const tenant = id(), foreign = id(), org = id(), otherOrg = id(), idleOrg = id();
const project = id(), foreignProject = id(), otherProject = id();
const worker = id(), master = id(), director = id(), hr = id(), hr2 = id(), pto = id(), outsider = id();
const employee = id(), masterEmployee = id(), otherEmployee = id(), task = id();
const users = [worker, master, director, hr, hr2, pto, outsider];
const tokens = new Map<string, string>();
let app: INestApplication | undefined, base: string;
const day = '2026-11-01', nextDay = '2026-11-02';

function headers(user: string, t = tenant) { return { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': t }; }
async function req(url: string, body?: unknown, user = master, method = body === undefined ? 'GET' : 'POST', t = tenant) {
  const response = await fetch(`${base}/api/v1${url}`, { method, headers: { ...headers(user, t), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = response.headers.get('content-type')?.includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
  const result = { status: response.status, body: payload };
  checkHttpContract('/api/v1' + url, method, response.status, result.body, response.headers);
  return result;
}
async function lifecycle(civil: string, emp = employee) {
  const start = `${civil}T06:00:00Z`, work = `${civil}T07:00:00Z`, pause = `${civil}T09:00:00Z`, down = `${civil}T09:30:00Z`, end = `${civil}T15:00:00Z`;
  const transitions = [{ at: work, mode: 'work' }, { at: pause, mode: 'break' }, { at: down, mode: 'downtime' }, { at: end }];
  const shift = id();
  await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [tenant, emp]);
  let version = Number((await admin.query(`SELECT coalesce(max(version),0)::text v FROM managed_execution_events WHERE tenant_id=$1 AND employee_id=$2`, [tenant, emp])).rows[0].v);
  await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6)`, [tenant, project, emp, shift, start, end]);
  const changes = [{ at: start, mode: 'idle' }, ...transitions];
  for (let n = 0; n < changes.length; n++) {
    const change = changes[n], request = id(), kind = n === 0 ? 'shift_start' : n === changes.length - 1 ? 'shift_end' : 'segment_change';
    await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`, [tenant, worker, request]);
    await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,repeat('b',64),'{}')`, [tenant, worker, request, emp, project, shift, kind, ++version, change.at, JSON.stringify({ mode: change.mode, ...(change.mode === 'work' ? { taskId: task } : {}) })]);
    if (kind !== 'shift_end') {
      const work = change.mode === 'work';
      const downtime = change.mode === 'downtime';
      await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,task_id,reason_code,comment,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [tenant, project, emp, shift, id(), change.mode, work ? task : null, downtime ? 'other' : null, downtime ? 'Ожидание фронта' : null, change.at, changes[n + 1].at]);
    }
  }
  await admin.query(`UPDATE managed_execution_streams SET version=$3 WHERE tenant_id=$1 AND employee_id=$2`, [tenant, emp, version]);
}

before(async () => {
  const actual = (await admin.query(`SELECT inet_server_addr()::text addr, inet_server_port() port, current_setting('data_directory') dir`)).rows[0];
  assert.equal(new URL(adminUrl).hostname, '127.0.0.1');
  if (process.env.GITHUB_ACTIONS !== 'true') assert.equal(String(actual.addr).startsWith('127.0.0.1'), true, actual.addr);
  assert.equal(Number(actual.port), expectedPort);
  if (process.env.GITHUB_ACTIONS === 'true') assert.ok(String(actual.dir).endsWith('codex-api/.data/pg-54339'), actual.dir);
  else assert.equal(realpathSync(actual.dir), realpathSync(expectedDir));
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Primary','Europe/Moscow'),($2,'Foreign','Europe/Moscow')`, [tenant, foreign]);
  for (const user of users) await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [user, `${user}@primary.test`, `User ${user.slice(0, 4)}`, hashPassword('primary-password')]);
  for (const [user, role] of [[worker, 'worker'], [master, 'master'], [director, 'director'], [hr, 'hr'], [hr2, 'hr'], [pto, 'pto']] as const) await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, user, role]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`, [foreign, outsider]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект'),($1,$3,'Другой')`, [tenant, project, otherProject]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Чужой')`, [foreign, foreignProject]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя'),($1,$3,'subcontractor','Другая'),($1,$4,'subcontractor','Без назначения')`, [tenant, org, otherOrg, idleOrg]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,'Иван Рабочий'),($1,$5,$3,$6,'Павел Мастер'),($1,$7,$8,NULL,'Чужой работник')`, [tenant, employee, org, worker, masterEmployee, master, otherEmployee, otherOrg]);
  for (const user of [worker, master, director, hr, hr2, pto]) await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, project, user]);
  await admin.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id) VALUES($1,$2,$3),($1,$2,$4)`, [tenant, project, employee, otherEmployee]);
  await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Кладка',$4,1,'м2',$5)`, [tenant, task, project, day, employee]);
  await lifecycle(day);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  for (const user of users) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@primary.test`, password: 'primary-password' }) });
    assert.equal(response.status, 201);
    tokens.set(user, (await response.json()).token);
  }
});

after(async () => {
  try { await app?.close(); } finally {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const table of ['consolidated_time_heads', 'consolidated_time_revisions', 'time_corrections', 'primary_day_closes', 'time_approval_heads', 'time_approval_revisions', 'managed_execution_events', 'managed_segments', 'managed_shifts', 'managed_execution_streams', 'daily_tasks', 'employee_project_assignments', 'project_memberships', 'people_command_receipts', 'employees', 'memberships', 'projects', 'organizations', 'audit_log']) {
        if ((await client.query(`SELECT to_regclass($1) name`, [table])).rows[0].name) await client.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [[tenant, foreign]]);
      }
      await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[tenant, foreign]]);
      await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [users]);
      await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK'); client.release(); await Promise.all([admin.end(), restricted.end()]); }
  }
});

const primary = (civil = day, organization = org) => `/projects/${project}/time/primary-days/${civil}?organizationId=${organization}`;
test('master closes the primary day, personnel issues revisions, and a late fact stays beside them', async () => {
  const seen = await req(primary());
  assert.equal(seen.status, 200, JSON.stringify(seen.body));
  assert.equal(seen.body.closeVersion, 0);
  assert.equal(seen.body.employees.length, 1);
  const modes = seen.body.employees[0].live.shifts.map((shift: { mode: string }) => shift.mode);
  for (const mode of ['idle', 'work', 'break', 'downtime']) assert.ok(modes.includes(mode), modes.join(','));
  const closeBody = { requestId: id(), expectedCloseVersion: 0, organizationId: org, sourceHash: seen.body.liveHash };
  const closed = await req(`${primary().split('?')[0]}/close`, closeBody);
  assert.equal(closed.status, 201, JSON.stringify(closed.body));
  assert.equal(closed.body.closeVersion, 1);
  assert.equal(closed.body.snapshotHash, seen.body.liveHash);
  assert.equal(closed.body.diverged, false);
  assert.equal(closed.body.closedBy, master);
  assert.deepEqual(await req(`${primary().split('?')[0]}/close`, closeBody), closed);
  const read = await req(primary(), undefined, hr);
  assert.equal(read.status, 200);
  assert.equal(read.body.snapshotHash, closed.body.snapshotHash);
  const issueBody = { requestId: id(), expectedRevision: 0 };
  const issued = await req(`/projects/${project}/time/consolidated/${day}/revisions`, issueBody, hr);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  assert.equal(issued.body.revision, 1);
  assert.equal(issued.body.revisions[0].closes[0].sourceHash, closed.body.snapshotHash);
  assert.equal(issued.body.revisions[0].correctionId, null);
  assert.deepEqual(await req(`/projects/${project}/time/consolidated/${day}/revisions`, issueBody, hr), issued);
  const second = await req(`/projects/${project}/time/consolidated/${day}`, undefined, hr2);
  assert.equal(second.status, 200);
  assert.equal(second.body.revision, 1);
  const timeDay = await req(`/projects/${project}/time/employees/${employee}/days/${day}`, undefined, director);
  assert.equal(timeDay.status, 200);
  const approved = await req(`/projects/${project}/time/employees/${employee}/days/${day}/approvals`, { requestId: id(), expectedApprovalVersion: timeDay.body.approvalVersion, sourceHash: timeDay.body.sourceHash, reason: 'Прежняя сверка', acknowledgeSuspicious: true }, director);
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  const exported = await req(`/projects/${project}/time/export.xlsx?from=${day}&to=${day}`, undefined, director);
  assert.equal(exported.status, 200);
  assert.equal(Buffer.isBuffer(exported.body) && exported.body.subarray(0, 2).toString(), 'PK');
  const before = (await admin.query(`SELECT revision, previous_revision, correction_id, closes, recorded_at FROM consolidated_time_revisions WHERE tenant_id=$1 AND project_id=$2 AND day=$3 AND revision=1`, [tenant, project, day])).rows[0];
  const correction = await req(`${primary().split('?')[0]}/corrections`, { requestId: id(), organizationId: org, reason: 'Поздний факт смены', expectedCorrectionVersion: 0, sourceHash: (await req(primary())).body.liveHash });
  assert.equal(correction.status, 201, JSON.stringify(correction.body));
  assert.equal(correction.body.correction.correctsHash, closed.body.snapshotHash);
  assert.equal(correction.body.snapshotHash, closed.body.snapshotHash);
  const again = await req(`/projects/${project}/time/consolidated/${day}/revisions`, { requestId: id(), expectedRevision: 1, correctionId: correction.body.correction.id }, hr);
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(again.body.revision, 2);
  assert.equal(again.body.revisions[0].correctionId, null);
  assert.equal(again.body.revisions[1].correctionId, correction.body.correction.id);
  assert.equal(again.body.revisions[0].closes[0].sourceHash, again.body.revisions[1].closes[0].sourceHash);
  assert.equal(again.body.revisions[1].closes[0].correctionId, correction.body.correction.id);
  assert.deepEqual(again.body.revisions[0].closes[0].snapshot, again.body.revisions[1].closes[0].snapshot);
  const after = (await admin.query(`SELECT revision, previous_revision, correction_id, closes, recorded_at FROM consolidated_time_revisions WHERE tenant_id=$1 AND project_id=$2 AND day=$3 AND revision=1`, [tenant, project, day])).rows[0];
  assert.deepEqual(after, before);
  const kept = (await admin.query(`SELECT source_hash FROM primary_day_closes WHERE tenant_id=$1 AND project_id=$2 AND organization_id=$3 AND day=$4`, [tenant, project, org, day])).rows[0];
  const lateShift = id(), lateStart = id(), lateEnd = id();
  await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,'2026-11-01T15:30:00Z','2026-11-01T16:00:00Z')`, [tenant, project, employee, lateShift]);
  for (const [request, kind, at] of [[lateStart, 'shift_start', '2026-11-01T15:30:00Z'], [lateEnd, 'shift_end', '2026-11-01T16:00:00Z']] as const) {
    await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('c',64),201,'{}')`, [tenant, worker, request]);
    const version = Number((await admin.query(`SELECT coalesce(max(version),0)::text v FROM managed_execution_events WHERE tenant_id=$1 AND employee_id=$2`, [tenant, employee])).rows[0].v) + 1;
    await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,repeat('d',64),'{}')`, [tenant, worker, request, employee, project, lateShift, kind, version, at, JSON.stringify({ mode: 'idle' })]);
    await admin.query(`UPDATE managed_execution_streams SET version=$3 WHERE tenant_id=$1 AND employee_id=$2`, [tenant, employee, version]);
  }
  await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at,ended_at) VALUES($1,$2,$3,$4,$5,'idle','2026-11-01T15:30:00Z','2026-11-01T16:00:00Z')`, [tenant, project, employee, lateShift, id()]);
  const diverged = await req(primary(), undefined, hr2);
  assert.equal(diverged.status, 200, JSON.stringify(diverged.body));
  assert.equal(diverged.body.diverged, true);
  assert.equal(diverged.body.snapshotHash, kept.source_hash);
  assert.notEqual(diverged.body.liveHash, kept.source_hash);
  assert.equal(diverged.body.revisions[0].closes[0].sourceHash, kept.source_hash);
  assert.equal(diverged.body.revisions[1].closes[0].sourceHash, kept.source_hash);
  const frozen = (await admin.query(`SELECT source_hash, snapshot FROM primary_day_closes WHERE tenant_id=$1 AND project_id=$2 AND day=$3`, [tenant, project, day])).rows[0];
  assert.equal(frozen.source_hash, kept.source_hash);
  assert.equal(frozen.snapshot.employees[0].facts.sourceHash === diverged.body.liveHash, false);
  const preserved = (await admin.query('SELECT revision,closes,recorded_at FROM consolidated_time_revisions WHERE tenant_id=$1 AND project_id=$2 AND day=$3 ORDER BY revision',[tenant,project,day])).rows;
  const staleCorrection = await req(`${primary().split('?')[0]}/corrections`, {requestId:id(),organizationId:org,reason:'Old source',expectedCorrectionVersion:1,sourceHash:'0'.repeat(64)});
  assert.equal(staleCorrection.status,409);
  const prepared = await req(`${primary().split('?')[0]}/corrections`, {requestId:id(),organizationId:org,reason:'Accept the late half hour',expectedCorrectionVersion:1,sourceHash:diverged.body.liveHash});
  assert.equal(prepared.status,201,JSON.stringify(prepared.body));
  assert.equal(prepared.body.correctionVersion,2);
  assert.equal(prepared.body.correction.sourceHash,diverged.body.liveHash);
  const correctedFacts = structuredClone(diverged.body.employees[0].live);
  await lifecycle(day); // A further late fact must not enter the already prepared correction.
  const amended = await req(`/projects/${project}/time/consolidated/${day}/revisions`,{requestId:id(),expectedRevision:2,correctionId:prepared.body.correction.id},hr);
  assert.equal(amended.status,201,JSON.stringify(amended.body));
  assert.equal(amended.body.revision,3);
  const amendedClose = amended.body.revisions[2].closes.find((item:any)=>item.organizationId===org);
  assert.equal(amendedClose.sourceHash,diverged.body.liveHash);
  assert.deepEqual(amendedClose.snapshot.employees[0].facts,correctedFacts);
  assert.deepEqual((await admin.query('SELECT revision,closes,recorded_at FROM consolidated_time_revisions WHERE tenant_id=$1 AND project_id=$2 AND day=$3 AND revision<=2 ORDER BY revision',[tenant,project,day])).rows,preserved);
  const currentFacts = await req(primary());
  assert.deepEqual(currentFacts.body.employees[0].consolidated,correctedFacts);
  assert.notEqual(currentFacts.body.employees[0].live.sourceHash,correctedFacts.sourceHash);
  const third = await req(`${primary().split('?')[0]}/corrections`,{requestId:id(),organizationId:org,reason:'Next late source',expectedCorrectionVersion:2,sourceHash:currentFacts.body.liveHash});
  assert.equal(third.status,201,JSON.stringify(third.body));
  assert.equal(third.body.correction.correctsHash,diverged.body.liveHash);
  assert.equal(third.body.correctionVersion,3);
  const fourth = await req(`/projects/${project}/time/consolidated/${day}/revisions`,{requestId:id(),expectedRevision:3,correctionId:third.body.correction.id},hr);
  assert.equal(fourth.status,201,JSON.stringify(fourth.body));
  assert.equal(fourth.body.revisions[3].closes.find((item:any)=>item.organizationId===org).sourceHash,currentFacts.body.liveHash);

});

test('a repeated lost command is one row and two simultaneous decisions conflict', async () => {
  await lifecycle(nextDay);
  const seen = await req(primary(nextDay));
  const first = { requestId: id(), expectedCloseVersion: 0, organizationId: org, sourceHash: seen.body.liveHash };
  const second = { ...first, requestId: id() };
  const [left, right] = await Promise.all([req(`${primary(nextDay).split('?')[0]}/close`, first), req(`${primary(nextDay).split('?')[0]}/close`, second)]);
  const statuses = [left.status, right.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM primary_day_closes WHERE tenant_id=$1 AND day=$2`, [tenant, nextDay])).rows[0].n), 1);
  const winner = left.status === 201 ? first : second;
  assert.equal((await req(`${primary(nextDay).split('?')[0]}/close`, winner)).status, 201);
  const issueA = { requestId: id(), expectedRevision: 0 }, issueB = { requestId: id(), expectedRevision: 0 };
  const [one, two] = await Promise.all([
    req(`/projects/${project}/time/consolidated/${nextDay}/revisions`, issueA, hr),
    req(`/projects/${project}/time/consolidated/${nextDay}/revisions`, issueB, hr),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [201, 409]);
  assert.equal(Number((await admin.query(`SELECT count(*)::int n FROM consolidated_time_revisions WHERE tenant_id=$1 AND day=$2`, [tenant, nextDay])).rows[0].n), 1);
});

test('a worker, another company, project and employer cannot close or issue the day', async () => {
  const body = { requestId: id(), expectedCloseVersion: 0, organizationId: org, sourceHash: 'a'.repeat(64) };
  for (const user of [worker, director, pto, hr]) assert.equal((await req(`${primary().split('?')[0]}/close`, { ...body, requestId: id() }, user)).status, 403, user);
  assert.equal((await req(`/projects/${project}/time/consolidated/${day}/revisions`, { requestId: id(), expectedRevision: 0 }, worker)).status, 403);
  assert.equal((await req(`/projects/${project}/time/consolidated/${day}/revisions`, { requestId: id(), expectedRevision: 0 }, master)).status, 403);
  assert.equal((await req(`${primary().split('?')[0]}/close`, { ...body, requestId: id(), organizationId: otherOrg }, master)).status, 403);
  assert.equal((await req(primary(day, idleOrg), undefined, hr)).status, 403);
  assert.equal((await req(`/projects/${project}/time/primary-days/${day}`, undefined, hr)).status, 400);
  assert.equal((await req(`/projects/${otherProject}/time/primary-days/${day}`, undefined, master)).status, 404);
  assert.equal((await req(primary(), undefined, master, 'GET', foreign)).status, 403);
  assert.equal((await req(`/projects/${id()}/time/primary-days/${day}`, undefined, outsider, 'GET', foreign)).status, 404);
  const stored = (await admin.query(`SELECT request_id FROM primary_day_closes WHERE tenant_id=$1 AND day=$2`, [tenant, day])).rows[0];
  assert.equal((await req(`${primary().split('?')[0]}/close`, { requestId: stored.request_id, expectedCloseVersion: 0, organizationId: org, sourceHash: 'b'.repeat(64) })).status, 409);
});


test('master reads only their employer in a consolidated revision and commands stay bound to the day',async()=>{
  const civil='2026-11-03';
  for(const employer of [org,otherOrg]) {
    const request=id();
    await admin.query("INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result)VALUES($1,$2,$3,'fixture',repeat('e',64),201,'{}')",[tenant,master,request]);
    await admin.query("INSERT INTO primary_day_closes(tenant_id,project_id,organization_id,day,version,source_hash,snapshot,actor_user_id,request_id)VALUES($1,$2,$3,$4,1,repeat('f',64),$5,$6,$7)",[tenant,project,employer,civil,JSON.stringify({timezone:'Europe/Moscow',employees:[]}),master,request]);
  }
  const body={requestId:id(),expectedRevision:0};
  const issued=await req(`/projects/${project}/time/consolidated/${civil}/revisions`,body,hr);
  assert.equal(issued.status,201,JSON.stringify(issued.body));
  assert.equal(issued.body.revisions[0].closes.length,2);
  const limited=await req(`/projects/${project}/time/consolidated/${civil}`,undefined,master);
  assert.equal(limited.status,200);
  assert.deepEqual(limited.body.revisions[0].closes.map((item:any)=>item.organizationId),[org]);
  const crossDay=await req(`/projects/${project}/time/consolidated/2026-11-04/revisions`,body,hr);
  assert.equal(crossDay.status,409,JSON.stringify(crossDay.body));
  assert.equal(crossDay.body.error,'idempotency_payload_mismatch');
  await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[tenant,project,hr]);
  try {assert.equal((await req(`/projects/${project}/time/consolidated/${civil}/revisions`,body,hr)).status,404);}
  finally {await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[tenant,project,hr]);}
});


test('invalid civil dates fail before a receipt or day is written',async()=>{
  for(const civil of ['not-a-day','2026-02-31','2026-13-01']) {
    assert.equal((await req(`/projects/${project}/time/primary-days/${civil}`)).status,400);
    const body={requestId:id(),expectedCloseVersion:0,organizationId:org,sourceHash:'a'.repeat(64)};
    assert.equal((await req(`/projects/${project}/time/primary-days/${civil}/close`,body)).status,400);
    assert.equal((await admin.query('SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2',[tenant,body.requestId])).rows[0].n,0);
  }
});
