import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { adminUrl, createPool, withTenant } from '../src/db.js';
import { AllExceptionsFilter } from '../src/http.js';
import { hashPassword } from '../src/password.js';

const admin = createPool(adminUrl);
const restricted = createPool();
const id = () => randomUUID();
const tenant = id(), foreign = id(), orgA = id(), orgB = id(), customer = id();
const project = id(), otherProject = id(), foreignProject = id();
const master = id(), master2 = id(), supply = id(), pto = id(), ptoOther = id(), director = id(), worker = id();
const supplyEmployee = id();
const users = [master, master2, supply, pto, ptoOther, director, worker];
const password = 'material-batch-password';
const tokens = new Map<string, string>();
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const sha = createHash('sha256').update(pdf).digest('hex');
let app: INestApplication | undefined;
let base = '';
let evidence = '';

test.after(async () => {
  try { await app?.close(); } finally {
    try {
      for (const table of ['material_batch_documents', 'material_batch_revisions', 'material_batches', 'people_command_receipts', 'project_memberships', 'employees', 'memberships', 'projects', 'organizations', 'audit_log']) {
        await admin.query(`DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`, [[tenant, foreign]]);
      }
      await admin.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [[tenant, foreign]]);
      await admin.query('DELETE FROM sessions WHERE user_id = ANY($1::uuid[])', [users]);
      await admin.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    } finally {
      await Promise.all([admin.end(), restricted.end()]);
      if (evidence) await rm(evidence, { recursive: true, force: true });
    }
  }
});

async function request(path: string, user: string, options: RequestInit = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenant, ...options.headers } });
}
async function bodyOf(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
function batchBody(over: Record<string, unknown> = {}) {
  return { requestId: id(), organizationId: orgA, materialName: 'Кирпич', unit: 'шт', batchCode: `K-${id().slice(0, 8)}`, supplierName: 'Завод', deliveryDocument: 'УПД-1', deliveredOn: '2026-11-15', deliveredQuantity: '12.5', documents: [{ filename: 'quality.pdf', contentType: 'application/pdf', sizeBytes: pdf.length, sha256: sha }], ...over };
}
function withoutEmployer(over: Record<string, unknown>) {
  const { organizationId, ...body } = batchBody(over);
  void organizationId;
  return body;
}

test.before(async () => {
  const ci = process.env.GITHUB_ACTIONS === 'true';
  const localPort = process.env.HELIOS_MATERIAL_QA_DB_PORT ?? '54541';
  assert.ok(['54541', '54633', '54637'].includes(localPort));
  const target = new URL(adminUrl);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, ci ? '54339' : localPort);
  const directory = (await admin.query('SHOW data_directory')).rows[0].data_directory;
  if (ci) assert.match(directory, /codex-api\/\.data\/pg-54339$/);
  else assert.equal(realpathSync(directory), realpathSync(fileURLToPath(new URL(`../../../.data/pg-${localPort}`, import.meta.url))));
  evidence = await mkdtemp(join(tmpdir(), 'helios-material-batches-'));
  process.env.HELIOS_EVIDENCE_ROOT = evidence;
  await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Материалы'),($2,'Чужая')", [tenant, foreign]);
  const hash = hashPassword(password);
  for (const user of users) await admin.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)', [user, `${user}@material.test`, 'Материалы', hash]);
  for (const [user, role] of [[master, 'master'], [master2, 'master'], [supply, 'supply'], [pto, 'pto'], [ptoOther, 'pto'], [director, 'director'], [worker, 'worker']] as const) {
    await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [tenant, user, role]);
  }
  await admin.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Свой'),($1,$3,'subcontractor','Другой'),($1,$4,'customer','Заказчик')", [tenant, orgA, orgB, customer]);
  await admin.query('INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,$3),($1,$4,$5),($6,$7,$8)', [tenant, project, 'Объект', otherProject, 'Другой объект', foreign, foreignProject, 'Чужой']);
  for (const user of [master, master2, supply, pto, director, worker]) await admin.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)', [tenant, project, user]);
  await admin.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)', [tenant, otherProject, ptoOther]);
  await admin.query('INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,$5)', [tenant, supplyEmployee, orgA, supply, 'Кладовщик']);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of users) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@material.test`, password }) });
    const body = await bodyOf(response);
    assert.equal(response.status, 201, JSON.stringify(body));
    tokens.set(user, body.token);
  }
});

test('receipt replay rechecks the current supply employer', async () => {
  const command = batchBody({batchCode:'REPLAY-EMPLOYER'});
  const path = `/api/v1/projects/${project}/material-batches`;
  assert.equal((await request(path, supply, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)})).status,201);
  await admin.query('UPDATE employees SET organization_id=$1 WHERE tenant_id=$2 AND id=$3',[orgB,tenant,supplyEmployee]);
  try {
    const denied = await request(path,supply,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(command)});
    assert.equal(denied.status,403); assert.equal((await bodyOf(denied)).error,'employer_denied');
  } finally { await admin.query('UPDATE employees SET organization_id=$1 WHERE tenant_id=$2 AND id=$3',[orgA,tenant,supplyEmployee]); }
});

test('two different batches cannot concurrently acquire the same current code', async () => {
  const path = `/api/v1/projects/${project}/material-batches`;
  const cards = [];
  for (const batchCode of ['CODE-RACE-A','CODE-RACE-B']) cards.push(await bodyOf(await request(path,master,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batchBody({batchCode}))})));
  const outcomes = await Promise.all(cards.map(card => request(`${path}/${card.id}`,master,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(withoutEmployer({requestId:id(),expectedVersion:1,batchCode:'CODE-RACE-FINAL',documents:[]}))})));
  assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,409]);
  const rows = await admin.query("SELECT count(*)::int n FROM material_batch_revisions r WHERE tenant_id=$1 AND batch_code='CODE-RACE-FINAL'",[tenant]);assert.equal(rows.rows[0].n,1);
});

test('simultaneous byte uploads finalize and audit one document once', async () => {
  const path = `/api/v1/projects/${project}/material-batches`;
  const card = await bodyOf(await request(path,master,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(batchBody({batchCode:'UPLOAD-RACE'}))}));
  const doc = card.documents[0]; const blocker = await admin.connect();
  let pending: Promise<Response>[] = [];
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM material_batch_documents WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenant,doc.id]);
    pending = [1,2].map(()=>request(`${path}/${card.id}/documents/${doc.id}/content`,master,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:pdf}));
    const deadline=Date.now()+10000;let waiting=0;
    while(Date.now()<deadline){waiting=(await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND usename='helios_app' AND wait_event_type='Lock'")).rows[0].n;if(waiting>=2)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok(waiting>=2,'both uploads must reach the PostgreSQL barrier');await blocker.query('COMMIT');
    assert.deepEqual((await Promise.all(pending)).map(r=>r.status),[200,200]);
    assert.equal((await admin.query("SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='materials.document' AND object_id=$2",[tenant,doc.id])).rows[0].n,1);
  } finally {await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled(pending);}
});

test('publication still refuses unverified material control', async () => {
  const source = await readFile(new URL('../src/tasks.service.ts', import.meta.url), 'utf8');
  assert.match(source, /material_not_accepted/);
  assert.match(source, /predecessor_acceptance_unsupported/);
});

test('master records a batch, reloads it, and PTO opens the same document', async () => {
  const created = await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody({ materialName: 'Газоблок', batchCode: 'GB-1' })) });
  const card = await bodyOf(created);
  assert.equal(created.status, 201, JSON.stringify(card));
  assert.equal(card.status, 'awaiting_control');
  assert.equal(card.statusLabel, 'Ожидает входного контроля');
  assert.equal(card.deliveredQuantity, '12.500');
  assert.equal(card.documents[0].state, 'pending');
  assert.equal((await request(`/api/v1/projects/${project}/material-batches/${card.id}/documents/${card.documents[0].id}/content`, master)).status, 409);
  const wrong = await request(`/api/v1/projects/${project}/material-batches/${card.id}/documents/${card.documents[0].id}/content`, master, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('%PDF-no') });
  assert.equal(wrong.status, 422);
  assert.equal((await bodyOf(await request(`/api/v1/projects/${project}/material-batches/${card.id}`, master))).documents[0].state, 'pending');
  const uploaded = await request(`/api/v1/projects/${project}/material-batches/${card.id}/documents/${card.documents[0].id}/content`, master, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: pdf });
  assert.equal(uploaded.status, 200);
  const file = await request(`/api/v1/projects/${project}/material-batches/${card.id}/documents/${card.documents[0].id}/content`, pto);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), pdf);
  const listed = await bodyOf(await request(`/api/v1/projects/${project}/material-batches?q=${encodeURIComponent('Газоблок')}`, pto));
  assert.equal(listed.total, 1);
  assert.equal(listed.items[0].id, card.id);
  assert.equal(listed.items[0].documents[0].state, 'ready');
  const again = await bodyOf(await request(`/api/v1/projects/${project}/material-batches/${card.id}`, pto));
  assert.equal(again.batchCode, 'GB-1');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='materials.document' AND object_id=$2`, [tenant, card.documents[0].id])).rows[0].n, 1);
});

test('repeat keeps one batch and a second editor cannot overwrite the first version', async () => {
  const command = batchBody({ materialName: 'Цемент', batchCode: 'CEM-1' });
  const first = await bodyOf(await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) }));
  const replay = await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) });
  const replayed = await bodyOf(replay);
  assert.equal(replay.status, 201);
  assert.equal(replayed.id, first.id);
  assert.equal((await admin.query('SELECT count(*)::int n FROM material_batches WHERE tenant_id=$1 AND id=$2', [tenant, first.id])).rows[0].n, 1);
  const mismatch = await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...command, materialName: 'Другой' }) });
  assert.equal(mismatch.status, 409);
  assert.equal((await bodyOf(mismatch)).error, 'idempotency_payload_mismatch');
  const saved = await request(`/api/v1/projects/${project}/material-batches/${first.id}`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...withoutEmployer({ materialName: 'Цемент М500', batchCode: 'CEM-1', documents: [] }), requestId: id(), expectedVersion: 1 }) });
  assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
  const stale = await request(`/api/v1/projects/${project}/material-batches/${first.id}`, master2, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...withoutEmployer({ materialName: 'Чужая правка', batchCode: 'CEM-1', documents: [] }), requestId: id(), expectedVersion: 1 }) });
  assert.equal(stale.status, 409);
  assert.equal((await bodyOf(stale)).error, 'stale_version');
  const card = await bodyOf(await request(`/api/v1/projects/${project}/material-batches/${first.id}`, pto));
  assert.equal(card.version, 2);
  assert.equal(card.history[0].materialName, 'Цемент');
  assert.equal(card.history[1].materialName, 'Цемент М500');
  await assert.rejects(withTenant(restricted, tenant, master, (c) => c.query(`UPDATE material_batch_revisions SET material_name='подмена' WHERE batch_id=$1`, [first.id])), (error: { code?: string }) => error.code === '42501');
});

test('scope denies another employer, object, file and business route', async () => {
  const own = await bodyOf(await request(`/api/v1/projects/${project}/material-batches`, supply, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody({ batchCode: 'SUP-1' })) }));
  assert.equal(own.organizationId, orgA);
  const foreignEmployer = await request(`/api/v1/projects/${project}/material-batches`, supply, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody({ organizationId: orgB, batchCode: 'SUP-2' })) });
  assert.equal(foreignEmployer.status, 403);
  assert.equal((await bodyOf(foreignEmployer)).error, 'employer_denied');
  const other = await bodyOf(await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody({ organizationId: orgB, batchCode: 'ORG-B' })) }));
  assert.equal((await request(`/api/v1/projects/${project}/material-batches/${other.id}`, supply)).status, 403);
  assert.equal((await request(`/api/v1/projects/${project}/material-batches/${other.id}/documents/${other.documents[0].id}/content`, supply)).status, 403);
  assert.equal((await request(`/api/v1/projects/${project}/material-batches/${other.id}/documents/${id()}/content`, pto)).status, 404);
  assert.equal((await request(`/api/v1/projects/${otherProject}/material-batches`, pto)).status, 403);
  assert.equal((await request(`/api/v1/projects/${foreignProject}/material-batches`, pto)).status, 403);
  for (const user of [director, worker, pto]) assert.equal((await request(`/api/v1/projects/${project}/material-batches`, user, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody()) })).status, 403);
  assert.equal((await request('/api/v1/employees', supply, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await request('/api/tasks', supply, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  const accepted = await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody({ status: 'accepted' })) });
  assert.equal(accepted.status, 400);
  const customerBatch = await request(`/api/v1/projects/${project}/material-batches`, master, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batchBody({ organizationId: customer, batchCode: 'CUST' })) });
  assert.equal(customerBatch.status, 404);
  const page = await bodyOf(await request(`/api/v1/projects/${project}/material-batches?limit=1&offset=0`, master));
  assert.equal(page.items.length, 1);
  assert.ok(page.total > 1);
  const missed = await bodyOf(await request(`/api/v1/projects/${project}/material-batches?limit=1&offset=1&q=${encodeURIComponent('%')}`, master));
  assert.equal(missed.total, 0);
  assert.equal(missed.employers.some((item: { id: string }) => item.id === customer), false);
});
