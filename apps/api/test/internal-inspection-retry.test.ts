import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';import{test,before,after}from'node:test';import{NestFactory}from'@nestjs/core';import type{INestApplication}from'@nestjs/common';import{AppModule}from'../src/app.module.js';import{AllExceptionsFilter}from'../src/http.js';import{createPool,adminUrl,withTenant}from'../src/db.js';import{assertVolumeReviewDatabase}from'./volume-review-fixture.js';import{internalInspectionFixture}from'./internal-inspection-fixture.js';
const admin=createPool(adminUrl),runtime=createPool();let app:INestApplication,f:Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect=async(p:Promise<any>,status=201)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
async function returnPart(n:number){await expect(f.action(n,'submit',0));await expect(f.action(n,'responsible',1));return expect(f.action(n,'return',2,{reason:'Исправить примыкание'}));}
async function check(n:number,version=1,value='yes'){return f.ok(`/projects/${f.project}/tasks/${f.parts[n].taskId}/checklist-runs`,f.command({expectedVersion:version,templateId:f.template,edition:1,answers:[{itemId:'ready',value}]}),'master');}
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${server.address().port}`);await f.configure();});after(async()=>{await app?.close();await Promise.all([admin.end(),runtime.end()]);});
test('возврат → новый самоконтроль → повтор → РП → ПТО; история и17 м² не удваиваются',async()=>{
 const first=await returnPart(0);assert.equal(first.attemptNumber,1);
 assert.equal((await expect(f.action(0,'resubmit',3,{reason:'Исправлено'}),422)).error,'fresh_self_control_required');
 await expect(f.action(0,'resubmit',3,{reason:'  '}),400);await check(0);
 const body=f.command({expectedVersion:3,action:'resubmit',reason:'Примыкание исправлено'});const sent=await expect(f.call(f.path(0),body));assert.equal(sent.version,4);assert.equal(sent.attemptNumber,2);assert.equal(sent.attempts[0].snapshot.selfControl.version,2);assert.equal(sent.record.snapshot.selfControl.version,1);assert.equal(sent.history[2].reason,'Исправить примыкание');assert.equal(sent.history[3].reason,'Примыкание исправлено');
 assert.deepEqual(await expect(f.call(f.path(0),body)),sent);await expect(f.call(f.path(0),{...body,reason:'Другое'}),409);
 await expect(f.action(0,'approve',4),403);await expect(f.action(0,'responsible',4));const accepted=await expect(f.action(0,'approve',5));assert.equal(accepted.state,'accepted');assert.equal(accepted.history.length,6);assert.equal(accepted.acceptedPart.quantity,'17.000');assert.equal(accepted.attempts.length,1);
 for(const role of ['director','pto','worker']){const r=await expect(f.call(f.path(0),undefined,role),200);assert.equal(r.attemptNumber,2);assert.equal(r.state,'accepted');assert.equal(r.acceptedPart.quantity,'17.000');}
 assert.deepEqual(await expect(f.call(f.path(0),body)),sent);await expect(f.action(0,'resubmit',6,{reason:'Ещё раз'}),409);
 const values=(await admin.query('SELECT s.submitted_quantity::text submitted,v.accepted_quantity::text accepted FROM managed_execution_reports s JOIN master_volume_reviews v USING(tenant_id,report_id)WHERE s.tenant_id=$1 AND s.report_id=$2',[f.tenant,f.parts[0].reportId])).rows[0];assert.deepEqual(values,{submitted:'18.000',accepted:'17.000'});
});
test('два окна повторной подачи дают201/409, один новый снимок и один переход',async()=>{
 await returnPart(1);await check(1);const results=await Promise.all([f.action(1,'resubmit',3,{reason:'Исправлено'}),f.action(1,'resubmit',3,{reason:'Исправлено'})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const current=await expect(f.call(f.path(1)),200);assert.equal(current.attempts.length,1);assert.equal(current.history.length,4);
});
test('каждый возврат требует нового самоконтроля; неудачная новая проверка и принятая часть не обходятся',async()=>{
 await returnPart(2);await check(2,1,'no');await expect(f.action(2,'resubmit',3,{reason:'Исправлено'}),422);await check(2,2);await expect(f.action(2,'resubmit',3,{reason:'Исправлено'}));await expect(f.action(2,'responsible',4));await expect(f.action(2,'return',5,{reason:'Остался дефект'}));
 await expect(f.action(2,'resubmit',6,{reason:'Повтор'}),422);await check(2,3);const third=await expect(f.action(2,'resubmit',6,{reason:'Остаток исправлен'}));assert.equal(third.attemptNumber,3);assert.equal(third.attempts.length,2);assert.equal(third.attempts[1].previousReturnVersion,6);
 await expect(f.action(3,'resubmit',0,{reason:'Не было возврата'}),409);
});
test('исходные участники сохраняются после смены конфигурации, другая роль и другой мастер не подают',async()=>{
 await returnPart(3);await check(3);await f.configure('pto2','director2');
 for(const key of ['master2','director','pto','worker'])await expect(f.action(3,'resubmit',3,{reason:'Исправлено'},key),403);
 await expect(f.action(3,'resubmit',3,{reason:'Исправлено',acceptedQuantity:'18'}),400);await expect(f.action(3,'resubmit',3,{reason:'Исправлено',expectedRouteVersion:2}),400);
 await expect(f.action(3,'resubmit',3,{reason:'Исправлено'}));await expect(f.action(3,'responsible',4,{},'director2'),403);await expect(f.action(3,'responsible',4));await expect(f.action(3,'approve',5,{},'pto2'),403);assert.equal((await expect(f.action(3,'approve',5))).state,'accepted');await f.configure();
});
test('отозванный участник блокирует повтор; исходный запрос после отзыва доступа тоже запрещён',async()=>{
 await returnPart(4);await check(4);await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.pto.id]);
 try{assert.equal((await expect(f.action(4,'resubmit',3,{reason:'Исправлено'}),422)).error,'pinned_participant_unavailable');}finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.pto.id]);}
 const b=f.command({action:'resubmit',expectedVersion:3,reason:'Исправлено'});await expect(f.call(f.path(4),b));await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);
 try{await expect(f.call(f.path(4),b),403);}finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);}
});
test('поздний критичный отказ после повтора блокирует принятие; снимок и старый повтор сохраняются',async()=>{
 await returnPart(5);await check(5);const b=f.command({action:'resubmit',expectedVersion:3,reason:'Исправлено'});const sent=await expect(f.call(f.path(5),b));await expect(f.action(5,'responsible',4));await check(5,2,'no');await expect(f.action(5,'approve',5),422);assert.deepEqual(await expect(f.call(f.path(5),b)),sent);await expect(f.action(5,'return',5,{reason:'Критичный отказ'}));
});
test('история попыток изолирована и неизменяема; SQL не пропускает пропуск версии или неподходящего участника',async()=>{
 const foreign=randomUUID();await admin.query("INSERT INTO tenants(id,name)VALUES($1,'Другой QA')",[foreign]);assert.equal((await withTenant(runtime,foreign,null,c=>c.query('SELECT * FROM internal_inspection_attempts'))).rowCount,0);
 await assert.rejects(withTenant(runtime,f.tenant,f.actors.master.id,c=>c.query('UPDATE internal_inspection_attempts SET snapshot=snapshot')),(e:any)=>e.code==='42501');
 const client=await admin.connect();await client.query('BEGIN');try{await assert.rejects(client.query(`INSERT INTO internal_inspection_events(tenant_id,accepted_part_id,version,action,from_state,to_state,actor_user_id,actor_name,actor_role,request_id)VALUES($1,$2,8,'responsible','awaiting_responsibility','awaiting_pto',$3,'QA','director',$4)`,[f.tenant,f.parts[1].partId,f.actors.director.id,randomUUID()]),(e:any)=>e.code==='23514');}finally{await client.query('ROLLBACK');client.release();}
});
test('квитанция до028 возвращается точно, без переписывания старого результата новыми полями',async()=>{
 const b=f.command({action:'submit',expectedVersion:0,expectedRouteVersion:3});const saved=await expect(f.call(f.path(6),b));const legacy=JSON.parse(JSON.stringify(saved));delete legacy.attempts;delete legacy.attemptNumber;delete legacy.resubmission;delete legacy.selfControl.createdAt;delete legacy.record.snapshot.selfControl.createdAt;
 await admin.query('UPDATE people_command_receipts SET result=$4 WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3',[f.tenant,f.actors.master.id,b.requestId,JSON.stringify(legacy)]);assert.deepEqual(await expect(f.call(f.path(6),b)),legacy);const fresh=await expect(f.call(f.path(6)),200);assert.equal(fresh.attemptNumber,1);assert.deepEqual(fresh.attempts,[]);
});
