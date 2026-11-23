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
const root = () => `/projects/${f.project}/accepted-parts/${f.parts[1].partId}/customer-submission`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  f = await internalInspectionFixture(admin, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
});
after(async () => { await app?.close(); await admin.end(); });

test('два внешних замечания создают две задачи', async () => {
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
  await expect(f.call(root(), f.command({ expectedVersion: 0 }), 'master'), 201);
  const firstBody = f.command({ body: 'Шов не закрыт', responsibleEmployeeId: f.employee, dueOn: f.day });
  const first = await expect(f.call(`${root()}/remarks`, firstBody, 'master'), 201);
  assert.equal((await expect(f.call(`${root()}/remarks`, firstBody, 'master'), 201)).taskId, first.taskId);
  const second = await expect(f.call(`${root()}/remarks`, f.command({ body: 'Нет защитного слоя', responsibleEmployeeId: f.employee, dueOn: f.day }), 'master'), 201);
  assert.notEqual(second.taskId, first.taskId);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_remark_tasks WHERE project_id=$1`, [f.project])).rows[0].n, 2);
  await expect(f.call(`${root()}/remarks/${first.id}/close`, f.command({}), 'master'), 200);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_remark_tasks WHERE id=$1`, [first.taskId])).rows[0].n, 1);
  const other = (await admin.query(`SELECT id FROM employees WHERE user_id=$1`, [f.actors.otherWorker.id])).rows[0].id;
  await expect(f.call(`${root()}/remarks`, f.command({ body: 'Чужая задача', responsibleEmployeeId: other, dueOn: f.day }), 'master'), 201);
  const own = await expect(f.call(`/projects/${f.project}/customer-remark-tasks`, undefined, 'worker'));
  assert.deepEqual(own.items.map((item: { body: string }) => item.body).sort(), ['Нет защитного слоя', 'Шов не закрыт']);
  assert.equal(own.items.find((item: { body: string }) => item.body === 'Нет защитного слоя').closedAt, null);
  assert.ok(own.items.find((item: { body: string }) => item.body === 'Шов не закрыт').closedAt);
  const foreign = await expect(f.call(`/projects/${f.project}/customer-remark-tasks`, undefined, 'otherWorker'));
  assert.deepEqual(foreign.items.map((item: { body: string }) => item.body), ['Чужая задача']);
  assert.deepEqual((await expect(f.call(`/projects/${f.project}/customer-remark-tasks`, undefined, 'director'))).items, []);
  await expect(f.call(`/projects/${f.otherProject}/customer-remark-tasks`, undefined, 'worker'), 404);
});
