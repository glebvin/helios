import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test,before,after} from 'node:test';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {AllExceptionsFilter} from '../src/http.js';
import {createPool,adminUrl,withTenant} from '../src/db.js';
import {reserveCommand} from '../src/durable-command.js';
import {assertVolumeReviewDatabase} from './volume-review-fixture.js';
import {internalInspectionFixture} from './internal-inspection-fixture.js';
const admin=createPool(adminUrl),runtime=createPool();let app:INestApplication,f:Awaited<ReturnType<typeof internalInspectionFixture>>,saved:any,command:any,part:string;
const expect=async(p:Promise<any>,status=201)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
const path=(n:number)=>`/projects/${f.project}/volume-reviews/${f.parts[n].reportId}`;
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const s=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${s.address().port}`);await f.configure();});
after(async()=>{await app?.close();await Promise.all([admin.end(),runtime.end()]);});
test('companion reads the source and additional part once, without exposing new remainder actions',async()=>{
 await expect(f.action(0,'submit',0));await expect(f.action(0,'responsible',1));await expect(f.action(0,'approve',2));
 const check=await f.ok(`/projects/${f.project}/tasks/${f.parts[0].taskId}/checklist-runs`,f.command({expectedVersion:1,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]}),'master');
 // Isolated fixture represents persisted newer-version data, including real durable hashes and SQL guards.
 for(const [action,version]of [['present',2],['review',3]]as const){
  const b=f.command({action,expectedVersion:version-1,quantity:'1',checklistRunId:check.id,reason:action==='present'?'Исправлено':null});const id=randomUUID();
  await withTenant(runtime,f.tenant,f.actors.master.id,async c=>{await reserveCommand(c,{tenantId:f.tenant,userId:f.actors.master.id,role:'master'} as any,`POST ${path(0)}/remainder`,b);await c.query(`INSERT INTO volume_remainder_events(tenant_id,report_id,version,id,action,presentation_version,presented_quantity,accepted_quantity,reason,checklist_run_id,actor_user_id,actor_name,request_id)VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,'Мастер QA',$11)`,[f.tenant,f.parts[0].reportId,version,id,action,action==='review'?2:null,action==='review'?1:null,b.reason,check.id,f.actors.master.id,b.requestId]);});
  const body=await expect(f.call(path(0)),200);await admin.query('UPDATE people_command_receipts SET status=201,result=$4 WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3',[f.tenant,f.actors.master.id,b.requestId,JSON.stringify(body)]);
  if(action==='review'){saved=body;command=b;part=id;}
 }
 assert.equal(saved.submittedQuantity,'18.000');assert.equal(saved.review.acceptedQuantity,'17.000');assert.equal(saved.totalAcceptedQuantity,'18.000');assert.equal(saved.remainder.remainingQuantity,'0.000');assert.deepEqual(saved.remainder.allowedActions,[]);
 const list=await expect(f.call(`/projects/${f.project}/volume-reviews?day=${f.day}&limit=1`),200);assert.equal(list.total,8);assert.equal(list.totals[0].submittedQuantity,'144.000');assert.equal(list.totals[0].acceptedQuantity,'120.000');
});
test('exact previously committed command returns201, changed payload409, new command503 without any writes',async()=>{
 assert.deepEqual(await expect(f.call(path(0)+'/remainder',command)),saved);await expect(f.call(path(0)+'/remainder',{...command,quantity:'0.5'}),409);
 const b=f.command({action:'present',expectedVersion:1,quantity:'1',checklistRunId:f.parts[1].checklistRunId,reason:'Исправлено'});await expect(f.call(path(1)+'/remainder',b),503);assert.equal((await admin.query('SELECT 1 FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3',[f.tenant,f.actors.master.id,b.requestId])).rowCount,0);assert.equal((await admin.query('SELECT 1 FROM volume_remainder_events WHERE tenant_id=$1 AND report_id=$2',[f.tenant,f.parts[1].reportId])).rowCount,0);
});
test('live role/project authorization is still required before receipt replay',async()=>{
 for(const key of ['worker','pto','director'])await expect(f.call(path(0)+'/remainder',command,key),403);
 await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);try{await expect(f.call(path(0)+'/remainder',command),403);}finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);}
});
test('previous PTO flow can finish the newer part while the original17 stays accepted',async()=>{
 const p=`/projects/${f.project}/accepted-parts/${part}/internal-inspection`;await expect(f.call(p,f.command({action:'submit',expectedVersion:0,expectedRouteVersion:1})));await expect(f.call(p,f.command({action:'responsible',expectedVersion:1}),'director'));const done=await expect(f.call(p,f.command({action:'approve',expectedVersion:2}),'pto'));assert.equal(done.acceptedPart.quantity,'1.000');assert.equal(done.state,'accepted');assert.equal((await expect(f.call(f.path(0)),200)).state,'accepted');assert.equal((await expect(f.call(path(0)),200)).totalAcceptedQuantity,'18.000');
});
