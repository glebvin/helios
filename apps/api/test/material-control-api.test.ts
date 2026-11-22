import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { adminUrl, createPool } from '../src/db.js';
import { AllExceptionsFilter } from '../src/http.js';
import { hashPassword } from '../src/password.js';

const admin = createPool(adminUrl);
const id = () => randomUUID();
const tenant = id(), project = id(), other = id(), org = id(), foreignOrg = id();
const zone = id(), work = id(), template = id(), batch = id(), rejectedBatch = id();
const master = id(), supply = id(), otherSupply = id(), director = id(), pto = id(), worker = id();
const employee = id(), ptoEmployee = id(), order = id();
const users = [master, supply, otherSupply, director, pto, worker];
const password = 'material-control-password';
const tokens = new Map<string, string>();
const items = [{ id: 'seal', prompt: 'Упаковка цела', kind: 'yes_no', required: true, critical: true, pass: 'yes' }];
let app: INestApplication | undefined;
let base = '';

async function call(user: string, path: string, body?: unknown, method = body ? 'POST' : 'GET') {
  const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${tokens.get(user)}`, 'x-tenant-id': tenant, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}
const step = (user: string, target: string, body: Record<string, unknown>) => call(user, `/api/v1/projects/${project}/material-batches/${target}/control`, { requestId: id(), ...body });

test.before(async () => {
  const ci=process.env.GITHUB_ACTIONS==='true'; const port=process.env.HELIOS_CONTROL_QA_DB_PORT??'54561'; assert.ok(['54561','54637'].includes(port));
  assert.equal(new URL(adminUrl).hostname,'127.0.0.1'); assert.equal(new URL(adminUrl).port,ci?'54339':port);
  const dir=(await admin.query('SHOW data_directory')).rows[0].data_directory;
  if(ci)assert.match(dir,/codex-api\/\.data\/pg-54339$/); else assert.equal(realpathSync(dir),realpathSync(fileURLToPath(new URL(`../../../.data/pg-${port}`,import.meta.url))));
  const hash = hashPassword(password);
  await admin.query(`INSERT INTO tenants(id,name) VALUES($1,'Контроль')`, [tenant]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Своя'),($1,$3,'own','Чужая')`, [tenant, org, foreignOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект'),($1,$3,'Другой')`, [tenant, project, other]);
  for (const user of users) await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'QA',$3)`, [user, `${user}@control.test`, hash]);
  for (const [user, role] of [[master, 'master'], [supply, 'supply'], [otherSupply, 'supply'], [director, 'director'], [pto, 'pto'], [worker, 'worker']] as const) {
    await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`, [tenant, user, role]);
  }
  for (const user of [master, supply, otherSupply, director, pto]) await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, project, user]);
  await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`, [tenant, other, otherSupply]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,'Кладовщик'),($1,$5,$6,$7,'Чужой'),($1,$8,$3,NULL,'Исполнитель'),($1,$9,$3,$10,'Инженер ПТО')`, [tenant, id(), org, supply, id(), foreignOrg, otherSupply, employee, ptoEmployee, pto]);
  await admin.query(`INSERT INTO responsibility_orders(tenant_id,id,organization_id,project_id,employee_id,order_number,order_date,valid_from,valid_until,document_types,status,version) VALUES($1,$2,$3,$4,$5,'ПР-ВК','2026-01-01','2026-01-01','2099-12-31',ARRAY['incoming-materials'],'active',1)`, [tenant, order, org, project, ptoEmployee]);
  await admin.query(`INSERT INTO project_work_zones(tenant_id,project_id,id,name) VALUES($1,$2,$3,'Секция')`, [tenant, project, zone]);
  await admin.query(`INSERT INTO project_work_types(tenant_id,project_id,id,name,unit,requires_rd,requires_material_control,requires_predecessor_acceptance,requires_id) VALUES($1,$2,$3,'Кладка','м3',false,true,false,false)`, [tenant, project, work]);
  await admin.query(`INSERT INTO checklist_templates(tenant_id,project_id,id,created_by) VALUES($1,$2,$3,$4)`, [tenant, project, template, director]);
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,1,'Вход',$4,'approved',1,$5)`, [tenant, project, template, JSON.stringify(items), director]);
  for (const target of [batch, rejectedBatch]) {
    await admin.query(`INSERT INTO material_batches(tenant_id,project_id,id,organization_id) VALUES($1,$2,$3,$4)`, [tenant, project, target, org]);
    await admin.query(`INSERT INTO material_batch_revisions(tenant_id,project_id,batch_id,version,material_name,unit,batch_code,supplier_name,delivery_document,delivered_on,delivered_quantity,created_by) VALUES($1,$2,$3,1,'Кирпич','шт',$4,'Завод','УПД','2026-11-16','1.000',$5)`, [tenant, project, target, target.slice(0, 8), master]);
  }
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  const server = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${server.address().port}`;
  for (const user of users) {
    const response = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${user}@control.test`, password }) });
    const body = await response.json();
    assert.equal(response.status, 201, JSON.stringify(body));
    tokens.set(user, body.token);
  }
});

test.after(async () => {
  try { await app?.close(); } finally {
    for (const table of ['material_control_steps', 'material_controls', 'daily_tasks', 'material_batch_documents', 'material_batch_revisions', 'material_batches', 'checklist_template_editions', 'checklist_templates', 'project_work_types', 'project_work_zones', 'responsibility_order_revisions', 'responsibility_orders', 'people_command_receipts', 'employees', 'project_memberships', 'memberships', 'organizations', 'projects', 'audit_log']) {
      await admin.query(`DELETE FROM ${table} WHERE tenant_id=$1`, [tenant]);
    }
    await admin.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`, [users]);
    await admin.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [users]);
    await admin.query(`DELETE FROM tenants WHERE id=$1`, [tenant]);
    await admin.end();
  }
});

test('the server accepts a batch only after the checklist and the route', async () => {
  const prepare = await step(master, batch, { expectedVersion: 0, action: 'prepare', zoneId: zone, workTypeId: work, templateId: template, answers: [{ itemId: 'seal', value: 'yes' }] });
  assert.equal(prepare.status, 201, JSON.stringify(prepare.body));
  assert.equal(prepare.body.control.verdict, 'awaiting');
  assert.equal(prepare.body.status, 'awaiting_control');
  await admin.query(`UPDATE responsibility_orders SET status='revoked', revocation_reason='проверка отзыва' WHERE id=$1`, [order]);
  const blocked = await step(pto, batch, { expectedVersion: 1, action: 'review', decision: 'agree' });
  assert.equal(blocked.status, 422);
  assert.equal(blocked.body.error, 'revoked');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM material_control_steps WHERE control_id=$1`, [prepare.body.control.id])).rows[0].n, 1);
  await admin.query(`UPDATE responsibility_orders SET status='active', revocation_reason=NULL WHERE id=$1`, [order]);
  const early = await step(pto, batch, { expectedVersion: 1, action: 'review', decision: 'agree' });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, 'route_incomplete');
  assert.equal((await step(supply, batch, { expectedVersion: 1, action: 'data', dataMark: 'provided' })).body.control.verdict, 'awaiting');
  assert.equal((await step(master, batch, { expectedVersion: 2, action: 'data', dataMark: 'provided' })).status, 403);
  assert.equal((await step(director, batch, { expectedVersion: 2, action: 'responsible' })).body.control.verdict, 'awaiting');
  for (const [update, reason] of [
    ["document_types=ARRAY['internal-inspection']", 'type'],
    ["project_id='"+other+"'", 'object'],
    ["organization_id='"+foreignOrg+"'", 'company'],
    ["valid_from=current_date-10,valid_until=current_date-1", 'expired'],
    ["valid_from=current_date+1,valid_until='2099-12-31'", 'not_started'],
  ]) {
    await admin.query(`UPDATE responsibility_orders SET ${update} WHERE id=$1`, [order]);
    try {
      const denied = await step(pto, batch, { expectedVersion: 3, action: 'review', decision: 'agree' });
      assert.equal(denied.status, 422, JSON.stringify(denied.body));
      assert.equal(denied.body.error, reason);
      assert.equal((await admin.query(`SELECT count(*)::int n FROM material_control_steps WHERE control_id=$1`, [prepare.body.control.id])).rows[0].n, 3);
    } finally {
      await admin.query(`UPDATE responsibility_orders SET organization_id=$2,project_id=$3,document_types=ARRAY['incoming-materials'],valid_from='2026-01-01',valid_until='2099-12-31' WHERE id=$1`, [order, org, project]);
    }
  }
  const orderLock = await admin.connect();
  await orderLock.query('BEGIN');
  await orderLock.query('SELECT id FROM responsibility_orders WHERE id=$1 FOR UPDATE', [order]);
  const waitingAgreement = step(pto, batch, { expectedVersion: 3, action: 'review', decision: 'agree' });
  try {
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const blocked = await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM responsibility_orders WHERE employee_id=%'");
      if (blocked.rowCount) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(waiting, true, 'Согласование должно дождаться изменения приказа');
    await orderLock.query("UPDATE responsibility_orders SET status='revoked',revocation_reason='Отозван во время ожидания' WHERE id=$1", [order]);
    await orderLock.query('COMMIT');
    const denied = await waitingAgreement;
    assert.equal(denied.status, 422);
    assert.equal(denied.body.error, 'revoked');
    assert.equal((await admin.query(`SELECT count(*)::int n FROM material_control_steps WHERE control_id=$1`, [prepare.body.control.id])).rows[0].n, 3);
  } finally {
    await orderLock.query('ROLLBACK'); orderLock.release();
    await admin.query("UPDATE responsibility_orders SET status='active',revocation_reason=NULL WHERE id=$1", [order]);
    await waitingAgreement.catch(() => {});
  }
  const agreed = await step(pto, batch, { expectedVersion: 3, action: 'review', decision: 'agree' });
  assert.equal(agreed.body.control.verdict, 'accepted');
  assert.equal(agreed.body.control.steps.length, 4);
  const reread = await call(director, `/api/v1/projects/${project}/material-batches/${batch}`);
  assert.equal(reread.body.control.verdict, 'accepted');
  const listed = await call(master, `/api/v1/projects/${project}/material-batches?usable=1&zoneId=${zone}&workTypeId=${work}`);
  assert.deepEqual(listed.body.items.map((item: { id: string }) => item.id), [batch]);
});

test('a failed critical item, a repeated command and a foreign scope cannot make the batch usable', async () => {
  const requestId = id();
  const failed = await call(master, `/api/v1/projects/${project}/material-batches/${rejectedBatch}/control`, { requestId, expectedVersion: 0, action: 'prepare', zoneId: zone, workTypeId: work, templateId: template, answers: [{ itemId: 'seal', value: 'no' }] });
  assert.equal(failed.body.control.verdict, 'rejected');
  const replay = await call(master, `/api/v1/projects/${project}/material-batches/${rejectedBatch}/control`, { requestId, expectedVersion: 0, action: 'prepare', zoneId: zone, workTypeId: work, templateId: template, answers: [{ itemId: 'seal', value: 'no' }] });
  assert.equal(replay.status, 201);
  assert.equal(replay.body.control.steps.length, 1);
  const again = await step(pto, rejectedBatch, { expectedVersion: 1, action: 'review', decision: 'agree' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'control_refused');
  assert.equal((await call(pto, `/api/v1/projects/${project}/material-batches/${rejectedBatch}`)).body.control.verdict, 'rejected');
  assert.equal((await step(master, rejectedBatch, { expectedVersion: 0, action: 'prepare', zoneId: zone, workTypeId: work, templateId: template, answers: [{ itemId: 'seal', value: 'yes' }] })).status, 409);
  assert.equal((await step(supply, rejectedBatch, { expectedVersion: 1, action: 'review', decision: 'agree', verdict: 'accepted' })).status, 400);
  assert.equal((await step(otherSupply, rejectedBatch, { expectedVersion: 1, action: 'data', dataMark: 'provided' })).status, 403);
  assert.equal((await step(worker, batch, { expectedVersion: 4, action: 'review', decision: 'agree' })).status, 403);
  const task = { requestId: id(), zoneId: zone, workTypeId: work, title: 'Кладка', workDate: '2026-11-16', plannedQuantity: '1', assigneeEmployeeId: employee, responsibleUserId: director, plannedStart: '2026-11-16T06:00:00.000Z', plannedEnd: '2026-11-16T14:00:00.000Z', rdReference: null };
  assert.equal((await call(director, `/api/v1/projects/${project}/tasks`, { ...task, materialBatchId: rejectedBatch })).status, 409);
  assert.equal((await call(director, `/api/v1/projects/${project}/tasks`, { ...task, requestId: id(), materialBatchId: batch })).status, 201);
  const usable = await call(director, `/api/v1/projects/${project}/material-batches?usable=1&zoneId=${zone}&workTypeId=${work}`);
  assert.equal(usable.body.items.some((item: { id: string }) => item.id === rejectedBatch), false);
});


test('изменённая партия ждёт новый контроль; подготовка закрепляет новую редакцию',async()=>{
  const requestId=id();
  const changed=await call(master,`/api/v1/projects/${project}/material-batches/${batch}`,{requestId,expectedVersion:1,materialName:'Кирпич другой марки',unit:'шт',batchCode:batch.slice(0,8),supplierName:'Завод',deliveryDocument:'УПД',deliveredOn:'2026-11-16',deliveredQuantity:'2.000',documents:[]});
  assert.equal(changed.status,201,JSON.stringify(changed.body));assert.equal(changed.body.control.verdict,'awaiting');
  assert.equal(changed.body.control.steps.at(-1).verdict,'accepted','прошлое согласование сохранено');
  const usable=await call(director,`/api/v1/projects/${project}/material-batches?usable=1&zoneId=${zone}&workTypeId=${work}`);
  assert.equal(usable.body.items.some((b:{id:string})=>b.id===batch),false);
  const stale=await step(pto,batch,{expectedVersion:4,action:'review',decision:'agree'});assert.equal(stale.status,409);assert.equal(stale.body.error,'control_outdated');
  const task=(await admin.query('SELECT id FROM daily_tasks WHERE tenant_id=$1 AND material_batch_id=$2',[tenant,batch])).rows[0].id;
  const ready=await call(director,`/api/v1/projects/${project}/tasks/${task}/readiness`);assert.equal(ready.status,200);assert.ok(ready.body.reasons.includes('material_not_accepted'));
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,2,'Новая упаковка',$4,'approved',1,$5)`,[tenant,project,template,JSON.stringify([{...items[0],prompt:'Упаковка новой партии'}]),director]);
  const prepared=await step(master,batch,{expectedVersion:4,action:'prepare',zoneId:zone,workTypeId:work,templateId:template,answers:[{itemId:'seal',value:'yes'}]});
  assert.equal(prepared.status,201,JSON.stringify(prepared.body));assert.equal(prepared.body.control.edition,2);assert.equal(prepared.body.control.items[0].prompt,'Упаковка новой партии');
  assert.equal(prepared.body.control.verdict,'awaiting');
  assert.equal((await step(pto,batch,{expectedVersion:5,action:'review',decision:'agree'})).status,409);
  assert.equal((await step(supply,batch,{expectedVersion:5,action:'data',dataMark:'provided'})).status,201);
  assert.equal((await step(director,batch,{expectedVersion:6,action:'responsible'})).status,201);
  assert.equal((await step(pto,batch,{expectedVersion:7,action:'review',decision:'agree'})).body.control.verdict,'accepted');
  const snapshots=(await admin.query(`SELECT snapshot FROM material_control_steps WHERE tenant_id=$1 AND action='prepare' AND control_id=$2 ORDER BY version`,[tenant,prepared.body.control.id])).rows;
  assert.equal(snapshots[0].snapshot.items[0].prompt,'Упаковка цела');assert.equal(snapshots[1].snapshot.items[0].prompt,'Упаковка новой партии');
});

test('повтор шага снабжения заново проверяет работодателя',async()=>{
  const requestId=id();
  const body={requestId,expectedVersion:8,action:'prepare',zoneId:zone,workTypeId:work,templateId:template,answers:[{itemId:'seal',value:'yes'}]};
  const path=`/api/v1/projects/${project}/material-batches/${batch}/control`;
  assert.equal((await call(supply,path,body)).status,201);
  await admin.query('UPDATE employees SET organization_id=$1 WHERE tenant_id=$2 AND user_id=$3',[foreignOrg,tenant,supply]);
  try {assert.equal((await call(supply,path,body)).status,403);}
  finally {await admin.query('UPDATE employees SET organization_id=$1 WHERE tenant_id=$2 AND user_id=$3',[org,tenant,supply]);}
});

test('PDF не подменяет фотографию, а необязательный пустой пункт разрешён',async()=>{
  const key=id(),target=id(),document=id();
  await admin.query(`INSERT INTO checklist_templates(tenant_id,project_id,id,created_by) VALUES($1,$2,$3,$4)`,[tenant,project,key,master]);
  const photo={id:'photo',prompt:'Фотография',kind:'photo',required:true,critical:true};
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,1,'Фото',$4,'approved',1,$5)`,[tenant,project,key,JSON.stringify([photo]),master]);
  await admin.query(`INSERT INTO material_batches(tenant_id,project_id,id,organization_id) VALUES($1,$2,$3,$4)`,[tenant,project,target,org]);
  await admin.query(`INSERT INTO material_batch_revisions(tenant_id,project_id,batch_id,version,material_name,unit,batch_code,supplier_name,delivery_document,delivered_on,delivered_quantity,created_by) VALUES($1,$2,$3,1,'Фото','шт',$4,'QA','QA','2026-11-16','1.000',$5)`,[tenant,project,target,target.slice(0,8),master]);
  await admin.query(`INSERT INTO material_batch_documents(tenant_id,project_id,batch_id,id,filename,content_type,size_bytes,sha256,state,created_by) VALUES($1,$2,$3,$4,'quality.pdf','application/pdf',16,$5,'ready',$6)`,[tenant,project,target,document,'a'.repeat(64),master]);
  const body={expectedVersion:0,action:'prepare',zoneId:zone,workTypeId:work,templateId:key,answers:[{itemId:'photo',value:document}]};
  const denied=await step(master,target,body);assert.equal(denied.status,422);assert.equal(denied.body.error,'document_not_ready');
  assert.equal((await admin.query('SELECT count(*)::int n FROM material_controls WHERE tenant_id=$1 AND batch_id=$2',[tenant,target])).rows[0].n,0);
  await admin.query(`INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by) VALUES($1,$2,$3,2,'Фото необязательно',$4,'approved',1,$5)`,[tenant,project,key,JSON.stringify([{...photo,required:false,critical:false}]),master]);
  const optional=await step(master,target,{...body,answers:[]});assert.equal(optional.status,201,JSON.stringify(optional.body));assert.equal(optional.body.control.edition,2);assert.equal(optional.body.control.verdict,'awaiting');
});
