import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {AllExceptionsFilter} from '../src/http.js';
import {createPool,adminUrl,withTenant} from '../src/db.js';
import {assertVolumeReviewDatabase} from './volume-review-fixture.js';
import {internalInspectionFixture} from './internal-inspection-fixture.js';
const admin=createPool(adminUrl),restricted=createPool();let app:INestApplication,f:Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect=async(p:Promise<any>,status=201)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${server.address().port}`);});
after(async()=>{await app?.close();await Promise.all([admin.end(),restricted.end()]);});
test('без настроенных участников подача запрещена, нулевой объём не получает приёмку',async()=>{
 const missing=await expect(f.action(0,'submit',0),422);assert.equal(missing.error,'route_not_configured');await expect(f.call(f.path(7)),422);await f.configure();
});
test('17 м²: мастер → закреплённый РП → закреплённый ПТО; источник и количество неизменны',async()=>{
 await expect(f.action(0,'approve',0),403);await expect(f.action(0,'submit',0,{},'master2'),403);
 const body=f.command({action:'submit',expectedVersion:0,expectedRouteVersion:1});
 const first=await expect(f.call(f.path(0),body));assert.equal(first.state,'awaiting_responsibility');assert.equal(first.record.snapshot.acceptedPart.quantity,'17.000');
 await expect(f.action(0,'approve',1),403);await expect(f.action(0,'responsible',1,{},'director2'),403);
 await expect(f.action(0,'responsible',1));await expect(f.action(0,'approve',2,{},'pto2'),403);
 const accepted=await expect(f.action(0,'approve',2));assert.equal(accepted.state,'accepted');assert.deepEqual(accepted.history.map((e:any)=>e.action),['submit','responsible','approve']);
 assert.deepEqual(await expect(f.call(f.path(0),body)),first,'replay returns original receipt, not a new transition');
 await expect(f.call(f.path(0),{...body,expectedRouteVersion:2}),409);
 for(const role of ['worker','pto','director']){const read=await expect(f.call(f.path(0),undefined,role),200);assert.equal(read.state,'accepted');assert.equal(read.version,3);assert.equal(read.acceptedPart.quantity,'17.000');assert.equal(read.allowedActions.length,0);}
 const source=(await admin.query('SELECT s.submitted_quantity::text submitted,v.accepted_quantity::text accepted FROM managed_execution_reports s JOIN master_volume_reviews v USING(tenant_id,report_id) WHERE s.tenant_id=$1 AND s.report_id=$2',[f.tenant,f.parts[0].reportId])).rows[0];assert.deepEqual(source,{submitted:'18.000',accepted:'17.000'});
 await expect(f.action(0,'approve',3),409);await expect(f.action(0,'submit',3),409);
});
test('возврат требует причину; конкурирующие решения не создают двойной приёмки',async()=>{
 await expect(f.action(1,'submit',0));await expect(f.action(1,'responsible',1));
 await expect(f.action(1,'return',2,{reason:'  '}),400);
 const results=await Promise.all([f.action(1,'return',2,{reason:'Нужно устранить дефект'}),f.action(1,'approve',2)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 assert.equal((await expect(f.call(f.path(1)),200)).history.length,3);
 await expect(f.action(2,'submit',0));await expect(f.action(2,'responsible',1));const r=await expect(f.action(2,'return',2,{reason:'Переделать примыкание'}));assert.equal(r.state,'returned');assert.equal(r.history[2].reason,'Переделать примыкание');await expect(f.action(2,'submit',3),409);
});
test('смена маршрута требует перечитать новую подачу и не заменяет закреплённых участников старой',async()=>{
 await expect(f.action(3,'submit',0));await f.configure('pto2','director2');
 await expect(f.action(4,'submit',0,{expectedRouteVersion:1}),409);
 await expect(f.action(3,'responsible',1,{},'director2'),403);await expect(f.action(3,'responsible',1));await expect(f.action(3,'approve',2,{},'pto2'),403);
 const done=await expect(f.action(3,'approve',2));assert.equal(done.record.snapshot.configurationVersion,1);assert.equal(done.record.snapshot.approver.userId,f.actors.pto.id);
 await f.configure();
});
test('поздний критичный отказ блокирует подачу и приёмку; ПТО может вернуть с причиной',async()=>{
 const fail=async(n:number)=>f.ok(`/projects/${f.project}/tasks/${f.parts[n].taskId}/checklist-runs`,f.command({expectedVersion:1,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'no'}]}),'master');
 await fail(4);assert.equal((await expect(f.action(4,'submit',0),422)).error,'self_control_required');
 await expect(f.action(5,'submit',0));await expect(f.action(5,'responsible',1));await fail(5);assert.equal((await expect(f.action(5,'approve',2),422)).error,'self_control_required');
 const returned=await expect(f.action(5,'return',2,{reason:'Критичный пункт самоконтроля'}));assert.equal(returned.state,'returned');assert.equal(returned.record.snapshot.selfControl.passed,true);assert.equal(returned.selfControl.passed,false);
});
test('чужая роль, объект, компания и неизвестный день не раскрывают часть; история неизменяема',async()=>{
 for(const role of ['worker','pto','director','hr'])await expect(f.action(6,'submit',0,{},role),403);
 await expect(f.call(f.path(0),undefined,'otherWorker'),404);await expect(f.call(f.path(0).replace(f.project,f.otherProject)),404);await expect(f.call(f.path(0).replace(f.parts[0].partId,randomUUID())),404);
 const foreign=randomUUID();await admin.query("INSERT INTO tenants(id,name)VALUES($1,'Другой контур QA')",[foreign]);for(const table of ['internal_inspections','internal_inspection_events']){
  assert.equal((await withTenant(restricted,foreign,null,c=>c.query(`SELECT * FROM ${table}`))).rowCount,0);
  await assert.rejects(withTenant(restricted,f.tenant,f.actors.master.id,c=>c.query(`UPDATE ${table} SET accepted_part_id=accepted_part_id`)),(e:any)=>e.code==='42501');
 }
});
test('роль отозвана за реальной блокировкой проекта — старый токен не сохраняет подачу',async()=>{
 const c=await admin.connect();await c.query('BEGIN');await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[f.project]);const pending=f.action(6,'submit',0);
 try{let waiting=false;for(let n=0;n<100;n++){waiting=(await admin.query("SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%FROM projects WHERE id=$1 FOR NO KEY UPDATE%'")).rowCount!>0;if(waiting)break;await new Promise(r=>setTimeout(r,20));}assert.ok(waiting);await c.query("UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.actors.master.id]);await c.query('COMMIT');await expect(pending,403);}finally{await c.query('ROLLBACK');c.release();await admin.query("UPDATE memberships SET role='master' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.actors.master.id]);}
});
test('закреплённый ПТО после отзыва доступа не может принять или повторить команду',async()=>{
 await expect(f.action(6,'submit',0));await expect(f.action(6,'responsible',1));const body=f.command({action:'approve',expectedVersion:2});await expect(f.call(f.path(6),body,'pto'));
 await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.pto.id]);
 try{await expect(f.call(f.path(6),body,'pto'),403);}finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.pto.id]);}
});
test('публичный контракт совпадает с фактической карточкой, старые операции остаются',async()=>{
 const spec=(await expect(f.call('/openapi.json'),200));
 const actual=await expect(f.call(f.path(0),undefined,'pto'),200);
 function matches(v:any,s:any):void {
  if(s.$ref)return matches(v,spec.components.schemas[s.$ref.split('/').at(-1)]);
  if(s.oneOf){const valid=s.oneOf.filter((child:any)=>{try{matches(v,child);return true;}catch{return false;}});assert.equal(valid.length,1);return;}
  if(s.type==='null'){assert.equal(v,null);return;}
  if(s.type==='object'){assert.ok(v&&typeof v==='object'&&!Array.isArray(v));for(const k of s.required??[])assert.ok(k in v,k);for(const [k,value]of Object.entries(v)){if(s.additionalProperties===false)assert.ok(k in s.properties,k);if(s.properties[k])matches(value,s.properties[k]);}}
  else if(s.type==='array'){assert.ok(Array.isArray(v));v.forEach((value:any)=>matches(value,s.items));}
  else if(s.type==='integer')assert.ok(Number.isSafeInteger(v));else if(s.type)assert.equal(typeof v,s.type);
  if(s.enum)assert.ok(s.enum.includes(v));if(s.pattern)assert.match(v,new RegExp(s.pattern));
 }
 matches(actual,spec.components.schemas.InternalInspectionCard);
 assert.equal(Object.values(spec.paths).reduce((n:number,p:any)=>n+Object.keys(p).length,0),132);
});
