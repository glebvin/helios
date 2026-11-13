// Crew tab on a disposable database. Refuses every port except the R28 contour.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { hashPassword } from '../apps/api/src/password.ts';

const api = process.env.HELIOS_R28_API ?? 'http://127.0.0.1:4373';
const web = process.env.HELIOS_R28_WEB ?? 'http://127.0.0.1:5238';
const adminUrl = new URL(process.env.HELIOS_R28_ADMIN_DATABASE_URL ?? 'postgres://helios:helios@127.0.0.1:54433/helios');
assert.equal(adminUrl.hostname, '127.0.0.1');
const review = process.env.HELIOS_RELEASE_REVIEW === '1';
const dbPort = review ? '54360' : '54433';
assert.equal(adminUrl.port, dbPort);
assert.equal(new URL(api).hostname, '127.0.0.1');
assert.equal(new URL(api).port, review ? '14369' : '4373');
assert.equal(new URL(web).hostname, '127.0.0.1');
assert.equal(new URL(web).port, review ? '15219' : '5238');
const out = '.data/r28';
await mkdir(out, { recursive: true });
const tenantId = randomUUID();
const organizationId = randomUUID();
const projectId = randomUUID();
const suffix = tenantId.slice(0, 6);
const password = `Local!${randomBytes(7).toString('hex')}`;
const accounts = [
  ['director', 'Руководитель состава', 'rp'],
  ['other', 'Второе окно', 'rp2'],
  ['master', 'Павел Прораб', 'master'],
  ['worker', 'Иван Работник', 'worker'],
].map(([role, name, prefix]) => ({
  id: randomUUID(), role: role === 'other' ? 'director' : role, name, email: `${prefix}.${suffix}@r28.test`, password,
  ...(role === 'director' || role === 'other' ? {} : { employeeId: randomUUID() }),
}));
const director = accounts[0];
const other = accounts[1];
const master = accounts[2];
const worker = accounts[3];
const db = new pg.Client({ connectionString: adminUrl.href });
await db.connect();
assert.equal(String((await db.query('SELECT inet_server_port() port')).rows[0].port), dbPort);
try {
  await db.query('BEGIN');
  await db.query('INSERT INTO tenants(id, name) VALUES($1, $2)', [tenantId, 'Изолированные бригады R28']);
  await db.query("INSERT INTO organizations(tenant_id, id, kind, name) VALUES($1, $2, 'own', $3)", [tenantId, organizationId, 'Компания R28']);
  for (const account of accounts) {
    await db.query('INSERT INTO users(id, email, name, password_hash) VALUES($1, $2, $3, $4)', [account.id, account.email, account.name, hashPassword(account.password)]);
    await db.query('INSERT INTO memberships(tenant_id, user_id, role) VALUES($1, $2, $3)', [tenantId, account.id, account.role]);
    if (account.employeeId) await db.query('INSERT INTO employees(tenant_id, id, organization_id, user_id, full_name) VALUES($1, $2, $3, $4, $5)', [tenantId, account.employeeId, organizationId, account.id, account.name]);
  }
  await db.query('INSERT INTO projects(tenant_id, id, name) VALUES($1, $2, $3)', [tenantId, projectId, 'Площадка R28']);
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally { await db.end(); }
await writeFile(`${out}/access.md`, `# Локальные бригады R28\n\nНе публиковать.\n\n${accounts.map((account) => `- ${account.email} / ${account.password}`).join('\n')}\n`, { mode: 0o600 });

async function session(account) {
  const response = await fetch(`${api}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
  assert.equal(response.status, 201, await response.clone().text());
  return { authorization: `Bearer ${(await response.json()).token}`, 'x-tenant-id': tenantId, 'content-type': 'application/json' };
}
async function call(headers, method, path, data, status) {
  const response = await fetch(`${api}/api/v1${path}`, { method, headers, ...(data ? { body: JSON.stringify(data) } : {}) });
  const text = await response.text();
  if (status) assert.equal(response.status, status, `${method} ${path} ${text}`);
  else assert.ok(response.ok, `${method} ${path} ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
const directorHeaders = await session(director);
const command = (extra) => ({ requestId: randomUUID(), ...extra });
await call(directorHeaders, 'PUT', `/projects/${projectId}/memberships/${master.id}`, command({ expectedVersion: 0, status: 'active' }));
const admission = await call(directorHeaders, 'POST', `/projects/${projectId}/admission-template`, command({ code: 'safe', title: 'Допуск', items: [{ id: 'safe', label: 'Инструктаж', critical: true }], requiredQualificationCodes: [] }));
const check = await call(directorHeaders, 'POST', `/employees/${worker.employeeId}/admission-checks`, command({ projectId, templateVersion: admission.version, answers: [{ itemId: 'safe', value: true }] }));
await call(directorHeaders, 'PUT', `/projects/${projectId}/assignments/${worker.employeeId}`, command({ expectedVersion: 0, status: 'active', admissionCheckId: check.id }));

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
const contexts = [];
let current;
async function login(account, width = 1280) {
  const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 } });
  contexts.push(context);
  const page = await context.newPage();
  current = page;
  page.setDefaultTimeout(20000);
  await page.goto(web);
  await page.getByLabel('Логин', { exact: true }).fill(account.email);
  await page.getByLabel('Пароль', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Читаем вход, объект и день'));
  await page.getByLabel('Объект', { exact: true }).selectOption(projectId);
  return page;
}
async function openCrews(page) {
  await page.locator('.nav-item').filter({ hasText: /^Люди$/ }).click();
  await page.getByRole('tab', { name: 'Бригады', exact: true }).click();
  await page.getByRole('region', { name: 'Бригады', exact: true }).waitFor();
}
try {
  const first = await login(director, 390);
  await openCrews(first);
  await first.getByText('Бригад нет', { exact: true }).waitFor();
  assert.ok(await first.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await first.getByLabel('Название бригады', { exact: true }).fill('Бригада дня');
  await first.getByRole('button', { name: 'Создать бригаду', exact: true }).click();
  await first.getByRole('row').filter({ hasText: 'Бригада дня' }).click();
  await first.getByLabel('Сотрудник', { exact: true }).selectOption({ label: worker.name });
  await first.getByRole('button', { name: 'В состав', exact: true }).click();
  await first.getByText(worker.name, { exact: true }).waitFor();
  await first.getByText('Допуск актуален', { exact: false }).waitFor();
  assert.ok(await first.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'populated crew at 390px');

  const second = await login(other);
  await openCrews(second);
  await second.getByRole('row').filter({ hasText: 'Бригада дня' }).click();
  await second.getByText(worker.name, { exact: true }).waitFor();
  await first.getByRole('button', { name: 'Снять', exact: true }).click();
  await first.getByText('Снят', { exact: true }).waitFor();
  await second.reload();
  await second.waitForFunction(() => !document.body.innerText.includes('Читаем вход, объект и день'));
  await openCrews(second);
  await second.getByRole('row').filter({ hasText: 'Бригада дня' }).click();
  await second.getByText('Снят', { exact: true }).waitFor();
  await second.getByText('Версия 2', { exact: false }).waitFor();

  const masterPage = await login(master);
  await masterPage.locator('.nav-item').filter({ hasText: /^Работники$/ }).click();
  await masterPage.getByRole('tab', { name: 'Работники', exact: true }).waitFor();
  assert.equal(await masterPage.getByRole('tab', { name: 'Бригады', exact: true }).count(), 0);
  const denied = await call(await session(master), 'POST', `/projects/${projectId}/crews`, command({ name: 'Чужая' }), 403);
  assert.equal(denied.error, 'role_denied');

  const clock = await call(directorHeaders, 'GET', '/overview');
  const zone = await call(directorHeaders, 'POST', `/projects/${projectId}/zones`, command({ name: 'Секция' }));
  const workType = await call(directorHeaders, 'POST', `/projects/${projectId}/work-types`, command({ name: 'Кладка', unit: 'м3', requiresRd: false, requiresMaterialControl: false, requiresPredecessorAcceptance: false, requiresId: false }));
  const front = await call(directorHeaders, 'POST', `/projects/${projectId}/front-template`, command({ code: 'front', title: 'Фронт', items: [{ id: 'ready', label: 'Готово', critical: true }] }));
  let task = await call(directorHeaders, 'POST', `/projects/${projectId}/tasks`, command({ zoneId: zone.id, workTypeId: workType.id, title: 'Кладка без умножения', workDate: clock.day, plannedQuantity: '2.500', assigneeEmployeeId: worker.employeeId, responsibleUserId: director.id, plannedStart: `${clock.day}T08:00:00+03:00`, plannedEnd: `${clock.day}T18:00:00+03:00`, rdReference: null }));
  await call(directorHeaders, 'POST', `/projects/${projectId}/tasks/${task.id}/front-checks`, command({ expectedVersion: task.version, templateVersion: front.version, answers: [{ itemId: 'ready', value: true }] }));
  task = await call(directorHeaders, 'GET', `/projects/${projectId}/tasks/${task.id}`);
  task = await call(directorHeaders, 'POST', `/projects/${projectId}/tasks/${task.id}/submit`, command({ expectedVersion: task.version }));
  task = await call(directorHeaders, 'GET', `/projects/${projectId}/tasks/${task.id}`);
  const assignment = (await call(directorHeaders, 'GET', `/projects/${projectId}/assignments?limit=20`)).items.find((row) => row.employeeId === worker.employeeId);
  await call(directorHeaders, 'PUT', `/projects/${projectId}/assignments/${worker.employeeId}`, command({ expectedVersion: assignment.version, status: 'revoked' }));
  const blocked = await call(directorHeaders, 'POST', `/projects/${projectId}/tasks/${task.id}/publish`, command({ expectedVersion: task.version }), 422);
  assert.equal(blocked.error, 'task_not_ready');
  await first.reload();
  await first.getByLabel('Объект', {exact:true}).selectOption(projectId);
  await openCrews(first);
  await first.getByRole('row').filter({hasText:'Бригада дня'}).click();
  await first.getByText(worker.name, {exact:true}).waitFor();
  assert.equal(await first.getByText('Имя не пришло', {exact:true}).count(), 0);
  await first.screenshot({path:`${out}/history-after-assignment-revoked.png`,fullPage:true});
  console.log(JSON.stringify({ ok: true, crew: 'removed member stays visible', publish: 422 }));
} catch (error) {
  if (current) {
    await current.screenshot({ path: `${out}/failure.png`, fullPage: true }).catch(() => {});
    await writeFile(`${out}/failure.txt`, await current.locator('body').innerText().catch(() => ''));
  }
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser.close();
}
