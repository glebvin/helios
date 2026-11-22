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
const partPath=(id:string)=>`/projects/${f.project}/accepted-parts/${id}/internal-inspection`;
async function toPto(n:number){await expect(f.action(n,'submit',0));await expect(f.action(n,'responsible',1));}
function partialBody(quantity='16',extra:Record<string,unknown>={}){return f.command({action:'partial',expectedVersion:2,acceptedQuantity:quantity,reason:'1 м² с дефектом',...extra});}
async function currentSum(reportId:string,originalId:string){return (await admin.query(`SELECT coalesce(sum(quantity),0)::text AS total,count(*)::int AS parts,coalesce(bool_or(id=$2),false) AS original FROM current_accepted_volume_parts WHERE report_id=$1`,[reportId,originalId])).rows[0];}
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${server.address().port}`);await f.configure();});
after(async()=>{await app?.close();await Promise.all([admin.end(),runtime.end()]);});
test('17→16+1: принятая доля идёт отдельно, возвращённая связана с исходной частью, объём не удваивается',async()=>{
 await toPto(0);
 for(const key of ['master','worker','director','pto2'])await expect(f.action(0,'partial',2,{acceptedQuantity:'16',reason:'1 м² с дефектом'},key),403);
 await expect(f.call(f.path(0).replace(f.project,f.otherProject),partialBody(),'pto'),403);
 await expect(f.call(f.path(0).replace(f.project,f.otherProject),undefined,'pto'),404);
 await expect(f.call(partPath(randomUUID()),partialBody(),'pto'),404);
 const body=partialBody();
 const saved=await expect(f.call(f.path(0),body,'pto'));
 assert.equal(saved.state,'split');assert.equal(saved.split.role,'source');assert.equal(saved.split.originalPartId,f.parts[0].partId);
 assert.equal(saved.split.acceptedQuantity,'16.000');assert.equal(saved.split.returnedQuantity,'1.000');assert.equal(saved.split.reason,'1 м² с дефектом');
 assert.equal(saved.history.at(-1).action,'partial');assert.equal(saved.allowedActions.length,0);
 assert.equal(saved.record.snapshot.preparer.userId,f.actors.master.id);assert.equal(saved.record.snapshot.responsible.userId,f.actors.director.id);assert.equal(saved.record.snapshot.approver.userId,f.actors.pto.id);
 assert.deepEqual(await expect(f.call(f.path(0),body,'pto')),saved);
 await expect(f.call(f.path(0),{...body,acceptedQuantity:'15'},'pto'),409);
 await expect(f.action(0,'partial',3,{acceptedQuantity:'16',reason:'1 м² с дефектом'}),409);
 const again=await expect(f.call(f.path(0),undefined,'pto'),200);assert.equal(again.state,'split');assert.equal(again.split.acceptedPartId,saved.split.acceptedPartId);
 const accepted=await expect(f.call(partPath(saved.split.acceptedPartId),undefined,'pto'),200);
 const returned=await expect(f.call(partPath(saved.split.returnedPartId),undefined,'master'),200);
 assert.equal(accepted.state,'accepted');assert.equal(accepted.acceptedPart.quantity,'16.000');assert.equal(accepted.split.role,'accepted');assert.equal(accepted.allowedActions.length,0);
 assert.equal(returned.state,'returned');assert.equal(returned.acceptedPart.quantity,'1.000');assert.equal(returned.split.role,'returned');assert.equal(returned.resubmission.needsFreshSelfControl,true);
 for(const key of ['preparer','responsible','approver'] as const)assert.equal(returned.record.snapshot[key].userId,saved.record.snapshot[key].userId);
 await expect(f.call(partPath(saved.split.acceptedPartId),f.command({action:'approve',expectedVersion:3}),'pto'),409);
 const totals=await currentSum(f.parts[0].reportId,f.parts[0].partId);assert.equal(totals.total,'17.000');assert.equal(totals.parts,2);assert.equal(totals.original,false);
 const source=(await admin.query('SELECT s.submitted_quantity::text submitted,v.accepted_quantity::text accepted FROM managed_execution_reports s JOIN master_volume_reviews v USING(tenant_id,report_id) WHERE s.report_id=$1',[f.parts[0].reportId])).rows[0];
 assert.deepEqual(source,{submitted:'18.000',accepted:'17.000'});
 const spec=await expect(f.call('/openapi.json'),200);
 function matches(v:any,s:any):void {
  if(s.$ref)return matches(v,spec.components.schemas[s.$ref.split('/').at(-1)]);
  if(s.oneOf){const valid=s.oneOf.filter((child:any)=>{try{matches(v,child);return true;}catch{return false;}});assert.equal(valid.length,1);return;}
  if(s.type==='null'){assert.equal(v,null);return;}
  if(s.type==='object'){assert.ok(v&&typeof v==='object'&&!Array.isArray(v));for(const k of s.required??[])assert.ok(k in v,k);for(const [k,value] of Object.entries(v)){if(s.additionalProperties===false)assert.ok(k in (s.properties??{}),k);if(s.properties?.[k])matches(value,s.properties[k]);}}
  else if(s.type==='array'){assert.ok(Array.isArray(v));v.forEach((value:any)=>matches(value,s.items));}
  else if(s.type==='integer')assert.ok(Number.isSafeInteger(v));else if(s.type)assert.equal(typeof v,s.type);
  if(s.enum)assert.ok(s.enum.includes(v));if(s.const)assert.equal(v,s.const);if(s.pattern)assert.match(String(v),new RegExp(s.pattern));
 }
 matches(again,spec.components.schemas.InternalInspectionCard);matches(accepted,spec.components.schemas.InternalInspectionCard);matches(returned,spec.components.schemas.InternalInspectionCard);
});
test('два окна частичной приёмки дают одну пару долей',async()=>{
 await toPto(1);
 const results=await Promise.all([f.action(1,'partial',2,{acceptedQuantity:'16',reason:'1 м² с дефектом'}),f.action(1,'partial',2,{acceptedQuantity:'15',reason:'2 м² с дефектом'})]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const row=await expect(f.call(f.path(1),undefined,'pto'),200);assert.equal(row.state,'split');
 const totals=await currentSum(f.parts[1].reportId,f.parts[1].partId);assert.equal(totals.total,'17.000');assert.equal(totals.parts,2);
 assert.equal((await admin.query('SELECT count(*)::int AS n FROM internal_inspection_splits WHERE original_part_id=$1',[f.parts[1].partId])).rows[0].n,1);
});
test('целая приёмка сохраняется; доля вне части отклоняется',async()=>{
 await toPto(2);
 await expect(f.action(2,'partial',2,{acceptedQuantity:'0',reason:'пусто'}),422);
 await expect(f.action(2,'partial',2,{acceptedQuantity:'17',reason:'вся часть'}),422);
 await expect(f.action(2,'partial',2,{acceptedQuantity:'18',reason:'больше части'}),422);
 await expect(f.action(2,'partial',2,{acceptedQuantity:'16.0000',reason:'лишний знак'}),400);
 await expect(f.action(2,'partial',2,{acceptedQuantity:'16',reason:'  '}),400);
 await expect(f.action(2,'partial',2,{acceptedQuantity:'16',reason:'дефект',expectedRouteVersion:1}),400);
 const accepted=await expect(f.action(2,'approve',2));assert.equal(accepted.state,'accepted');assert.equal(accepted.split,null);
 const totals=await currentSum(f.parts[2].reportId,f.parts[2].partId);assert.equal(totals.total,'17.000');assert.equal(totals.parts,1);
});
test('возвращённая доля проходит новый самоконтроль и тех же участников, принятая повторно не решается',async()=>{
 await toPto(3);const split=(await expect(f.action(3,'partial',2,{acceptedQuantity:'16',reason:'1 м² с дефектом'}))).split;
 assert.equal((await expect(f.call(partPath(split.returnedPartId),f.command({action:'resubmit',expectedVersion:3,reason:'Дефект исправлен'}),'master'),422)).error,'fresh_self_control_required');
 const card=await expect(f.call(root(3)),200);
 await f.ok(`/projects/${f.project}/tasks/${f.parts[3].taskId}/checklist-runs`,f.command({expectedVersion:card.checklist.version,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]}),'master');
 await f.configure('pto2','director2');
 try{
  for(const key of ['master2','director','pto','worker'])await expect(f.call(partPath(split.returnedPartId),f.command({action:'resubmit',expectedVersion:3,reason:'Дефект исправлен'}),key),403);
  const sent=await expect(f.call(partPath(split.returnedPartId),f.command({action:'resubmit',expectedVersion:3,reason:'Дефект исправлен'}),'master'));
  assert.equal(sent.version,4);assert.equal(sent.state,'awaiting_responsibility');
  await expect(f.call(partPath(split.returnedPartId),f.command({action:'responsible',expectedVersion:4}),'director2'),403);
  await expect(f.call(partPath(split.returnedPartId),f.command({action:'responsible',expectedVersion:4}),'director'));
  await expect(f.call(partPath(split.returnedPartId),f.command({action:'approve',expectedVersion:5}),'pto2'),403);
  const done=await expect(f.call(partPath(split.returnedPartId),f.command({action:'approve',expectedVersion:5}),'pto'));
  assert.equal(done.state,'accepted');assert.equal(done.acceptedPart.quantity,'1.000');assert.equal(done.record.snapshot.approver.userId,f.actors.pto.id);
 }finally{await f.configure();}
 const held=await expect(f.call(partPath(split.acceptedPartId),undefined,'director'),200);assert.equal(held.state,'accepted');assert.equal(held.allowedActions.length,0);
 const totals=await currentSum(f.parts[3].reportId,f.parts[3].partId);assert.equal(totals.total,'17.000');assert.equal(totals.parts,2);
});
test('заменённая корректировкой часть не делится, а принятую долю можно скорректировать без старых 17',async()=>{
 await toPto(4);
 const before=await expect(f.call(root(4)),200);
 await f.ok(`/projects/${f.project}/tasks/${f.parts[4].taskId}/checklist-runs`,f.command({expectedVersion:before.checklist.version,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]}),'master');
 const corrected=await expect(f.call(root(4)+'/corrections',f.command({expectedVersion:1,previousPartId:f.parts[4].partId,quantity:'16',checklistRunId:(await expect(f.call(root(4)),200)).checklist.id,reason:'Повторный обмер'}),'master'));
 assert.equal(corrected.totalAcceptedQuantity,'16.000');
 await expect(f.action(4,'partial',2,{acceptedQuantity:'15',reason:'уже заменена'}),409);
 await toPto(5);const split=(await expect(f.action(5,'partial',2,{acceptedQuantity:'16',reason:'1 м² с дефектом'}))).split;
 const freshCard=await expect(f.call(root(5)),200);
 await f.ok(`/projects/${f.project}/tasks/${f.parts[5].taskId}/checklist-runs`,f.command({expectedVersion:freshCard.checklist.version,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]}),'master');
 const ready=await expect(f.call(root(5)),200);
 await expect(f.call(root(5)+'/corrections',f.command({expectedVersion:ready.correction.version,previousPartId:f.parts[5].partId,quantity:'15',checklistRunId:ready.checklist.id,reason:'Старая часть'}), 'master'),409);
 const revised=await expect(f.call(root(5)+'/corrections',f.command({expectedVersion:ready.correction.version,previousPartId:split.acceptedPartId,quantity:'15',checklistRunId:ready.checklist.id,reason:'Повторный обмер принятой доли'}),'master'));
 assert.equal(revised.totalAcceptedQuantity,'16.000');
 const totals=await currentSum(f.parts[5].reportId,f.parts[5].partId);assert.equal(totals.total,'16.000');assert.equal(totals.original,false);
 const source=(await admin.query('SELECT accepted_quantity::text AS accepted FROM master_volume_reviews WHERE report_id=$1',[f.parts[5].reportId])).rows[0];assert.equal(source.accepted,'17.000');
});
test('повторное деление возвращённой доли показывает своё решение, сохраняя связь с предыдущим',async()=>{
 const first=await expect(f.call(f.path(1),undefined,'master'),200);
 const returnedId=first.split.returnedPartId;
 const card=await expect(f.call(root(1)),200);
 await f.ok(`/projects/${f.project}/tasks/${f.parts[1].taskId}/checklist-runs`,f.command({expectedVersion:card.checklist.version,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]}),'master');
 await expect(f.call(partPath(returnedId),f.command({action:'resubmit',expectedVersion:3,reason:'Повторная проверка'}),'master'));
 await expect(f.call(partPath(returnedId),f.command({action:'responsible',expectedVersion:4}),'director'));
 const second=await expect(f.call(partPath(returnedId),f.command({action:'partial',expectedVersion:5,acceptedQuantity:'0.5',reason:'Остался дефект'}),'pto'));
 assert.equal(second.state,'split');
 assert.equal(second.split.role,'source');
 assert.equal(second.split.originalPartId,returnedId);
 assert.equal(second.split.acceptedQuantity,'0.500');
 assert.notEqual(second.split.acceptedPartId,first.split.acceptedPartId);
 const reread=await expect(f.call(partPath(returnedId),undefined,'master'),200);
 assert.deepEqual(reread.split,second.split);
 const original=await expect(f.call(f.path(1),undefined,'master'),200);
 assert.equal(original.split.returnedPartId,returnedId);
 assert.equal((await currentSum(f.parts[1].reportId,f.parts[1].partId)).total,'17.000');
});
test('ошибка самоконтроля блокирует частичную приёмку, прямой обход суммы запрещён',async()=>{
 await toPto(6);
 await assert.rejects(withTenant(runtime,f.tenant,f.actors.pto.id,async c=>{
  const requestId=randomUUID();
  await c.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash)VALUES($1,$2,$3,'SQL QA','x')`,[f.tenant,f.actors.pto.id,requestId]);
  await c.query(`INSERT INTO internal_inspection_splits(tenant_id,id,report_id,original_part_id,accepted_part_id,returned_part_id,accepted_quantity,returned_quantity,reason,inspection_version,actor_user_id,request_id)VALUES($1,$2,$3,$4,$5,$6,10,6,'обход',3,$7,$8)`,[f.tenant,randomUUID(),f.parts[6].reportId,f.parts[6].partId,randomUUID(),randomUUID(),f.actors.pto.id,requestId]);
 }),(error:any)=>error.code==='23514');
 await f.ok(`/projects/${f.project}/tasks/${f.parts[6].taskId}/checklist-runs`,f.command({expectedVersion:1,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'no'}]}),'master');
 const blocked=await expect(f.call(f.path(6),undefined,'pto'),200);assert.equal(blocked.allowedActions.includes('partial'),false);assert.equal(blocked.allowedActions.includes('return'),true);
 assert.equal((await expect(f.action(6,'partial',2,{acceptedQuantity:'16',reason:'1 м² с дефектом'}),422)).error,'self_control_required');
 await f.ok(`/projects/${f.project}/tasks/${f.parts[6].taskId}/checklist-runs`,f.command({expectedVersion:2,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]}),'master');
 const saved=await expect(f.action(6,'partial',2,{acceptedQuantity:'16',reason:'1 м² с дефектом'}));assert.equal(saved.split.returnedQuantity,'1.000');
 const foreign=randomUUID();await admin.query(`INSERT INTO tenants(id,name)VALUES($1,'Чужая частичная приёмка')`,[foreign]);
 assert.equal((await withTenant(runtime,foreign,null,c=>c.query('SELECT * FROM internal_inspection_splits'))).rowCount,0);
 await assert.rejects(withTenant(runtime,f.tenant,f.actors.pto.id,c=>c.query('UPDATE internal_inspection_splits SET reason=reason')),(error:any)=>error.code==='42501');
 await expect(f.action(7,'partial',0,{acceptedQuantity:'0',reason:'ноль'}),422);
});
