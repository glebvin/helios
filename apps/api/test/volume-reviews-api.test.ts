import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, before, after } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/http.js';
import { createPool, adminUrl, withTenant } from '../src/db.js';
import { volumeReviewFixture, assertVolumeReviewDatabase } from './volume-review-fixture.js';

const admin=createPool(adminUrl),restricted=createPool();
let app:INestApplication,base:string,f:Awaited<ReturnType<typeof volumeReviewFixture>>;
let reports:Awaited<ReturnType<typeof f.report>>[]=[];
const path=(id:string)=>`/projects/${f.project}/volume-reviews/${id}`;
const command=(n:number,over:Record<string,unknown>={})=>({requestId:randomUUID(),expectedVersion:0,checklistRunId:reports[n].checklistRunId,acceptedQuantity:'17',reason:'1 м² требует доработки',...over});

before(async()=>{
 await assertVolumeReviewDatabase(admin,true);
 app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${server.address().port}`;
 f=await volumeReviewFixture(admin,base);
 for(const quantity of ['18','18.125','20','10','10'])reports.push(await f.report(quantity));
});
after(async()=>{
 await app?.close();
 // All fixture identities are random and belong to this test's tenant only.
 // Preserve their valid history in the disposable QA database, never reset shared data.
 await Promise.all([admin.end(),restricted.end()]);
});

test('18 предъявлено → 17 принято; источник неизменен, часть и причина читаются ПТО и рабочим',async()=>{
 const input=command(0),first=await f.call(path(reports[0].reportId),input);
 assert.equal(first.status,201,JSON.stringify(first.body));assert.equal(first.body.review.acceptedQuantity,'17.000');assert.equal(first.body.review.differenceQuantity,'1.000');assert.ok(first.body.review.acceptedPartId);assert.equal(first.body.version,1);
 const again=await f.call(path(reports[0].reportId),input);assert.equal(again.status,201);assert.deepEqual(again.body,first.body);
 for(const key of ['pto','worker','director']){
  const read=await f.call(path(reports[0].reportId),undefined,key);assert.equal(read.status,200);assert.deepEqual(read.body.review,first.body.review);assert.equal(read.body.history.length,1);
 }
 const source=(await admin.query('SELECT submitted_quantity::text n FROM managed_execution_reports WHERE tenant_id=$1 AND report_id=$2',[f.tenant,reports[0].reportId])).rows[0];assert.equal(source.n,'18.000');
 assert.equal((await admin.query("SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='volumes.master_review'",[f.tenant])).rows[0].n,1);
 const legacy=await f.call(`/projects/${f.project}/execution/reports?day=${f.day}`);assert.equal(legacy.status,200);assert.ok(legacy.body.items.every((r:any)=>r.acceptedQuantity===null&&r.provisional===true),'прежний контракт сообщения объёма не подменён приёмкой');
 const changed=await f.call(path(reports[0].reportId),{...input,acceptedQuantity:'16'});assert.equal(changed.status,409);assert.equal(changed.body.error,'idempotency_payload_mismatch');
 const closed=await f.call(path(reports[0].reportId),command(0,{expectedVersion:1,acceptedQuantity:'16'}));assert.equal(closed.status,409);assert.equal(closed.body.error,'review_closed');
});

test('два мастера не принимают один физический объём дважды; десятичная разница точная',async()=>{
 const results=await Promise.all([f.call(path(reports[1].reportId),command(1,{acceptedQuantity:'17.005'})),f.call(path(reports[1].reportId),command(1,{acceptedQuantity:'16.005'}),'master2')]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const winner=results.find(r=>r.status===201)!.body.review;
 assert.ok(['1.120','2.120'].includes(winner.differenceQuantity));assert.equal((await admin.query('SELECT count(*)::int n FROM master_volume_reviews WHERE tenant_id=$1 AND report_id=$2',[f.tenant,reports[1].reportId])).rows[0].n,1);
});

test('права, объект и компания проверяются сервером; повтор после отзыва доступа запрещён',async()=>{
 for(const role of ['worker','otherWorker','pto','director','hr'])assert.equal((await f.call(path(reports[2].reportId),command(2),role)).status,403);
 assert.equal((await f.call(`/projects/${f.otherProject}/volume-reviews/${reports[0].reportId}`)).status,404);
 assert.equal((await f.call(`/projects/${randomUUID()}/volume-reviews/${reports[0].reportId}`,command(0))).status,404);
 const input=command(2,{acceptedQuantity:'20',reason:null});const first=await f.call(path(reports[2].reportId),input);assert.equal(first.status,201);
 await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);
 try{assert.equal((await f.call(path(reports[2].reportId),input)).status,403);}
 finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);}
 assert.equal((await f.call(path(reports[0].reportId),undefined,'otherWorker')).status,404);
 const ownOnly=await f.call(`/projects/${f.project}/volume-reviews?day=${f.day}`,undefined,'otherWorker');assert.equal(ownOnly.status,200);assert.deepEqual(ownOnly.body.items,[]);assert.deepEqual(ownOnly.body.totals,[]);
 const foreign=randomUUID();await admin.query("INSERT INTO tenants(id,name)VALUES($1,'Чужая QA')",[foreign]);
 const invisible=await withTenant(restricted,foreign,null,c=>c.query('SELECT * FROM master_volume_reviews'));assert.equal(invisible.rowCount,0);
 await assert.rejects(withTenant(restricted,f.tenant,f.actors.master.id,c=>c.query('UPDATE master_volume_reviews SET accepted_quantity=0 WHERE report_id=$1',[reports[0].reportId])),(e:any)=>e.code==='42501');
});

test('превышение, отсутствие причины и неверные числа ничего не записывают; ноль остаётся решением',async()=>{
 const id=reports[3].reportId;
 for(const value of ['-1','NaN','1e2','1.0001','100000000000'])assert.equal((await f.call(path(id),command(3,{acceptedQuantity:value}))).status,400);
 const over=await f.call(path(id),command(3,{acceptedQuantity:'11'}));assert.equal(over.status,422);assert.equal(over.body.error,'quantity_exceeds_submitted');
 const noReason=await f.call(path(id),command(3,{acceptedQuantity:'9',reason:null}));assert.equal(noReason.status,422);assert.equal(noReason.body.error,'reason_required');
 assert.equal((await admin.query('SELECT count(*)::int n FROM master_volume_reviews WHERE tenant_id=$1 AND report_id=$2',[f.tenant,id])).rows[0].n,0);
 const zero=await f.call(path(id),command(3,{acceptedQuantity:'0',reason:'Объём не подтверждён'}));assert.equal(zero.status,201);assert.equal(zero.body.review.acceptedQuantity,'0.000');assert.equal(zero.body.review.acceptedPartId,null);
 const read=await f.call(path(id),undefined,'pto');assert.equal(read.body.version,1);assert.equal(read.body.history.length,1);
});

test('поздний критичный отказ не позволяет выбрать старый успешный самоконтроль',async()=>{
 const source=reports[4];const failed=await f.ok(`/projects/${f.project}/tasks/${source.taskId}/checklist-runs`,f.command({expectedVersion:1,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'no'}]}),'master');
 assert.equal(failed.blocksNext,true);
 const old=await f.call(path(source.reportId),command(4,{acceptedQuantity:'10'}));assert.equal(old.status,409);assert.equal(old.body.error,'checklist_changed');
 const current=await f.call(path(source.reportId),command(4,{checklistRunId:failed.id,acceptedQuantity:'10'}));assert.equal(current.status,422);assert.equal(current.body.error,'self_control_required');
});

test('итоги включают весь доступный день, а не только первую страницу',async()=>{
 const result=await f.call(`/projects/${f.project}/volume-reviews?day=${f.day}&limit=1`);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.items.length,1);assert.equal(result.body.total,5);assert.equal(result.body.totals.length,1);assert.equal(result.body.totals[0].reviewedReports,4);assert.equal(result.body.totals[0].unreviewedReports,1);
 const exact=(await admin.query('SELECT sum(accepted_quantity)::text n FROM master_volume_reviews WHERE tenant_id=$1',[f.tenant])).rows[0].n;assert.equal(result.body.totals[0].acceptedQuantity,exact);
});


test('смена роли пока запрос ждёт блокировку не оставляет решение со старым правом',async()=>{
 const c=await admin.connect();await c.query('BEGIN');await c.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[f.project]);
 const pending=f.call(path(reports[4].reportId),command(4,{acceptedQuantity:'10'}));
 try {
  let waiting=false;
  for(let n=0;n<100;n++){
   waiting=(await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM projects WHERE id=$1 FOR NO KEY UPDATE%'")).rowCount!>0;
   if(waiting)break;await new Promise(r=>setTimeout(r,20));
  }
  assert.ok(waiting,'запрос должен ждать реальную блокировку объекта');
  await c.query("UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.actors.master.id]);await c.query('COMMIT');
  assert.equal((await pending).status,403);
 } finally {
  await c.query('ROLLBACK');c.release();
  await admin.query("UPDATE memberships SET role='master' WHERE tenant_id=$1 AND user_id=$2",[f.tenant,f.actors.master.id]);
 }
});


test('нет самоконтроля — решения нет; разные единицы не складываются',async()=>{
 const r=await f.report('2',false,'м3');
 const result=await f.call(path(r.reportId),{requestId:randomUUID(),expectedVersion:0,checklistRunId:randomUUID(),acceptedQuantity:'2',reason:null});
 assert.equal(result.status,422);assert.equal(result.body.error,'self_control_required');
 const list=await f.call(`/projects/${f.project}/volume-reviews?day=${f.day}&limit=1`);assert.equal(list.body.total,6);assert.equal(list.body.totals.length,2);
 const unreviewed=list.body.totals.find((row:any)=>row.unit==='м3');assert.equal(unreviewed.submittedQuantity,'2.000');assert.equal(unreviewed.acceptedQuantity,null);assert.equal(unreviewed.unreviewedReports,1);
});
