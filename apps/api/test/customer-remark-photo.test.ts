import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/http.js';
import { createPool, adminUrl } from '../src/db.js';
import { assertVolumeReviewDatabase } from './volume-review-fixture.js';
import { internalInspectionFixture } from './internal-inspection-fixture.js';
import { configureJsonBody } from '../src/json-body.js';

const png = Buffer.concat([
  Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082', 'hex'),
  Buffer.alloc(2 * 1024 * 1024),
]);
const admin = createPool(adminUrl);
let app: INestApplication, base: string, f: Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect = async (p: Promise<{ status: number; body: any }>, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };
const root = (n: number) => `/projects/${f.project}/accepted-parts/${f.parts[n].partId}/customer-submission`;

before(async () => {
  await assertVolumeReviewDatabase(admin, true);
  const serverApp = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureJsonBody(serverApp);
  app = serverApp;
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  f = await internalInspectionFixture(admin, base);
});
after(async () => { await app?.close(); await admin.end(); });

test('фото замечания хранится один раз и читается обратно', async () => {
  await expect(f.call(`/projects/${f.project}/internal-inspection-policy`, f.command({ expectedVersion: 0, required: false }), 'director'), 200);
  await expect(f.call(root(1), f.command({ expectedVersion: 0 }), 'master'), 201);
  const remark = await expect(f.call(`${root(1)}/remarks`, f.command({ body: 'Шов не закрыт', responsibleEmployeeId: f.employee, dueOn: f.day }), 'master'), 201);
  const photoBody = f.command({ filename: 'шов.png', contentType: 'image/png', contentBase64: png.toString('base64') });
  const photo = await expect(f.call(`${root(1)}/remarks/${remark.id}/photos`, photoBody, 'master'), 201);
  assert.equal(photo.contentType, 'image/png');
  assert.equal(photo.sizeBytes, png.length);
  assert.deepEqual(await expect(f.call(`${root(1)}/remarks/${remark.id}/photos`, photoBody, 'master'), 201), photo);
  const again = await expect(f.call(`${root(1)}/remarks/${remark.id}/photos`, f.command({ filename: 'другой.png', contentType: 'image/png', contentBase64: png.toString('base64') }), 'master'), 201);
  assert.equal(again.fileId, photo.fileId);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM customer_remark_photos WHERE remark_id=$1`, [remark.id])).rows[0].n, 1);
  assert.equal((await expect(f.call(`${root(1)}/remarks/${remark.id}/photos`, f.command({ filename: 'шов.png', contentType: 'image/jpeg', contentBase64: png.toString('base64') }), 'master'), 422)).error, 'file_denied');
  assert.equal((await expect(f.call(`${root(1)}/remarks/${remark.id}/photos`, photoBody, 'worker'), 403)).error, 'role_denied');
  const card = await expect(f.call(root(1), undefined, 'director'));
  assert.equal(card.remarks[0].photos[0].fileId, photo.fileId);
  const downloaded = await fetch(`${base}/api/v1${root(1)}/remarks/${remark.id}/photos/${photo.fileId}`, { headers: f.headers('pto') });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), png);
  assert.equal((await fetch(`${base}/api/v1${root(0)}/remarks/${remark.id}/photos/${photo.fileId}`, { headers: f.headers('pto') })).status, 404);
});
