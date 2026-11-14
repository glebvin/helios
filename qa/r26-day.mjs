// One disposable day: admission, published task, shift, volume, file, timesheet, Excel.
// Refuses every database except the local R26 port. Does not seed or reset another stand.
// Physical phones are not this script. Width 390 is a desktop viewport.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes, randomUUID} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import pg from 'pg';
import {hashPassword} from '../apps/api/src/password.ts';

const api = process.env.HELIOS_R26_API ?? 'http://127.0.0.1:4371';
const web = process.env.HELIOS_R26_WEB ?? 'http://127.0.0.1:5236';
const adminUrl = new URL(process.env.HELIOS_R26_ADMIN_DATABASE_URL ?? 'postgres://helios:helios@127.0.0.1:54431/helios');
assert.equal(adminUrl.hostname, '127.0.0.1');
const review = process.env.HELIOS_RELEASE_REVIEW === '1';
const privacy = process.env.HELIOS_PRIVACY_REVIEW === '1';
assert.ok(!(review && privacy), 'Select one isolated QA contour');
const dbPort = privacy ? '54447' : review ? '54360' : '54431';
assert.equal(adminUrl.port, dbPort);
assert.equal(new URL(api).hostname, '127.0.0.1');
assert.equal(new URL(api).port, privacy ? '4383' : review ? '14369' : '4371');
assert.equal(new URL(web).hostname, '127.0.0.1');
assert.equal(new URL(web).port, privacy ? '5240' : review ? '15219' : '5236');
const out = `.data/r26/${process.env.HELIOS_R26_BROWSER ?? 'chromium'}`;
await mkdir(out, {recursive: true});
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const tenantId = randomUUID();
const organizationId = randomUUID();
const projectId = randomUUID();
const suffix = tenantId.slice(0, 6);
const password = `Local!${randomBytes(7).toString('hex')}`;
const accounts = [
  ['director', 'Руководитель дня', 'rp'],
  ['master', 'Павел Прораб', 'master'],
  ['worker', 'Иван Работник', 'worker'],
  ['pto', 'Ольга ПТО', 'pto'],
].map(([role, name, prefix]) => ({
  id: randomUUID(), role, name, email: `${prefix}.${suffix}@r26.test`, password,
  ...(role === 'director' ? {} : {employeeId: randomUUID()}),
}));
const worker = accounts.find((item) => item.role === 'worker');
const master = accounts.find((item) => item.role === 'master');
const pto = accounts.find((item) => item.role === 'pto');

const db = new pg.Client({connectionString: adminUrl.href});
await db.connect();
assert.equal(String((await db.query('SELECT inet_server_port() port')).rows[0].port), dbPort);
if (privacy) assert.equal((await db.query('SHOW data_directory')).rows[0].data_directory, join(process.cwd(), '.data/pg-54447'));
try {
  await db.query('BEGIN');
  await db.query('INSERT INTO tenants(id, name) VALUES($1, $2)', [tenantId, 'Изолированный день R26']);
  await db.query("INSERT INTO organizations(tenant_id, id, kind, name) VALUES($1, $2, 'own', $3)", [tenantId, organizationId, 'Компания дня R26']);
  for (const account of accounts) {
    await db.query('INSERT INTO users(id, email, name, password_hash) VALUES($1, $2, $3, $4)', [account.id, account.email, account.name, hashPassword(account.password)]);
    await db.query('INSERT INTO memberships(tenant_id, user_id, role) VALUES($1, $2, $3)', [tenantId, account.id, account.role]);
    if (account.employeeId) await db.query('INSERT INTO employees(tenant_id, id, organization_id, user_id, full_name) VALUES($1, $2, $3, $4, $5)', [tenantId, account.employeeId, organizationId, account.id, account.name]);
  }
  await db.query('INSERT INTO projects(tenant_id, id, name) VALUES($1, $2, $3)', [tenantId, projectId, 'Учебная площадка R26']);
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}
await writeFile(`${out}/access.md`, `# Локальный день R26\n\nНе публиковать.\n\n${accounts.map((account) => `- ${account.role}: ${account.email} / ${account.password}`).join('\n')}\n`, {mode: 0o600});

async function session(role) {
  const account = accounts.find((item) => item.role === role);
  const response = await fetch(`${api}/api/v1/auth/login`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({email: account.email, password: account.password})});
  assert.equal(response.status, 201, await response.clone().text());
  const body = await response.json();
  return {authorization: `Bearer ${body.token}`, 'x-tenant-id': tenantId, 'content-type': 'application/json'};
}
async function call(headers, method, path, data) {
  const response = await fetch(`${api}/api/v1${path}`, {method, headers, ...(data ? {body: JSON.stringify(data)} : {})});
  const text = await response.text();
  assert.ok(response.ok, `${method} ${path} ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const directorHeaders = await session('director');
const command = (extra) => ({requestId: randomUUID(), ...extra});
const clock = await call(directorHeaders, 'GET', '/overview');
await call(directorHeaders, 'PUT', `/projects/${projectId}/memberships/${master.id}`, command({expectedVersion: 0, status: 'active'}));
await call(directorHeaders, 'PUT', `/projects/${projectId}/memberships/${pto.id}`, command({expectedVersion: 0, status: 'active'}));
const admission = await call(directorHeaders, 'POST', `/projects/${projectId}/admission-template`, command({code: 'safe', title: 'Допуск дня', items: [{id: 'safe', label: 'Инструктаж', critical: true}], requiredQualificationCodes: []}));
const check = await call(directorHeaders, 'POST', `/employees/${worker.employeeId}/admission-checks`, command({projectId, templateVersion: admission.version, answers: [{itemId: 'safe', value: true}]}));
await call(directorHeaders, 'PUT', `/projects/${projectId}/assignments/${worker.employeeId}`, command({expectedVersion: 0, status: 'active', admissionCheckId: check.id}));
const zone = await call(directorHeaders, 'POST', `/projects/${projectId}/zones`, command({name: 'Секция дня'}));
const workType = await call(directorHeaders, 'POST', `/projects/${projectId}/work-types`, command({name: 'Кладка', unit: 'м3', requiresRd: false, requiresMaterialControl: false, requiresPredecessorAcceptance: false, requiresId: false}));
const front = await call(directorHeaders, 'POST', `/projects/${projectId}/front-template`, command({code: 'front', title: 'Фронт дня', items: [{id: 'ready', label: 'Готово', critical: true}]}));
let task = await call(directorHeaders, 'POST', `/projects/${projectId}/tasks`, command({zoneId: zone.id, workTypeId: workType.id, title: 'Кладка секции дня', workDate: clock.day, plannedQuantity: '2.500', assigneeEmployeeId: worker.employeeId, responsibleUserId: master.id, plannedStart: `${clock.day}T08:00:00+03:00`, plannedEnd: `${clock.day}T18:00:00+03:00`, rdReference: null}));
await call(directorHeaders, 'POST', `/projects/${projectId}/tasks/${task.id}/front-checks`, command({expectedVersion: task.version, templateVersion: front.version, answers: [{itemId: 'ready', value: true}]}));
task = await call(directorHeaders, 'GET', `/projects/${projectId}/tasks/${task.id}`);
for (const action of ['submit', 'publish']) task = await call(directorHeaders, 'POST', `/projects/${projectId}/tasks/${task.id}/${action}`, command({expectedVersion: task.version}));
assert.equal(task.status, 'published');

const browserName = process.env.HELIOS_R26_BROWSER ?? 'chromium';
const playwright = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await playwright[browserName].launch({headless: true, ...(browserName === 'chromium' && process.env.CHROMIUM_EXECUTABLE ? {executablePath: process.env.CHROMIUM_EXECUTABLE} : {})});
const contexts = [];
const profiles = [];
const results = [];
const errors = [];
const shiftCommands = [];
let current;
const pass = (name) => { results.push(name); console.log('PASS', name); };
async function login(role, width = 1280) {
  const account = accounts.find((item) => item.role === role);
  const options = {viewport: {width, height: width === 390 ? 844 : 900}, acceptDownloads: true, serviceWorkers: 'block'};
  const profile = browserName === 'webkit' ? await mkdtemp(join(tmpdir(), 'helios-r26-webkit-')) : null;
  if (profile) profiles.push(profile);
  const context = profile ? await playwright.webkit.launchPersistentContext(profile, {...options, headless: true}) : await browser.newContext(options);
  contexts.push(context);
  if (privacy) await context.addInitScript(() => {
    globalThis.__heliosGeoReads = 0;
    Object.defineProperty(navigator, 'geolocation', { configurable: true, get() {
      globalThis.__heliosGeoReads += 1;
      return { getCurrentPosition(success) { success({coords: {latitude: 55.75, longitude: 37.62, accuracy: 12}, timestamp: Date.now()}); } };
    } });
  });
  const page = await context.newPage();
  current = page;
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  if (privacy) page.on('request', request => {
    if (request.method() !== 'POST' || !new URL(request.url()).pathname.endsWith('/api/v1/execution/events')) return;
    for (const event of request.postDataJSON()?.events ?? []) {
      if (event.kind === 'shift_start' || event.kind === 'shift_end') shiftCommands.push(event);
    }
  });
  await page.goto(web);
  await page.getByLabel('Логин', {exact: true}).fill(account.email);
  await page.getByLabel('Пароль', {exact: true}).fill(account.password);
  await page.getByRole('button', {name: 'Войти', exact: true}).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Читаем вход, объект и день'));
  return page;
}
async function headers(page) {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('helios.session'));
    return {authorization: `Bearer ${stored.token}`, 'x-tenant-id': stored.tenantId, 'content-type': 'application/json'};
  });
}
async function pageApi(page, method, path, data) {
  const response = await page.request.fetch(`${web}/api/v1${path}`, {method, headers: await headers(page), ...(data ? {data} : {})});
  const text = await response.text();
  return {status: response.status(), body: text ? JSON.parse(text) : null};
}
async function endShift(page) {
  const thumb = page.getByRole('button', {name: 'Сдвиньте, чтобы закончить смену', exact: true});
  const box = await thumb.boundingBox();
  const track = await page.locator('.end-slide').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  for (let step = 1; step <= 20; step++) {
    await page.mouse.move(box.x + box.width / 2 + (track.x + track.width - 25 - box.x - box.width / 2) * step / 20, box.y + box.height / 2);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.getByRole('button', {name: 'Начать смену', exact: true}).waitFor();
}
async function assertEventually(check) {
  for (let i = 0; i < 100; i++) { try { return await check(); } catch (error) { if (i === 99) throw error; await new Promise(resolve => setTimeout(resolve, 200)); } }
}
try {
  const workerPage = await login('worker', 390);
  await workerPage.getByRole('heading', {name: 'Моя смена', exact: true}).waitFor();
  await workerPage.getByRole('heading', {name: 'Кладка секции дня', exact: true}).waitFor();
  assert.equal(await workerPage.getByRole('button', {name: 'Создать задание', exact: true}).count(), 0);
  assert.ok(await workerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  if (privacy) await workerPage.screenshot({path: `${out}/privacy-worker-390.png`, fullPage: true});
  pass('worker sees the published task; 390px does not overflow; this is not a phone');

  const writes = [];
  await workerPage.route('**/api/v1/execution/events', async (route) => {
    writes.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (writes.length === 1) await route.abort();
    else await route.fulfill({response});
  });
  await workerPage.getByRole('button', {name: 'Начать смену', exact: true}).click();
  const start = workerPage.getByRole('dialog');
  await start.getByRole('button', {name: 'Начать смену', exact: true}).click();
  await start.waitFor({state: 'hidden'});
  await workerPage.locator('.worker-interval').getByRole('button', {name: 'В работу', exact: true}).waitFor();
  // The durable queue retries automatically; there is no second modal submission.
  await assertEventually(() => assert.equal(writes.length, 2));
  await workerPage.unroute('**/api/v1/execution/events');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0], writes[1]);
  const shifts = await pageApi(workerPage, 'GET', `/projects/${projectId}/execution/shifts?employeeId=${worker.employeeId}&limit=100`);
  assert.equal(shifts.body.total, 1);
  pass('lost start response retries the same body and leaves one open shift');

  await workerPage.locator('.worker-interval').getByRole('button', {name: 'В работу', exact: true}).click();
  const work = workerPage.getByRole('dialog');
  await work.getByRole('button', {name: 'В работу', exact: true}).click();
  await work.waitFor({state: 'hidden'});
  await workerPage.locator('.worker-interval').getByText('Работа', {exact: false}).waitFor();
  await workerPage.waitForTimeout(1200);
  await endShift(workerPage);
  pass('work interval and the end gesture close one shift');

  await workerPage.getByRole('button', {name: 'Сдать объём', exact: true}).click();
  const volume = workerPage.getByRole('dialog');
  await volume.getByLabel('Объём, м3', {exact: true}).fill('1,125');
  await volume.getByRole('button', {name: 'Сдать объём', exact: true}).click();
  await volume.waitFor({state: 'hidden'});
  await workerPage.getByText('1.125 м3', {exact: true}).waitFor();
  await workerPage.getByText('Не принято', {exact: true}).waitFor();
  const reports = await pageApi(workerPage, 'GET', `/projects/${projectId}/execution/reports?employeeId=${worker.employeeId}&limit=100`);
  assert.equal(reports.body.items.length, 1);
  assert.equal(reports.body.items[0].submittedQuantity, '1.125');
  assert.equal(reports.body.items[0].provisional, true);
  assert.equal(reports.body.items[0].acceptedQuantity, null);
  pass('comma quantity is stored once and is not called accepted');

  await workerPage.getByRole('button', {name: 'Добавить фото', exact: true}).click();
  const file = workerPage.getByRole('dialog');
  await file.getByLabel('Файл', {exact: true}).setInputFiles({name: 'r26-day.png', mimeType: 'image/png', buffer: png});
  await file.getByRole('button', {name: 'Отправить файл', exact: true}).click();
  await workerPage.getByText('Сохранён r26-day.png.').first().waitFor();
  const [download] = await Promise.all([
    workerPage.waitForEvent('download'),
    workerPage.getByRole('button', {name: 'Открыть', exact: true}).click(),
  ]);
  assert.deepEqual(await readFile(await download.path()), png);
  await workerPage.reload();
  await workerPage.waitForFunction(() => !document.body.innerText.includes('Читаем вход, объект и день'));
  await workerPage.getByText('Сохранён r26-day.png.').first().waitFor();
  pass('attached file downloads the same bytes and remains after reload');

  if (privacy) await workerPage.context().setOffline(true);
  await workerPage.getByRole('button', {name: 'Начать смену', exact: true}).click();
  await workerPage.getByRole('dialog').getByRole('button', {name: 'Начать смену', exact: true}).click();
  await workerPage.getByRole('dialog').waitFor({state: 'hidden'});
  if (privacy) {
    await workerPage.getByText('Ожидает отправки', {exact: true}).first().waitFor();
    assert.equal(await workerPage.evaluate(() => globalThis.__heliosGeoReads), 0);
    await workerPage.context().setOffline(false);
  }
  await workerPage.locator('.worker-interval').getByRole('button', {name: 'В работу', exact: true}).waitFor();
  await endShift(workerPage);
  const closed = await pageApi(workerPage, 'GET', `/projects/${projectId}/execution/shifts?employeeId=${worker.employeeId}&limit=100`);
  assert.equal(closed.body.items.filter((shift) => shift.endedAt).length, 2);
  assert.equal(await workerPage.getByRole('button', {name: 'Сдать объём', exact: true}).count(), 0);
  await workerPage.getByText('Не принято', {exact: true}).waitFor();
  pass('a second closed shift leaves the unaccepted report and does not offer another volume');

  async function openDirectorDay(page) {
    await page.getByLabel('Объект', {exact: true}).selectOption(projectId);
    await page.locator('.nav-item').filter({hasText: /^Люди$/}).click();
    await page.getByRole('tab', {name: 'Табель', exact: true}).click();
    await page.getByLabel('Начало периода').fill(clock.day);
    await page.getByLabel('Конец периода').fill(clock.day);
    const row = page.getByRole('row').filter({hasText: worker.name});
    await row.click();
    await page.getByRole('button', {name: 'Утвердить', exact: true}).waitFor();
    const marked = page.getByRole('checkbox', {name: 'Источник помечен, я это вижу'});
    if (await marked.count()) await marked.check();
    return row;
  }
  const director = await login('director');
  const other = await login('director');
  const row = await openDirectorDay(director);
  await openDirectorDay(other);
  await director.getByLabel('Причина решения').fill('Сквозной день');
  const approved = director.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/approvals'));
  await director.getByRole('button', {name: 'Утвердить', exact: true}).click();
  assert.equal((await approved).status(), 201);
  await row.getByText('Совпадает', {exact: true}).waitFor();
  await other.getByLabel('Причина решения').fill('Второе окно');
  const conflict = other.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/approvals'));
  await other.getByRole('button', {name: 'Утвердить', exact: true}).click();
  assert.equal((await conflict).status(), 409);
  await other.getByRole('alert').filter({hasText: 'Версия этого дня уже другая. Решение не повторяю.'}).waitFor();
  pass('two director windows: the first approval stands and the second is refused');
  const downloading = director.waitForEvent('download');
  await director.getByRole('button', {name: 'Скачать Excel', exact: true}).click();
  const workbook = await downloading;
  await workbook.saveAs(`${out}/time.xlsx`);
  const parsed = JSON.parse(execFileSync('python3', ['apps/api/test/inspect-time-xlsx.py', `${out}/time.xlsx`], {encoding: 'utf8'}));
  assert.ok(JSON.stringify(parsed).includes(worker.name));
  pass('the approved workbook names the worker');

  const ptoPage = await login('pto');
  await ptoPage.getByLabel('Объект', {exact: true}).selectOption(projectId);
  await ptoPage.locator('.nav-item').filter({hasText: /^Табель$/}).click();
  await ptoPage.getByLabel('Начало периода').fill(clock.day);
  await ptoPage.getByLabel('Конец периода').fill(clock.day);
  await ptoPage.getByRole('row').filter({hasText: worker.name}).waitFor();
  assert.equal(await ptoPage.getByRole('button', {name: 'Утвердить', exact: true}).count(), 0);
  const denied = await pageApi(ptoPage, 'POST', `/projects/${projectId}/time/employees/${worker.employeeId}/days/${clock.day}/approvals`, {requestId: randomUUID(), expectedApprovalVersion: 1, sourceHash: 'a'.repeat(64), reason: 'Нельзя'});
  assert.equal(denied.status, 403);
  pass('PTO reads the timesheet and the server refuses the decision');

  assert.equal(await workerPage.getByRole('tab', {name: 'Табель', exact: true}).count(), 0);
  const workerExport = await workerPage.request.get(`${web}/api/v1/projects/${projectId}/time/export.xlsx?from=${clock.day}&to=${clock.day}`, {headers: await headers(workerPage)});
  assert.equal(workerExport.status(), 403);
  pass('worker has no timesheet control and cannot export');
  if (privacy) {
    assert.ok(shiftCommands.length >= 4, 'exercise actual new start/end requests');
    for (const event of shiftCommands) assert.equal('geo' in event, false, 'new UI command must not contain coordinates');
    let checkedPages = 0;
    for (const context of contexts) for (const page of context.pages()) {
      if (new URL(page.url()).origin !== new URL(web).origin) continue;
      checkedPages += 1;
      assert.equal(await page.evaluate(() => globalThis.__heliosGeoReads), 0, 'browser location API must not be read');
    }
    assert.equal(checkedPages, contexts.length, 'verify each actual application page, excluding initial about:blank');
    pass('online/offline and lost-ack shift commands never access location or send geo');
    const audit = new pg.Client({connectionString: adminUrl.href});
    await audit.connect();
    try {
      const version = Number((await audit.query('SELECT version FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2', [tenantId, worker.employeeId])).rows[0].version);
      const occurredAt = new Date().toISOString();
      const oldStart = {kind: 'shift_start', requestId: randomUUID(), employeeId: worker.employeeId, projectId, shiftId: randomUUID(), expectedVersion: version, occurredAt,
        geo: {latitude: 55.75, longitude: 37.62, accuracyMeters: 12, capturedAt: occurredAt}};
      for (const event of [oldStart, {...oldStart, kind: 'shift_end', requestId: randomUUID(), expectedVersion: Number(version) + 1, occurredAt: new Date(Date.now() + 1).toISOString(), previousEventId: oldStart.requestId}]) {
        const first = await pageApi(workerPage, 'POST', '/execution/events', {events: [event]});
        const repeat = await pageApi(workerPage, 'POST', '/execution/events', {events: [event]});
        assert.equal(first.status, 200, JSON.stringify(first.body));
        assert.equal(first.body.results[0].outcome, 'success');
        assert.equal(repeat.body.results[0].outcome, 'duplicate');
        const rows = await audit.query('SELECT original_payload FROM managed_execution_events WHERE tenant_id=$1 AND request_id=$2', [tenantId, event.requestId]);
        assert.equal(rows.rowCount, 1);
        assert.deepEqual(rows.rows[0].original_payload.geo, event.geo);
      }
      pass('legacy-shaped API retries keep request identity and original payload; no destructive rewrite');
    } finally { await audit.end(); }

  }
  assert.deepEqual(errors, []);
} catch (error) {
  if (current) {
    await current.screenshot({path: `${out}/failure.png`, fullPage: true}).catch(() => {});
    await writeFile(`${out}/failure.txt`, await current.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {
  await writeFile(`${out}/results.json`, JSON.stringify({browser: browserName, results, errors, day: clock.day, projectId}, null, 2));
  for (const context of contexts) await context.close();
  await browser.close();
  for (const profile of profiles) await rm(profile, {recursive:true,force:true});
}
console.log(JSON.stringify({ok: true, browser: browserName, steps: results.length}));
