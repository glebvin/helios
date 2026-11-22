import assert from 'node:assert/strict';
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
let app: INestApplication, f: Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect = async (p: Promise<{ status: number; body: any }>, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const root = (n: number) => `/projects/${f.project}/accepted-parts/${f.parts[n].partId}/customer-submission`;
const zones = (project = f.project) => `/projects/${project}/customer-submission-zones`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  f = await internalInspectionFixture(admin, `http://127.0.0.1:${(server.address() as { port: number }).port}`);
});
after(async () => { await app?.close(); await admin.end(); });

test('зона показывает только записанную заявку', async () => {
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
  assert.deepEqual(await expect(f.call(zones(), undefined, 'director')), { zones: [] });
  await expect(f.call(root(1), f.command({ expectedVersion: 0 }), 'master'), 201);
  const first = await expect(f.call(zones(), undefined, 'director'));
  assert.equal(first.zones.length, 1);
  assert.equal(first.zones[0].name, 'Зона QA');
  assert.equal(first.zones[0].attemptCount, 1);
  assert.equal(first.zones[0].openRemarks, 0);
  assert.equal(first.zones[0].hasScan, false);
  await expect(f.call(`${root(1)}/remarks`, f.command({ body: 'Шов не закрыт', responsibleEmployeeId: f.employee, dueOn: f.day }), 'master'), 201);
  await expect(f.call(`${root(1)}/scans`, f.command({ filename: 'акт.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }), 'master'), 201);
  const next = await expect(f.call(zones(), undefined, 'worker'));
  assert.equal(next.zones[0].openRemarks, 1);
  assert.equal(next.zones[0].hasScan, true);
  assert.deepEqual(await expect(f.call(zones(f.otherProject), undefined, 'director')), { zones: [] });
  assert.equal((await expect(f.call(zones(f.otherProject), undefined, 'master'), 404)).error, 'not_found');
});
