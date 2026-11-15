import assert from 'node:assert/strict';
import { realpathSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID as id } from 'node:crypto';
import { chromium } from 'playwright';
import pg from 'pg';
import { hashPassword } from '../src/password.js';

const port = Number(process.env.HELIOS_PRIMARY_QA_DB_PORT ?? 54583);
assert.ok([54583,54597].includes(port));
const api = `http://127.0.0.1:${port === 54597 ? 4413 : 4399}`;
const web = `http://127.0.0.1:${port === 54597 ? 5284 : 5278}`;
const admin = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${port}/helios` });
const tenant = id(), org = id(), project = id(), task = id();
const worker = id(), master = id(), hr = id(), employee = id(), masterEmployee = id();
const users = [worker, master, hr];
const day = '2026-11-01';
const password = 'primary-password';

await admin.connect();
const actual = (await admin.query(`SELECT inet_server_addr()::text addr, inet_server_port() port, current_setting('data_directory') dir`)).rows[0];
assert.equal(String(actual.addr).startsWith('127.0.0.1'), true, actual.addr);
assert.equal(Number(actual.port), port);
assert.equal(realpathSync(actual.dir),realpathSync(fileURLToPath(new URL(`../../../.data/pg-${port}`,import.meta.url))));

await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Кабинет','Europe/Moscow')`, [tenant]);
for (const [user, name] of [[master, 'Павел Мастер'], [hr, 'Ольга Кадры'], [worker, 'Иван Рабочий']] as const) {
  await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)`, [user, `${user}@day.test`, name, hashPassword(password)]);
}
await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'master'),($1,$3,'hr'),($1,$4,'worker')`, [tenant, master, hr, worker]);
await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект')`, [tenant, project]);
await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя')`, [tenant, org]);
await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,'Иван Рабочий'),($1,$5,$3,$6,'Павел Мастер')`, [tenant, employee, org, worker, masterEmployee, master]);
await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3),($1,$2,$4)`, [tenant, project, master, hr]);
await admin.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id) VALUES($1,$2,$3)`, [tenant, project, employee]);
await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Кладка',$4,1,'м2',$5)`, [tenant, task, project, day, employee]);
await shift(day);
await admin.end();

const browser = await chromium.launch({ headless: true });
const masterContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const hrContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const traces: unknown[] = [];
for (const context of [masterContext,hrContext]) context.on("response",async response=>{if(response.url().includes("/time/"))traces.push({url:response.url(),status:response.status(),body:await response.json().catch(()=>null)})});
try {
  const masterPage = await masterContext.newPage();
  const hrPage = await hrContext.newPage();
  await enter(masterPage, master);
  await masterPage.getByRole('button', { name: 'Работники' }).click();
  await masterPage.getByRole('tab', { name: 'Табель' }).click();
  const primary = masterPage.getByRole('region', { name: 'Первичный день' });
  await primary.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await primary.getByRole('cell', { name: 'Иван Рабочий' }).waitFor();
  const text = await primary.innerText();
  for (const word of ['Работа', 'Перерыв', 'Простой']) assert.ok(text.includes(word), text);
  let lostClose: unknown = null;
  await masterPage.route('**/time/primary-days/*/close', async (route) => {
    lostClose = route.request().postDataJSON();
    const response = await route.fetch(); assert.equal(response.status(),201);
    await route.abort('failed'); await masterPage.unroute('**/time/primary-days/*/close');
  });
  await primary.getByRole('button', { name: 'Закрыть первичный день' }).click();
  await primary.getByText('Ответ сервера не подтверждён. Повтор отправит тот же запрос.',{exact:false}).waitFor();
  const retryClose=masterPage.waitForRequest(request=>request.method()==='POST'&&request.url().endsWith('/close'));
  await primary.getByRole('button', { name: 'Закрыть первичный день' }).click();
  assert.deepEqual((await retryClose).postDataJSON(),lostClose);

  await masterPage.getByRole('status').filter({ hasText: 'Первичный день закрыт.' }).waitFor();
  await masterPage.reload();
  await masterPage.getByRole('button', { name: 'Работники' }).click();
  await masterPage.getByRole('tab', { name: 'Табель' }).click();
  await primary.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await primary.getByText(/закрыл Павел Мастер/).waitFor();

  await enter(hrPage, hr);
  await hrPage.getByRole('button',{name:'Люди',exact:true}).click();
  await hrPage.getByRole('tab', { name: 'Табель' }).click();
  const personnel = hrPage.getByRole('region', { name: 'Первичный день' });
  await personnel.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await personnel.getByRole('button', { name: 'Выпустить свод' }).click();
  await hrPage.getByRole('status').filter({ hasText: 'Свод выпущен.' }).waitFor();
  await hrPage.reload();
  await hrPage.getByRole('button',{name:'Люди',exact:true}).click();
  await hrPage.getByRole('tab', { name: 'Табель' }).click();
  await personnel.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await personnel.getByText('Свод 1').waitFor();

  await masterPage.reload();
  await masterPage.getByRole('button', { name: 'Работники' }).click();
  await masterPage.getByRole('tab', { name: 'Табель' }).click();
  await primary.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await primary.getByLabel('Причина корректировки').fill('Поздний факт смены');
  await primary.getByRole('button', { name: 'Подготовить корректировку' }).click();
  await masterPage.getByRole('status').filter({ hasText: 'Корректировка подготовлена.' }).waitFor();

  await hrPage.reload();
  await hrPage.getByRole('button',{name:'Люди',exact:true}).click();
  await hrPage.getByRole('tab', { name: 'Табель' }).click();
  await personnel.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await personnel.getByRole('button', { name: 'Выпустить следующую ревизию' }).click();
  await hrPage.getByRole('status').filter({ hasText: 'Свод выпущен.' }).waitFor();
  await personnel.getByText('Свод 2').waitFor();
  await personnel.getByText('Свод 1').waitFor();

  await lateFact();
  await masterPage.reload();
  await masterPage.getByRole('button', { name: 'Работники' }).click();
  await masterPage.getByRole('tab', { name: 'Табель' }).click();
  await primary.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await primary.getByText('После закрытия пришёл ещё один факт.').waitFor();
  await primary.getByLabel('Причина корректировки').fill('Уточнить поздние полчаса');
  await primary.getByRole('button',{name:'Подготовить корректировку'}).click();
  await masterPage.getByRole('status').filter({hasText:'Корректировка подготовлена.'}).waitFor();
  await hrPage.reload();
  await hrPage.getByRole('button',{name:'Люди',exact:true}).click();
  await hrPage.getByRole('tab',{name:'Табель'}).click();
  await personnel.getByRole('textbox',{name:'День',exact:true}).fill(day);
  await personnel.getByRole('button',{name:'Выпустить следующую ревизию'}).click();
  await hrPage.getByRole('status').filter({hasText:'Свод выпущен.'}).waitFor();
  await personnel.getByText('Свод 3',{exact:true}).waitFor();
  await personnel.getByText(/В своде 3:/).waitFor();
  const session=await hrPage.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')!));
  const view=await hrPage.request.get(`${web}/api/v1/projects/${project}/time/primary-days/${day}?organizationId=${org}`,{headers:{authorization:'Bearer '+session.token,'x-tenant-id':tenant}});
  assert.equal(view.status(),200);const verified=await view.json();
  assert.equal(verified.correctionVersion,2);
  assert.equal(verified.employees[0].consolidated.presenceMs,verified.employees[0].live.presenceMs);
  assert.notEqual(verified.employees[0].consolidated.presenceMs,verified.employees[0].snapshot.presenceMs);

  await primary.getByText('Свод 2').waitFor();

  await masterPage.setViewportSize({ width: 390, height: 844 });
  await masterPage.reload();
  await masterPage.getByRole('button', { name: 'Работники' }).click();
  await masterPage.getByRole('tab', { name: 'Табель' }).click();
  await primary.getByRole('textbox', { name: 'День', exact: true }).fill(day);
  await primary.getByText('Иван Рабочий').waitFor();
  await primary.getByText('Свод 2').waitFor();
  const box = await primary.boundingBox();
  assert.ok(box && box.width <= 390, JSON.stringify(box));
  assert.ok(await masterPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await masterPage.screenshot({path:'/private/tmp/helios-primary-review-390.png',fullPage:true});
  console.log('primary day browser: desktop and390px, document width passed');
 } catch(error) {
  for(const [index,context] of [masterContext,hrContext].entries()) for(const page of context.pages()) {
    await page.screenshot({path:`/private/tmp/helios-primary-failure-${index}.png`,fullPage:true}).catch(()=>{});
    writeFileSync(`/private/tmp/helios-primary-failure-${index}.txt`,await page.locator('body').innerText());
  }
  writeFileSync('/private/tmp/helios-primary-traces.json',JSON.stringify(traces,null,2));
  throw error;
} finally {
  await browser.close();
  const cleanup = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${port}/helios` });
  await cleanup.connect();
  try {
    await cleanup.query('BEGIN');
    for (const table of ['consolidated_time_heads', 'consolidated_time_revisions', 'time_corrections', 'primary_day_closes', 'managed_execution_events', 'managed_segments', 'managed_shifts', 'managed_execution_streams', 'daily_tasks', 'employee_project_assignments', 'project_memberships', 'people_command_receipts', 'employees', 'memberships', 'projects', 'organizations', 'audit_log']) {
      await cleanup.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
    }
    await cleanup.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
    await cleanup.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`, [users]);
    await cleanup.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
    await cleanup.query('COMMIT');
  } finally { await cleanup.end(); }
}

async function enter(page: import('playwright').Page, user: string) {
  await page.goto(web);
  await page.locator('input[name="email"]').fill(`${user}@day.test`);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('button', { name: 'Работники' }).or(page.getByRole('button', { name: 'Люди' })).waitFor();
}
async function shift(civil: string) {
  const start = `${civil}T06:00:00Z`, work = `${civil}T07:00:00Z`, pause = `${civil}T09:00:00Z`, down = `${civil}T09:30:00Z`, end = `${civil}T15:00:00Z`;
  const changes = [{ at: start, mode: 'idle' }, { at: work, mode: 'work' }, { at: pause, mode: 'break' }, { at: down, mode: 'downtime' }, { at: end, mode: 'idle' }];
  const shiftId = id();
  await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id,version) VALUES($1,$2,$3)`, [tenant, employee, changes.length]);
  await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6)`, [tenant, project, employee, shiftId, start, end]);
  for (let n = 0; n < changes.length; n++) {
    const change = changes[n], request = id(), kind = n === 0 ? 'shift_start' : n === changes.length - 1 ? 'shift_end' : 'segment_change';
    await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`, [tenant, worker, request]);
    await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,repeat('b',64),'{}')`, [tenant, worker, request, employee, project, shiftId, kind, n + 1, change.at, JSON.stringify({ mode: change.mode, ...(change.mode === 'work' ? { taskId: task } : {}) })]);
    if (kind !== 'shift_end') {
      const next = changes[n + 1];
      await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,task_id,reason_code,comment,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [tenant, project, employee, shiftId, id(), change.mode, change.mode === 'work' ? task : null, change.mode === 'downtime' ? 'other' : null, change.mode === 'downtime' ? 'Ожидание фронта' : null, change.at, next.at]);
    }
  }
}
async function lateFact() {
  const client = new pg.Client({ connectionString: `postgres://helios:helios@127.0.0.1:${port}/helios` });
  await client.connect();
  try {
    const shiftId = id(), start = id(), end = id();
    await client.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,'2026-11-01T15:30:00Z','2026-11-01T16:00:00Z')`, [tenant, project, employee, shiftId]);
    for (const [request, kind, at, version] of [[start, 'shift_start', '2026-11-01T15:30:00Z', 6], [end, 'shift_end', '2026-11-01T16:00:00Z', 7]] as const) {
      await client.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('c',64),201,'{}')`, [tenant, worker, request]);
      await client.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,repeat('d',64),'{}')`, [tenant, worker, request, employee, project, shiftId, kind, version, at, JSON.stringify({ mode: 'idle' })]);
    }
    await client.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at,ended_at) VALUES($1,$2,$3,$4,$5,'idle','2026-11-01T15:30:00Z','2026-11-01T16:00:00Z')`, [tenant, project, employee, shiftId, id()]);
    await client.query(`UPDATE managed_execution_streams SET version=7 WHERE tenant_id=$1 AND employee_id=$2`, [tenant, employee]);
  } finally { await client.end(); }
}
