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
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex');
const admin = createPool(adminUrl);
let app: INestApplication, base: string, f: Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect = async (p: Promise<{ status: number; body: any }>, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const root = (n: number) => `/projects/${f.project}/accepted-parts/${f.parts[n].partId}/customer-submission`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  f = await internalInspectionFixture(admin, base);
});
after(async () => { await app?.close(); await admin.end(); });

test('подписанный скан хранится у заявки и не подменяет фото', async () => {
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
  assert.equal((await expect(f.call(`${root(1)}/scans`, f.command({ filename: 'акт.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }), 'master'), 422)).error, 'submission_required');
  await expect(f.call(root(1), f.command({ expectedVersion: 0 }), 'master'), 201);
  const body = f.command({ filename: 'акт.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') });
  const scan = await expect(f.call(`${root(1)}/scans`, body, 'master'), 201);
  assert.equal(scan.contentType, 'application/pdf');
  assert.deepEqual(await expect(f.call(`${root(1)}/scans`, body, 'master'), 201), scan);
  const again = await expect(f.call(`${root(1)}/scans`, f.command({ filename: 'копия.pdf', contentType: 'application/pdf', contentBase64: pdf.toString('base64') }), 'master'), 201);
  assert.equal(again.fileId, scan.fileId);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_submission_scans WHERE accepted_part_id=$1`, [f.parts[1].partId])).rows[0].n, 1);
  assert.equal((await expect(f.call(`${root(1)}/scans`, f.command({ filename: 'акт.pdf', contentType: 'application/pdf', contentBase64: png.toString('base64') }), 'master'), 422)).error, 'file_denied');
  assert.equal((await expect(f.call(`${root(1)}/scans`, body, 'worker'), 403)).error, 'role_denied');
  const card = await expect(f.call(root(1), undefined, 'director'));
  assert.equal(card.scans[0].fileId, scan.fileId);
  assert.equal(card.remarks.length, 0);
  const downloaded = await fetch(`${base}/api/v1${root(1)}/scans/${scan.fileId}`, { headers: f.headers('pto') });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), pdf);
});
