// Readiness on a disposable database. Refuses every port except this contour.
import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const api = process.env.HELIOS_R47_API ?? 'http://127.0.0.1:4377';
const beat = process.env.HELIOS_WORKER_HEARTBEAT;
assert.equal(new URL(api).port, '4377');
assert.equal(typeof beat, 'string');
assert.ok(beat.startsWith('/'));
await mkdir(dirname(beat), { recursive: true });

const health = await fetch(`${api}/api/health`);
assert.equal(health.status, 200);
assert.deepEqual(await health.json(), { ok: true });

await writeFile(beat, 'ok\n');
const fresh = await ready();
assert.equal(fresh.status, 200);
assert.equal(fresh.body.ok, true);
assert.equal(fresh.body.checks.db, 'ok');
assert.equal(fresh.body.checks.evidence, 'ok');
assert.equal(fresh.body.checks.queue, 'ok');
assert.equal(fresh.body.checks.worker, 'ok');
assert.equal(fresh.body.checks.backup, 'not_configured');
assert.equal(JSON.stringify(fresh.body).includes('postgres://'), false);

const old = new Date(Date.now() - 60_000);
await utimes(beat, old, old);
const stale = await ready();
assert.equal(stale.status, 503);
assert.equal(stale.body.checks.worker, 'stale');
assert.equal(JSON.stringify(stale.body).includes('postgres://'), false);

await writeFile(beat, 'ok\n');
const restored = await ready();
assert.equal(restored.status, 200);
assert.equal(restored.body.checks.worker, 'ok');
console.log(JSON.stringify({ ok: true, backup: 'not_configured', recovered: true }));

async function ready() {
  const response = await fetch(`${api}/api/ready`);
  return { status: response.status, body: await response.json() };
}
