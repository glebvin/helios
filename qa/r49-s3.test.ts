import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {closeSync, openSync} from 'node:fs';
import {chmod, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createConnection} from 'node:net';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {EvidenceStorage, type BlobDeclaration} from '../apps/api/src/evidence-storage.ts';
import {createEvidenceStore} from '../apps/api/src/evidence-store.ts';
import {S3EvidenceStorage, evidenceObjectKey, readS3EvidenceConfig} from '../apps/api/src/s3-evidence-storage.ts';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const cache = join(root, '.data/r49');
const ports = [54521, 54523, 54524, 54525, 54531, 54533, 54534, 54535, 54536];

function pdf(text: string) {
  const bytes = Buffer.from(`%PDF-1.4\n${text}\n`);
  const declaration: BlobDeclaration = {sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType: 'application/pdf'};
  return {bytes, declaration};
}
function refused(error: unknown) {
  assert.equal((error as {getStatus?: () => number}).getStatus?.(), 503);
  return true;
}

test('filesystem adapter keeps one verified object', async () => {
  const previous = process.env.HELIOS_EVIDENCE_ROOT;
  const storageRoot = join(tmpdir(), `helios-r49-${randomUUID()}`);
  await mkdir(storageRoot, {recursive: true});
  process.env.HELIOS_EVIDENCE_ROOT = storageRoot;
  delete process.env.HELIOS_EVIDENCE_STORE;
  try {
    assert.equal(createEvidenceStore().constructor, EvidenceStorage);
    process.env.HELIOS_EVIDENCE_STORE = 'filesystem';
    const storage = createEvidenceStore();
    const one = pdf('filesystem-one');
    const other = pdf('filesystem-two');
    const tenant = randomUUID();
    const file = randomUUID();
    await storage.put(tenant, file, one.bytes, one.declaration);
    await storage.put(tenant, file, one.bytes, one.declaration);
    const read = await storage.get(tenant, file, one.declaration);
    assert.equal(read.length, one.declaration.sizeBytes);
    assert.equal(createHash('sha256').update(read).digest('hex'), one.declaration.sha256);
    assert.deepEqual(read, one.bytes);
    await assert.rejects(() => storage.put(tenant, file, other.bytes, other.declaration), refused);
    assert.deepEqual(await storage.get(tenant, file, one.declaration), one.bytes);
    await assert.rejects(() => storage.get(randomUUID(), file, one.declaration), refused);
  } finally {
    if (previous === undefined) delete process.env.HELIOS_EVIDENCE_ROOT;
    else process.env.HELIOS_EVIDENCE_ROOT = previous;
    delete process.env.HELIOS_EVIDENCE_STORE;
    await rm(storageRoot, {recursive: true, force: true});
  }
});

test('s3 adapter round-trips bytes on a private loopback store', async () => {
  for (const port of ports) {
    const listening = await new Promise<boolean>(resolve => {
      const socket = createConnection({host: '127.0.0.1', port}, () => { socket.end(); resolve(true); });
      socket.on('error', () => resolve(false));
    });
    if (listening) throw new Error(`QA port ${port} is already in use`);
  }
  const pin = JSON.parse(await readFile(join(root, 'deploy/evidence/seaweedfs-4.53.json'), 'utf8')) as {version: string; 'darwin-arm64': {url: string; sha256: string}; 'linux-amd64': {url: string; sha256: string}};
  const platform = process.platform === 'darwin' && process.arch === 'arm64' ? pin['darwin-arm64'] : process.platform === 'linux' && process.arch === 'x64' ? pin['linux-amd64'] : null;
  if (!platform) throw new Error(`no pinned SeaweedFS build for ${process.platform}/${process.arch}`);
  await mkdir(join(cache, 'cache'), {recursive: true, mode: 0o700});
  const archive = join(cache, 'cache', `${process.platform}-${process.arch}.tar.gz`);
  let compressed: Buffer | undefined;
  try { compressed = await readFile(archive); } catch { compressed = undefined; }
  if (!compressed || createHash('sha256').update(compressed).digest('hex') !== platform.sha256) {
    const response = await fetch(platform.url);
    if (!response.ok) throw new Error(`SeaweedFS download failed: ${response.status}`);
    compressed = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(compressed).digest('hex') !== platform.sha256) throw new Error('SeaweedFS checksum mismatch');
    await writeFile(archive, compressed, {mode: 0o600});
  }
  const binaryDir = join(cache, 'bin');
  await rm(binaryDir, {recursive: true, force: true});
  await mkdir(binaryDir, {recursive: true, mode: 0o700});
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-xzf', archive, '-C', binaryDir], {stdio: 'ignore'});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('tar failed')));
  });
  const accessKeyId = randomBytes(8).toString('hex');
  const secretAccessKey = randomBytes(24).toString('hex');
  const redact = (value: string) => value.split(secretAccessKey).join('[redacted]').split(accessKeyId).join('[redacted]');
  const dataDir = join(cache, 'data');
  const configPath = join(cache, 's3.json');
  await rm(dataDir, {recursive: true, force: true});
  await mkdir(dataDir, {recursive: true, mode: 0o700});
  await writeFile(configPath, JSON.stringify({identities: [{name: 'helios-qa', credentials: [{accessKey: accessKeyId, secretKey: secretAccessKey}], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging']}]}), {mode: 0o600});
  await chmod(configPath, 0o600);
  const logPath = join(cache, 'weed.log');
  const log = openSync(logPath, 'w', 0o600);
  const server = spawn(join(binaryDir, 'weed'), ['server', `-dir=${dataDir}`, '-ip=127.0.0.1', '-ip.bind=127.0.0.1', '-master.port=54523', '-master.port.grpc=54533', '-volume.port=54525', '-volume.port.grpc=54535', '-filer', '-filer.port=54524', '-filer.port.grpc=54534', '-s3', '-s3.port=54521', '-s3.port.grpc=54531', '-s3.port.iceberg=0', '-s3.port.lance=0', '-s3.ip.bind=127.0.0.1', `-s3.config=${configPath}`, '-metricsPort=54536'], {stdio: ['ignore', log, log]});
  const saved = {
    store: process.env.HELIOS_EVIDENCE_STORE,
    endpoint: process.env.HELIOS_S3_ENDPOINT,
    bucket: process.env.HELIOS_S3_BUCKET,
    region: process.env.HELIOS_S3_REGION,
    access: process.env.HELIOS_S3_ACCESS_KEY_ID,
    secret: process.env.HELIOS_S3_SECRET_ACCESS_KEY,
    fault: process.env.HELIOS_S3_INJECT_FAULT,
  };
  try {
    const started = Date.now();
    while (Date.now() - started < 30000) {
      if (server.exitCode !== null) throw new Error(`SeaweedFS exited ${server.exitCode}: ${redact(await readFile(logPath, 'utf8'))}`);
      const open = await new Promise<boolean>(resolve => {
        const socket = createConnection({host: '127.0.0.1', port: 54521}, () => { socket.end(); resolve(true); });
        socket.on('error', () => resolve(false));
      });
      if (open) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const open = await new Promise<boolean>(resolve => {
      const socket = createConnection({host: '127.0.0.1', port: 54521}, () => { socket.end(); resolve(true); });
      socket.on('error', () => resolve(false));
    });
    if (!open) throw new Error(`SeaweedFS did not listen: ${redact(await readFile(logPath, 'utf8'))}`);
    process.env.HELIOS_EVIDENCE_STORE = 's3';
    process.env.HELIOS_S3_ENDPOINT = 'http://127.0.0.1:54521';
    process.env.HELIOS_S3_BUCKET = 'helios-r49-qa';
    process.env.HELIOS_S3_REGION = 'us-east-1';
    process.env.HELIOS_S3_ACCESS_KEY_ID = accessKeyId;
    process.env.HELIOS_S3_SECRET_ACCESS_KEY = secretAccessKey;
    const storage = createEvidenceStore();
    assert.equal(storage.constructor, S3EvidenceStorage);
    const config = readS3EvidenceConfig();
    const tenant = randomUUID();
    const otherTenant = randomUUID();
    const file = randomUUID();
    const one = pdf('s3-one');
    const other = pdf('s3-two');
    await storage.put(tenant, file, one.bytes, one.declaration);
    await storage.put(tenant, file, one.bytes, one.declaration);
    const read = await storage.get(tenant, file, one.declaration);
    assert.equal(read.length, one.declaration.sizeBytes);
    assert.equal(createHash('sha256').update(read).digest('hex'), one.declaration.sha256);
    assert.deepEqual(read, one.bytes);
    await assert.rejects(() => storage.put(tenant, file, other.bytes, other.declaration), refused);
    assert.deepEqual(await storage.get(tenant, file, one.declaration), one.bytes);
    await storage.put(otherTenant, file, other.bytes, other.declaration);
    assert.deepEqual(await storage.get(tenant, file, one.declaration), one.bytes);
    assert.deepEqual(await storage.get(otherTenant, file, other.declaration), other.bytes);
    assert.notEqual(evidenceObjectKey(tenant, file), evidenceObjectKey(otherTenant, file));
    const key = evidenceObjectKey(tenant, file);
    const anonymous = await fetch(`http://127.0.0.1:54521/${config.bucket}/${key}`);
    const anonymousBytes = Buffer.from(await anonymous.arrayBuffer());
    assert.notEqual(anonymous.status, 200);
    assert.equal(anonymousBytes.equals(one.bytes), false);
    const listing = await fetch(`http://127.0.0.1:54521/${config.bucket}`);
    const listingText = Buffer.from(await listing.arrayBuffer()).toString('utf8');
    assert.equal(listingText.includes(one.declaration.sha256), false);
    assert.equal(listingText.includes(key), false);
    const interrupted = randomUUID();
    process.env.HELIOS_S3_INJECT_FAULT = 'during-put';
    await assert.rejects(() => storage.put(tenant, interrupted, one.bytes, one.declaration), refused);
    delete process.env.HELIOS_S3_INJECT_FAULT;
    await assert.rejects(() => storage.get(tenant, interrupted, one.declaration), refused);
    await storage.put(tenant, interrupted, one.bytes, one.declaration);
    assert.deepEqual(await storage.get(tenant, interrupted, one.declaration), one.bytes);
    const journal = redact(await readFile(logPath, 'utf8'));
    assert.equal(journal.includes(secretAccessKey), false);
    assert.equal(journal.includes(accessKeyId), false);
  } finally {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    closeSync(log);
    for (const [name, value] of Object.entries({HELIOS_EVIDENCE_STORE: saved.store, HELIOS_S3_ENDPOINT: saved.endpoint, HELIOS_S3_BUCKET: saved.bucket, HELIOS_S3_REGION: saved.region, HELIOS_S3_ACCESS_KEY_ID: saved.access, HELIOS_S3_SECRET_ACCESS_KEY: saved.secret, HELIOS_S3_INJECT_FAULT: saved.fault})) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(configPath, {force: true});
    await rm(dataDir, {recursive: true, force: true});
  }
});
