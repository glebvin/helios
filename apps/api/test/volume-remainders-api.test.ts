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
const admin=createPool(adminUrl),runtime=createPool();let app:INestApplication,f:Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect=async(p:Promise<any>,status=201)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
const root=(n:number)=>`/projects/${f.project}/volume-reviews/${f.parts[n].reportId}`;
async function fresh(n:number,expectedVersion=1,value='yes'){return f.ok(`/projects/${f.project}/tasks/${f.parts[n].taskId}/checklist-runs`,f.command({expectedVersion,templateId:f.template,edition:1,answers:[{itemId:'ready',value}]}),'master');}
async function body(n:number,action:string,version:number,quantity:string,extra:Record<string,unknown>={}){const row=await expect(f.call(root(n)),200);return f.command({expectedVersion:version,action,quantity,checklistRunId:row.checklist.id,reason:action==='present'?'Остаток исправлен':null,...extra});}
async function act(n:number,action:string,version:number,quantity:string,extra:Record<string,unknown>={},key='master'){return f.call(root(n)+'/remainder',await body(n,action,version,quantity,extra),key);}
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const s=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${s.address().port}`);await f.configure();});
after(async()=>{await app?.close();await Promise.all([admin.end(),runtime.end()]);});
test('18→17+1: исходное решение и уже принятое ПТО неизменны, новая часть отдельно проходит ПТО',async()=>{
 await expect(f.action(0,'submit',0));await expect(f.action(0,'responsible',1));const inspected=await expect(f.action(0,'approve',2));
 const initial=await expect(f.call(root(0)),200);await fresh(0);const presented=await expect(act(0,'present',1,'1'));assert.equal(presented.totalAcceptedQuantity,'17.000');assert.equal(presented.remainder.version,2);
 const accepted=await expect(act(0,'review',2,'1'));assert.deepEqual(accepted.review,initial.review);assert.equal(accepted.submittedQuantity,'18.000');assert.equal(accepted.totalAcceptedQuantity,'18.000');assert.equal(accepted.remainder.remainingQuantity,'0.000');
 assert.deepEqual((await expect(f.call(f.path(0)),200)).record,inspected.record);assert.equal((await expect(f.call(f.path(0)),200)).state,'accepted');
 const id=accepted.remainder.history[1].acceptedPartId;assert.ok(id&&id!==initial.review.id);const path=`/projects/${f.project}/accepted-parts/${id}/internal-inspection`;
 await expect(f.call(path,f.command({action:'submit',expectedVersion:0,expectedRouteVersion:1})));await expect(f.call(path,f.command({action:'responsible',expectedVersion:1}),'director'));const final=await expect(f.call(path,f.command({action:'approve',expectedVersion:2}),'pto'));assert.equal(final.acceptedPart.quantity,'1.000');
 const list=await expect(f.call(`/projects/${f.project}/volume-reviews?day=${f.day}&limit=1`),200);assert.equal(list.total,8);assert.equal(list.totals[0].submittedQuantity,'144.000');assert.equal(list.totals[0].acceptedQuantity,'120.000');
 for(const key of ['worker','director','pto'])assert.equal((await expect(f.call(root(0),undefined,key),200)).totalAcceptedQuantity,'18.000');
});
test('неверное количество, старый самоконтроль и превышение остатка отклоняются до записи',async()=>{
 assert.equal((await expect(act(1,'present',1,'1'),422)).error,'fresh_self_control_required');await fresh(1);
 for(const quantity of ['18','1.001'])await expect(act(1,'present',1,quantity),422);
 await expect(act(1,'present',1,'0'),422);await expect(act(1,'present',1,'1',{reason:null}),422);await expect(act(1,'present',1,'1',{reason:' '}),400);
 for(const quantity of ['-1','0.0001','1e0','NaN'])await expect(act(1,'present',1,quantity),400);
 assert.equal((await expect(f.call(root(1)),200)).remainder.history.length,0);
});
test('два окна: одно предъявление и одно решение; частичный/нулевой приём не теряет остаток',async()=>{
 await fresh(2);const b1=await body(2,'present',1,'1'),b2=await body(2,'present',1,'1');const p=await Promise.all([f.call(root(2)+'/remainder',b1),f.call(root(2)+'/remainder',b2)]);assert.deepEqual(p.map(x=>x.status).sort(),[201,409]);
 const reviews=await Promise.all([act(2,'review',2,'0',{reason:'Нужно исправить'}),act(2,'review',2,'0',{reason:'Нужно исправить'})]);assert.deepEqual(reviews.map(x=>x.status).sort(),[201,409]);let row=await expect(f.call(root(2)),200);assert.equal(row.remainder.remainingQuantity,'1.000');assert.equal(row.remainder.history[1].acceptedPartId,null);
 await expect(act(2,'present',3,'1'),422);await fresh(2,2);await expect(act(2,'present',3,'0.600'));row=await expect(act(2,'review',4,'0.400',{reason:'Ещё0.2 доработать'}));assert.equal(row.totalAcceptedQuantity,'17.400');assert.equal(row.remainder.remainingQuantity,'0.600');
 await fresh(2,3);await expect(act(2,'present',5,'0.600'));row=await expect(act(2,'review',6,'0.600'));assert.equal(row.totalAcceptedQuantity,'18.000');assert.equal(row.remainder.remainingQuantity,'0.000');
});
test('точная квитанция после позднего ответа, изменение тела и поздний критичный отказ',async()=>{
 await fresh(3);const b=await body(3,'present',1,'1');const first=await expect(f.call(root(3)+'/remainder',b));assert.deepEqual(await expect(f.call(root(3)+'/remainder',b)),first);await expect(f.call(root(3)+'/remainder',{...b,quantity:'0.9'}),409);
 await fresh(3,2,'no');await expect(act(3,'review',2,'1'),422);await fresh(3,3);await expect(act(3,'review',2,'1'));assert.deepEqual(await expect(f.call(root(3)+'/remainder',b)),first);
});
test('права проверяются до повторного ответа; другая роль и чужой объект не пишут',async()=>{
 await fresh(4);for(const key of ['worker','pto','director','hr'])await expect(act(4,'present',1,'1',{},key),403);
 const b=await body(4,'present',1,'1');await expect(f.call(`/projects/${f.otherProject}/volume-reviews/${f.parts[4].reportId}/remainder`,b),403);
 const saved=await expect(f.call(root(4)+'/remainder',b));await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);try{await expect(f.call(root(4)+'/remainder',b),403);}finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);}assert.equal(saved.remainder.version,2);
});
test('журнал/части изолированы, неизменны; SQL не позволяет превысить остаток или подделать происхождение',async()=>{
 const foreign=randomUUID();await admin.query("INSERT INTO tenants(id,name)VALUES($1,'Другой остаток QA')",[foreign]);for(const table of ['volume_remainder_events','accepted_volume_parts']){assert.equal((await withTenant(runtime,foreign,null,c=>c.query(`SELECT * FROM ${table}`))).rowCount,0);await assert.rejects(withTenant(runtime,f.tenant,f.actors.master.id,c=>c.query(`UPDATE ${table} SET id=id`)),(e:any)=>e.code==='42501');}
 const event=(await admin.query("SELECT * FROM volume_remainder_events WHERE tenant_id=$1 AND report_id=$2 AND action='present'",[f.tenant,f.parts[4].reportId])).rows[0];
 async function invalidReview(accepted:unknown,version=3){return withTenant(runtime,f.tenant,f.actors.master.id,async c=>{const id=randomUUID();await c.query("INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash)VALUES($1,$2,$3,'SQL QA','x')",[f.tenant,f.actors.master.id,id]);await c.query("INSERT INTO volume_remainder_events(tenant_id,report_id,version,id,action,presentation_version,presented_quantity,accepted_quantity,reason,checklist_run_id,actor_user_id,actor_name,request_id)VALUES($1,$2,$3,$4,'review',2,1,$5,'SQL QA',$6,$7,'SQL QA',$8)",[f.tenant,event.report_id,version,randomUUID(),accepted,event.checklist_run_id,f.actors.master.id,id]);});}
 for(const [qty,v]of [[null,3],[2,3],[1,5]])await assert.rejects(invalidReview(qty,v as number),(e:any)=>e.code==='23514');
 await assert.rejects(withTenant(runtime,f.tenant,f.actors.master.id,c=>c.query('INSERT INTO accepted_volume_parts(tenant_id,id,report_id,quantity,master_review_id)VALUES($1,$2,$3,18,$2)',[f.tenant,f.parts[7].partId,f.parts[7].reportId])),(e:any)=>e.code==='23503');
});

test('нулевое первое решение позволяет принять связанный остаток18 без создания части из нуля',async()=>{
 await fresh(7);await expect(act(7,'present',1,'18'));const saved=await expect(act(7,'review',2,'18'));assert.equal(saved.review.acceptedQuantity,'0.000');assert.equal(saved.review.acceptedPartId,null);assert.equal(saved.totalAcceptedQuantity,'18.000');assert.equal(saved.remainder.remainingQuantity,'0.000');assert.ok(saved.remainder.history[1].acceptedPartId);await expect(f.call(f.path(7)),422);
});
