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
const root = (n: number) => `/projects/${f.project}/accepted-parts/${f.parts[n].partId}/customer-submission`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  f = await internalInspectionFixture(admin, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
});
after(async () => { await app?.close(); await admin.end(); });

test('повтор внешней заявки ждёт закрытия замечания', async () => {
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
  await expect(f.call(root(1), f.command({ expectedVersion: 0 }), 'master'), 201);
  const remarkBody = f.command({ body: 'Шов не закрыт', responsibleEmployeeId: f.employee, dueOn: f.day });
  const remark = await expect(f.call(`${root(1)}/remarks`, remarkBody, 'master'), 201);
  assert.equal(remark.closedAt, null);
  assert.deepEqual(await expect(f.call(`${root(1)}/remarks`, remarkBody, 'master'), 201), remark);
  assert.equal((await expect(f.call(root(1), f.command({ expectedVersion: 1 }), 'master'), 422)).error, 'remarks_open');
  assert.equal((await admin.query(`SELECT attempt_number FROM customer_submissions WHERE accepted_part_id=$1`, [f.parts[1].partId])).rows[0].attempt_number, 1);
  assert.equal((await expect(f.call(`${root(1)}/remarks`, f.command({ body: 'Шов не закрыт', responsibleEmployeeId: f.employee, dueOn: f.day }), 'worker'), 403)).error, 'role_denied');
  const closed = await expect(f.call(`${root(1)}/remarks/${remark.id}/close`, f.command({}), 'master'), 200);
  assert.ok(closed.closedAt);
  const again = await expect(f.call(root(1), f.command({ expectedVersion: 1 }), 'master'), 201);
  assert.equal(again.attemptNumber, 2);
  assert.equal(again.openRemarks, 0);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_submission_attempts WHERE accepted_part_id=$1`, [f.parts[1].partId])).rows[0].n, 2);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM accepted_volume_parts WHERE id=$1`, [f.parts[1].partId])).rows[0].n, 1);
});
