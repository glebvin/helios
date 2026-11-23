import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, before, after } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/http.js';
import { createPool, adminUrl } from '../src/db.js';
import { assertVolumeReviewDatabase } from './volume-review-fixture.js';
import { internalInspectionFixture } from './internal-inspection-fixture.js';

const pdf = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const admin = createPool(adminUrl);
let app: INestApplication, f: Awaited<ReturnType<typeof internalInspectionFixture>>, signer = '';
const expect = async (p: Promise<{ status: number; body: any }>, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const root = (part: string) => `/projects/${f.project}/accepted-parts/${part}/customer-submission`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  f = await internalInspectionFixture(admin, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
  signer = randomUUID();
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Подписант компании')`, [f.tenant, signer, f.org]);
  await admin.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id,status) VALUES($1,$2,$3,'active')`, [f.tenant, f.project, signer]);
  await admin.query(`INSERT INTO responsibility_orders(tenant_id,id,organization_id,project_id,employee_id,order_number,order_date,valid_from,valid_until,document_types,status,version) VALUES($1,$2,$3,$4,$5,'ПР-СК','2026-01-01','2026-01-01','2099-12-31',ARRAY['external-inspection'],'active',1)`, [f.tenant, randomUUID(), f.org, f.project, signer]);
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
});
after(async () => { await app?.close(); await admin.end(); });

async function accept(part: string) {
  await expect(f.call(root(part), f.command({ expectedVersion: 0 }), 'master'), 201);
  await expect(f.call(`${root(part)}/scans`, f.command({ filename: 'акт.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }), 'master'), 201);
  return expect(f.call(`${root(part)}/decision`, f.command({ expectedAttempt: 1, customerSignerName: 'Иванов И.И.', companySignerEmployeeId: signer }), 'master'), 201);
}

async function setVersion(titles: string[]) {
  const workType = (await admin.query(`SELECT t.work_type_id AS id FROM accepted_volume_parts p JOIN managed_execution_reports r ON r.tenant_id=p.tenant_id AND r.report_id=p.report_id JOIN daily_tasks t ON t.tenant_id=r.tenant_id AND t.id=r.task_id WHERE p.id=$1`, [f.parts[0].partId])).rows[0].id;
  const version = Number((await admin.query(`SELECT coalesce(max(version),0)::int n FROM id_set_versions WHERE work_type_id=$1`, [workType])).rows[0].n) + 1;
  const requestId = randomUUID();
  await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash) VALUES($1,$2,$3,'test id set','id-debt')`, [f.tenant, f.actors.director.id, requestId]);
  await admin.query(`INSERT INTO id_set_versions(tenant_id,project_id,work_type_id,version,titles,actor_user_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7)`, [f.tenant, f.project, workType, version, JSON.stringify(titles), f.actors.director.id, requestId]);
}

test('первое внешнее принятие создаёт один долг ИД по текущему комплекту', async () => {
  const plain = f.parts[0].partId as string;
  const linked = f.parts[1].partId as string;
  const withoutSet = await accept(plain);
  assert.equal(withoutSet.idDebt, null);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM accepted_part_id_debts WHERE accepted_part_id=$1`, [plain])).rows[0].n, 0);
  await setVersion([]);
  const empty = await accept(f.parts[2].partId);
  assert.equal(empty.idDebt, null);
  await setVersion(['Схема', 'Акт']);
  const body = f.command({ expectedAttempt: 1, customerSignerName: 'Иванов И.И.', companySignerEmployeeId: signer });
  await expect(f.call(root(linked), f.command({ expectedVersion: 0 }), 'master'), 201);
  await expect(f.call(`${root(linked)}/scans`, f.command({ filename: 'акт.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }), 'master'), 201);
  const saved = await expect(f.call(`${root(linked)}/decision`, body, 'master'), 201);
  assert.equal(saved.idDebt.version, 2);
  assert.deepEqual(saved.idDebt.titles, ['Схема', 'Акт']);
  assert.deepEqual((await expect(f.call(`${root(linked)}/decision`, body, 'master'), 201)).idDebt, saved.idDebt);
  assert.equal((await expect(f.call(`${root(linked)}/decision`, f.command({ expectedAttempt: 1, customerSignerName: 'Иванов И.И.', companySignerEmployeeId: signer }), 'master'), 409)).error, 'already_decided');
  await setVersion(['Поздний документ']);
  const remark = await expect(f.call(`${root(linked)}/remarks`, f.command({ body: 'Замечание следующей попытки', responsibleEmployeeId: f.employee, dueOn: '2027-04-02' }), 'master'), 201);
  await expect(f.call(`${root(linked)}/remarks/${remark.id}/close`, f.command({}), 'master'), 200);
  const repeated = await expect(f.call(root(linked), f.command({ expectedVersion: 1 }), 'master'), 201);
  assert.equal(repeated.attemptNumber, 2);
  assert.deepEqual(repeated.idDebt.titles, ['Схема', 'Акт']);
  const second = Buffer.from('%PDF-1.1\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n2');
  await expect(f.call(`${root(linked)}/scans`, f.command({ filename: 'акт-2.pdf', contentType: 'application/pdf', contentBase64: second.toString('base64') }), 'master'), 201);
  const again = await expect(f.call(`${root(linked)}/decision`, f.command({ expectedAttempt: 2, customerSignerName: 'Иванов И.И.', companySignerEmployeeId: signer }), 'master'), 201);
  assert.equal(again.decision.attemptNumber, 2);
  assert.equal(again.idDebt.version, 2);
  assert.deepEqual(again.idDebt.titles, ['Схема', 'Акт']);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM accepted_part_id_debts WHERE accepted_part_id=$1`, [linked])).rows[0].n, 1);
  const seen = await expect(f.call(root(linked), undefined, 'pto'));
  assert.deepEqual(seen.idDebt.titles, ['Схема', 'Акт']);
});
