import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/http.js';
import { createPool, adminUrl } from '../src/db.js';
import { assertVolumeReviewDatabase } from './volume-review-fixture.js';
import { internalInspectionFixture } from './internal-inspection-fixture.js';

const admin = createPool(adminUrl);
let app: INestApplication, f: Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect = async (p: Promise<{ status: number; body: any }>, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const path = (n: number) => `/projects/${f.project}/accepted-parts/${f.parts[n].partId}/customer-submission`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  f = await internalInspectionFixture(admin, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
});
after(async () => { await app?.close(); await admin.end(); });

test('внешняя заявка ждёт самоконтроль и нужный ПТО', async () => {
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
  const open = await expect(f.call(path(1), undefined, 'master'));
  assert.equal(open.recorded, false);
  const body = f.command({ expectedVersion: 0 });
  const saved = await expect(f.call(path(1), body, 'master'), 201);
  assert.equal(saved.recorded, true);
  assert.equal(saved.attemptNumber, 1);
  assert.equal(saved.checklistRunId, f.parts[1].checklistRunId);
  assert.deepEqual(await expect(f.call(path(1), body, 'master'), 201), saved);
  assert.equal((await expect(f.call(path(1), f.command({ expectedVersion: 0 }), 'master'), 409)).error, 'stale_version');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_submissions WHERE accepted_part_id=$1`, [f.parts[1].partId])).rows[0].n, 1);
  assert.equal((await expect(f.call(path(1), f.command({ expectedVersion: 1 }), 'worker'), 403)).error, 'role_denied');
  assert.equal((await expect(f.call(path(1), f.command({ expectedVersion: 1 }), 'director'), 403)).error, 'role_denied');
  assert.equal((await expect(f.call(`/projects/${f.otherProject}/accepted-parts/${f.parts[1].partId}/customer-submission`, f.command({ expectedVersion: 0 }), 'master'), 404)).error, 'not_found');

  await admin.query(`UPDATE checklist_runs SET passed=false WHERE id=$1`, [f.parts[2].checklistRunId]);
  assert.equal((await expect(f.call(path(2), f.command({ expectedVersion: 0 }), 'master'), 422)).error, 'self_control_required');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_submissions WHERE accepted_part_id=$1`, [f.parts[2].partId])).rows[0].n, 0);

  await admin.query(`UPDATE project_work_types SET hidden_work=true WHERE tenant_id=$1 AND name='Кладка QA'`, [f.tenant]);
  assert.equal((await expect(f.call(path(3), f.command({ expectedVersion: 0 }), 'master'), 422)).error, 'internal_inspection_required');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_submissions WHERE accepted_part_id=$1`, [f.parts[3].partId])).rows[0].n, 0);
  await f.configure();
  await expect(f.action(3, 'submit', 0), 201);
  await expect(f.action(3, 'responsible', 1), 201);
  await expect(f.action(3, 'approve', 2), 201);
  const afterPto = await expect(f.call(path(3), f.command({ expectedVersion: 0 }), 'master'), 201);
  assert.equal(afterPto.attemptNumber, 1);
  assert.equal((await expect(f.call(path(3), undefined, 'director'))).recorded, true);
});
