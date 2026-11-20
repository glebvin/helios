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
async function fresh(n:number,value='yes'){const row=await expect(f.call(root(n)),200);return f.ok(`/projects/${f.project}/tasks/${f.parts[n].taskId}/checklist-runs`,f.command({expectedVersion:row.checklist.version,templateId:f.template,edition:1,answers:[{itemId:'ready',value}]}),'master');}
async function body(n:number,quantity='16',extra:Record<string,unknown>={}){const row=await expect(f.call(root(n)),200);return f.command({expectedVersion:row.correction.version,previousPartId:row.currentParts[0]?.id??f.parts[n].partId,quantity,checklistRunId:row.checklist.id,reason:'Повторный обмер',...extra});}
async function correct(n:number,quantity='16',extra:Record<string,unknown>={},role='master'){return f.call(root(n)+'/corrections',await body(n,quantity,extra),role);}
async function remainder(n:number,action:string,quantity:string){const row=await expect(f.call(root(n)),200);return f.call(root(n)+'/remainder',f.command({expectedVersion:row.remainder.version,action,quantity,checklistRunId:row.checklist.id,reason:'Доработанная часть'}));}
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const s=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${s.address().port}`);await f.configure();});
after(async()=>{await app?.close();await Promise.all([admin.end(),runtime.end()]);});
test('17→16: прежняя приёмка ПТО неизменна, новая часть проходит отдельный маршрут',async()=>{
 await expect(f.action(0,'submit',0));await expect(f.action(0,'responsible',1));const approve=f.command({action:'approve',expectedVersion:2});const original=await expect(f.call(f.path(0),approve,'pto'));
 const before=await expect(f.call(root(0)),200);assert.equal((await expect(correct(0),422)).error,'fresh_self_control_required');await fresh(0);
 const command=await body(0),saved=await expect(f.call(root(0)+'/corrections',command));assert.deepEqual(saved.review,before.review);assert.deepEqual(await expect(f.call(f.path(0),approve,'pto')),original);assert.equal(saved.totalAcceptedQuantity,'16.000');assert.equal(saved.remainder.remainingQuantity,'2.000');assert.equal(saved.correction.version,2);assert.equal(saved.currentParts.length,1);assert.notEqual(saved.currentParts[0].id,before.review.id);
 const old=await expect(f.call(f.path(0)),200);assert.deepEqual(old.record,original.record);assert.deepEqual(old.history,original.history);assert.equal(old.state,'accepted');assert.deepEqual(old.allowedActions,[]);assert.equal(old.acceptedPart.replacedBy.id,saved.currentParts[0].id);
 assert.equal((await expect(f.action(0,'submit',0),409)).error,'part_superseded');
 const path=`/projects/${f.project}/accepted-parts/${saved.currentParts[0].id}/internal-inspection`;assert.equal((await expect(f.call(path),200)).state,'not_submitted');
 await expect(f.call(path,f.command({action:'submit',expectedVersion:0,expectedRouteVersion:1})));await expect(f.call(path,f.command({action:'responsible',expectedVersion:1}),'director'));assert.equal((await expect(f.call(path,f.command({action:'approve',expectedVersion:2}),'pto'))).acceptedPart.quantity,'16.000');
 assert.deepEqual(await expect(f.call(root(0)+'/corrections',command)),saved);await expect(f.call(root(0)+'/corrections',{...command,quantity:'15'}),409);
 for(const role of ['worker','director','pto'])assert.equal((await expect(f.call(root(0),undefined,role),200)).totalAcceptedQuantity,'16.000');
});
test('цепочка и ноль сохраняют все решения; освобождённый остаток принимается ровно один раз',async()=>{
 await fresh(1);let row=await expect(correct(1,'16'));const second=row.currentParts[0].id;await fresh(1);row=await expect(correct(1,'0'));assert.equal(row.currentParts.length,0);assert.equal(row.totalAcceptedQuantity,'0.000');assert.equal(row.remainder.remainingQuantity,'18.000');assert.equal(row.correction.history[1].previousPartId,second);assert.equal(row.correction.history.length,2);
 await fresh(1);await expect(remainder(1,'present','18'));row=await expect(remainder(1,'review','18'));assert.equal(row.totalAcceptedQuantity,'18.000');assert.equal(row.remainder.remainingQuantity,'0.000');assert.equal(row.currentParts.length,1);assert.equal(row.correction.history.length,2);
 await fresh(1);row=await expect(correct(1,'17'));assert.equal(row.totalAcceptedQuantity,'17.000');assert.equal(row.remainder.remainingQuantity,'1.000');
});
test('два окна корректировки дают201 и409, итог учитывает только одну замену',async()=>{
 await fresh(2);const a=await body(2,'16'),b=await body(2,'15');const results=await Promise.all([f.call(root(2)+'/corrections',a),f.call(root(2)+'/corrections',b)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);const row=await expect(f.call(root(2)),200);assert.equal(row.correction.history.length,1);assert.equal(row.currentParts.length,1);assert.ok(['16.000','15.000'].includes(row.totalAcceptedQuantity));
});
test('запрет роли, чужого объекта/компании и повтор после отзыва доступа',async()=>{
 await fresh(3);for(const role of ['worker','pto','director','hr','admin'])await expect(correct(3,'16',{},role),403);
 const b=await body(3);await expect(f.call(`/projects/${f.otherProject}/volume-reviews/${f.parts[3].reportId}/corrections`,b),403);
 const row=await expect(f.call(root(3)+'/corrections',b));await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);try{await expect(f.call(root(3)+'/corrections',b),403);}finally{await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[f.tenant,f.project,f.actors.master.id]);}assert.equal(row.totalAcceptedQuantity,'16.000');
});
test('предъявленный остаток блокирует корректировку, превышение с другой частью запрещено',async()=>{
 await fresh(4);await expect(remainder(4,'present','1'));assert.equal((await expect(correct(4),409)).error,'remainder_pending');await expect(remainder(4,'review','1'));await fresh(4);assert.equal((await expect(correct(4,'18',{previousPartId:f.parts[4].partId}),422)).error,'quantity_exceeds_submitted');let row=await expect(correct(4,'16',{previousPartId:f.parts[4].partId}));assert.equal(row.totalAcceptedQuantity,'17.000');assert.equal(row.remainder.remainingQuantity,'1.000');await fresh(4);await expect(remainder(4,'present','1'));row=await expect(remainder(4,'review','1'));assert.equal(row.totalAcceptedQuantity,'18.000');
 const list=await expect(f.call(`/projects/${f.project}/volume-reviews?day=${f.day}&limit=1`),200);const cards=await Promise.all(f.parts.map((_,n)=>expect(f.call(root(n)),200)));assert.equal(Number(list.totals[0].acceptedQuantity),cards.reduce((sum,row)=>sum+Number(row.totalAcceptedQuantity),0));assert.equal(list.totals[0].submittedQuantity,'144.000');
});
test('неверный ввод, чужая часть и устаревший самоконтроль не создают ревизию',async()=>{
 await fresh(5);for(const quantity of ['-1','1e1','1.0001','NaN','999999999999'])await expect(correct(5,quantity),400);
 for(const [quantity,error]of [['17','quantity_unchanged'],['18.001','quantity_exceeds_submitted']])assert.equal((await expect(correct(5,quantity),422)).error,error);
 for(const reason of ['', ' ',null])await expect(correct(5,'16',{reason}),400);
 await expect(correct(5,'16',{previousPartId:f.parts[0].partId}),409);
 const old=await body(5);await fresh(5,'no');await expect(f.call(root(5)+'/corrections',old),422);await fresh(5);await expect(f.call(root(5)+'/corrections',old),409);assert.equal((await expect(f.call(root(5)),200)).correction.history.length,0);
});
test('ПТО и корректировка сериализуются: прежнее решение либо историческое, либо отказ; новое не утверждено',async()=>{
 await expect(f.action(6,'submit',0));await expect(f.action(6,'responsible',1));await fresh(6);const b=await body(6);const [correction,pto]=await Promise.all([f.call(root(6)+'/corrections',b),f.action(6,'approve',2)]);
 // If PTO won, its newer event invalidates the old self-control. If correction won, old PTO cannot proceed.
 assert.ok([201,422].includes(correction.status),JSON.stringify(correction));assert.ok([201,409].includes(pto.status),JSON.stringify(pto));assert.equal([correction,pto].filter(r=>r.status===201).length,1);
 if(correction.status!==201){await fresh(6);await expect(correct(6));}
 const row=await expect(f.call(root(6)),200);assert.equal(row.totalAcceptedQuantity,'16.000');assert.equal((await expect(f.call(`/projects/${f.project}/accepted-parts/${row.currentParts[0].id}/internal-inspection`),200)).state,'not_submitted');
});
test('SQL/RLS: журнал неизменен, происхождение и суммарная граница защищены',async()=>{
 const foreign=randomUUID();await admin.query("INSERT INTO tenants(id,name)VALUES($1,'Чужая корректировка QA')",[foreign]);assert.equal((await withTenant(runtime,foreign,null,c=>c.query('SELECT * FROM volume_corrections'))).rowCount,0);assert.equal((await withTenant(runtime,foreign,null,c=>c.query('SELECT * FROM current_accepted_volume_parts'))).rowCount,0);
 for(const action of ['UPDATE volume_corrections SET quantity=1','DELETE FROM volume_corrections'])await assert.rejects(withTenant(runtime,f.tenant,f.actors.master.id,c=>c.query(action)),(e:any)=>e.code==='42501');
 // SQL cannot turn the17 part into19, move it to another report, or skip the aggregate version.
 async function invalid(quantity:string,report=f.parts[5].reportId,version=2){return withTenant(runtime,f.tenant,f.actors.master.id,async c=>{const id=randomUUID();await c.query("INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash)VALUES($1,$2,$3,'SQL QA','x')",[f.tenant,f.actors.master.id,id]);await c.query("INSERT INTO volume_corrections(tenant_id,report_id,id,version,previous_part_id,quantity,reason,checklist_run_id,actor_user_id,actor_name,request_id)VALUES($1,$2,$3,$4,$5,$6,'SQL QA',$7,$8,'SQL QA',$9)",[f.tenant,report,randomUUID(),version,f.parts[5].partId,quantity,f.parts[5].checklistRunId,f.actors.master.id,id]);});}
 for(const [qty,report,version]of [['19',f.parts[5].reportId,2],['16',f.parts[4].reportId,5],['16',f.parts[5].reportId,8]])await assert.rejects(invalid(qty as string,report as string,version as number),(e:any)=>e.code==='23514');
});
