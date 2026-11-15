import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module.js';
import {AllExceptionsFilter} from '../src/http.js';
import {adminUrl,appUrl,createPool,withTenant} from '../src/db.js';
import {checkHttpContract} from './contract-check.js';
import {dailyRouteFixture,dailyScenario,dailyRequest,dailyAction,newReadyDayTask,saveDailyConfiguration,removeDailyFixture,type DailyFixture,type DailyScenario} from './daily-route-fixture.js';
const admin=createPool(adminUrl),restricted=createPool(appUrl);let fixture:DailyFixture,s:DailyScenario,app:any;
const user=(key:string)=>fixture.users.find(u=>u.key===key)!;
const path=(task:any)=>`/projects/${fixture.projectId}/tasks/${task.id}`;
const body=(task:any,action:string,requestId=randomUUID())=>({requestId,expectedVersion:task.version,...(['reject','reopen','cancel'].includes(action)?{reason:'Учебная причина'}:{})});
async function route(task:any,key='master'){
 const r=await dailyRequest(s,path(task)+'/route',key);checkHttpContract('/api/v1'+path(task)+'/route','GET',r.status,r.body,r.headers);assert.equal(r.status,200);return r.body;
}
async function counts(task:any){return (await admin.query(`SELECT (SELECT count(*)::int FROM daily_task_route_attempts WHERE tenant_id=$1 AND task_id=$2) attempts,(SELECT count(*)::int FROM daily_task_route_events WHERE tenant_id=$1 AND task_id=$2) events,(SELECT count(*)::int FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2) publications`,[fixture.tenantId,task.id])).rows[0];}
test.before(async()=>{
 fixture=await dailyRouteFixture(admin);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());await app.listen(0,'127.0.0.1');s=await dailyScenario(await app.getUrl(),fixture);
});
test.after(async()=>{await app?.close();try{if(fixture)await removeDailyFixture(admin,fixture);}finally{await admin.end();await restricted.end();}});

test('master sends to the explicitly assigned RP; publication keeps route version separate from execution responsible',async()=>{
 let t=await newReadyDayTask(s);assert.ok((await route(t)).allowedActions.includes('submit'));
 for(const key of ['rp','rp2','master2','worker','pto','admin'])assert.equal((await dailyRequest(s,path(t)+'/submit',key,'POST',body(t,'submit'))).status,403,key);
 t=await dailyAction(s,t,'submit');const info=await route(t,'rp');assert.equal(info.route.holder.userId,user('rp').id);assert.equal(info.route.nextStep,'approve-or-return');assert.equal(info.route.dueAt,null);
 assert.equal(info.route.attempt.configurationVersion,s.configurationVersion);assert.equal(t.responsibleUserId,user('master').id);
 for(const key of ['rp2','master','worker','pto','admin'])assert.equal((await dailyRequest(s,path(t)+'/publish',key,'POST',body(t,'publish'))).status,403,key);
 t=await dailyAction(s,t,'publish','rp');assert.equal(t.status,'published');assert.deepEqual(await counts(t),{attempts:1,events:2,publications:1});
 const snapshot=(await admin.query('SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2',[fixture.tenantId,t.id])).rows[0].snapshot;
 assert.equal(snapshot.routeAttemptId,info.route.attempt.id);assert.equal(snapshot.routeConfigurationVersion,info.route.attempt.configurationVersion);assert.equal((await route(t)).route.nextStep,'execute');
});
test('editing config while pending never retargets the old attempt; return/resubmit captures the new version',async()=>{
 let t=await dailyAction(s,await newReadyDayTask(s),'submit');const old=(await route(t)).route.attempt;
 s.configuration.routes[0]!.approvers[0]!.userId=user('rp2').id;await saveDailyConfiguration(s);
 assert.equal((await route(t)).route.attempt.configurationVersion,old.configurationVersion);
 assert.equal((await dailyRequest(s,path(t)+'/reject','rp2','POST',body(t,'reject'))).status,403);
 t=await dailyAction(s,t,'reject','rp','Фронт уточнить');assert.equal(t.status,'draft');assert.equal((await route(t)).route.history.at(-1).reason,'Фронт уточнить');
 const edited=await dailyRequest(s,path(t),'master','PUT',{requestId:randomUUID(),expectedVersion:t.version,zoneId:t.zoneId,workTypeId:t.workTypeId,title:'Уточнённое задание',workDate:t.workDate,plannedQuantity:t.plannedQuantity,assigneeEmployeeId:t.assigneeEmployeeId,responsibleUserId:t.responsibleUserId,plannedStart:t.plannedStart,plannedEnd:t.plannedEnd,rdReference:t.rdReference});assert.equal(edited.status,200);t=edited.body;
 const front=await dailyRequest(s,path(t)+'/front-checks','master','POST',{requestId:randomUUID(),expectedVersion:t.version,templateVersion:s.front.version,answers:[{itemId:'ready',value:true}]});assert.equal(front.status,201);t=(await dailyRequest(s,path(t),'master')).body;
 t=await dailyAction(s,t,'submit');const next=(await route(t,'rp2')).route.attempt;assert.equal(next.number,2);assert.equal(next.configurationVersion,s.configurationVersion);assert.notEqual(next.id,old.id);
 assert.equal((await dailyRequest(s,path(t)+'/publish','rp','POST',body(t,'publish'))).status,403);
 t=await dailyAction(s,t,'publish','rp2');assert.deepEqual(await counts(t),{attempts:2,events:4,publications:1});
 s.configuration.routes[0]!.approvers[0]!.userId=user('rp').id;await saveDailyConfiguration(s);
});
test('identical command is one attempt/event; two approval windows are200/409, replay still checks live project scope',async()=>{
 let t=await newReadyDayTask(s);const submit=body(t,'submit');const responses=await Promise.all(Array.from({length:3},()=>dailyRequest(s,path(t)+'/submit','master','POST',submit)));
 for(const r of responses){assert.equal(r.status,200);assert.deepEqual(r.body,responses[0]!.body);}t=responses[0]!.body;assert.deepEqual(await counts(t),{attempts:1,events:1,publications:0});
 assert.equal((await dailyRequest(s,path(t)+'/submit','master','POST',{...submit,expectedVersion:t.version})).status,409);
 const commands=[body(t,'publish'),body(t,'publish')];const approvals=await Promise.all(commands.map(b=>dailyRequest(s,path(t)+'/publish','rp','POST',b)));assert.deepEqual(approvals.map(r=>r.status).sort(),[200,409]);
 const winner=commands[approvals.findIndex(r=>r.status===200)]!;assert.deepEqual(await counts(t),{attempts:1,events:2,publications:1});
 await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[fixture.tenantId,fixture.projectId,user('rp').id]);
 assert.equal((await dailyRequest(s,path(t)+'/publish','rp','POST',winner)).status,403);
 await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[fixture.tenantId,fixture.projectId,user('rp').id]);
 assert.deepEqual((await dailyRequest(s,path(t)+'/publish','rp','POST',winner)).body,approvals.find(r=>r.status===200)!.body);
});
test('front/admission/unsupported material and ID still refuse publication and roll tentative route events back',async()=>{
 let t=await newReadyDayTask(s);
 const failed=await dailyRequest(s,path(t)+'/front-checks','master','POST',{requestId:randomUUID(),expectedVersion:t.version,templateVersion:s.front.version,answers:[{itemId:'ready',value:false}]});assert.equal(failed.status,201);
 t=(await dailyRequest(s,path(t))).body;t=await dailyAction(s,t,'submit');assert.equal((await dailyRequest(s,path(t)+'/publish','rp','POST',body(t,'publish'))).status,422);assert.deepEqual(await counts(t),{attempts:1,events:1,publications:0});
 for(const flag of ['requiresMaterialControl','requiresPredecessorAcceptance','requiresId']){
  const next={...s.workType,[flag]:true};const r=await dailyRequest(s,`/projects/${fixture.projectId}/work-types/${s.workType.id}`,'rp','PUT',{requestId:randomUUID(),expectedVersion:s.workType.version,name:next.name,unit:next.unit,status:'active',requiresRd:next.requiresRd,requiresMaterialControl:next.requiresMaterialControl,requiresPredecessorAcceptance:next.requiresPredecessorAcceptance,requiresId:next.requiresId});assert.equal(r.status,200);s.workType=r.body;
  let blocked=await dailyAction(s,await newReadyDayTask(s),'submit');assert.equal((await dailyRequest(s,path(blocked)+'/publish','rp','POST',body(blocked,'publish'))).status,422);assert.deepEqual(await counts(blocked),{attempts:1,events:1,publications:0});
  const reset=await dailyRequest(s,`/projects/${fixture.projectId}/work-types/${s.workType.id}`,'rp','PUT',{requestId:randomUUID(),expectedVersion:s.workType.version,name:next.name,unit:next.unit,status:'active',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false});assert.equal(reset.status,200);s.workType=reset.body;
 }
 t=await dailyAction(s,await newReadyDayTask(s),'submit');await admin.query("UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3",[fixture.tenantId,fixture.projectId,s.employee.id]);
 assert.equal((await dailyRequest(s,path(t)+'/publish','rp','POST',body(t,'publish'))).status,422);assert.deepEqual(await counts(t),{attempts:1,events:1,publications:0});
 await admin.query("UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3",[fixture.tenantId,fixture.projectId,s.employee.id]);
});
test('missing/inactive core participants and changed front template never leave a false route decision',async()=>{
 s.configuration.routes[0]!.approvers[0]!.userId=null;await saveDailyConfiguration(s);let t=await newReadyDayTask(s);
 assert.equal((await dailyRequest(s,path(t)+'/submit','master','POST',body(t,'submit'))).status,422);assert.deepEqual(await counts(t),{attempts:0,events:0,publications:0});
 s.configuration.routes[0]!.approvers[0]!.userId=user('rp').id;await saveDailyConfiguration(s);
 await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[fixture.tenantId,fixture.projectId,user('rp').id]);
 assert.equal((await dailyRequest(s,path(t)+'/submit','master','POST',body(t,'submit'))).status,422);assert.deepEqual(await counts(t),{attempts:0,events:0,publications:0});
 await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[fixture.tenantId,fixture.projectId,user('rp').id]);
 t=await dailyAction(s,t,'submit');const changed=await dailyRequest(s,`/projects/${fixture.projectId}/front-template`,'rp','PUT',{requestId:randomUUID(),expectedVersion:s.front.version,title:'Фронт новая версия',items:s.front.items});assert.equal(changed.status,200);s.front=changed.body;
 const request=body(t,'publish');assert.equal((await dailyRequest(s,path(t)+'/publish','rp','POST',request)).status,409);assert.deepEqual(await counts(t),{attempts:1,events:1,publications:0});
 assert.equal((await admin.query('SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2',[fixture.tenantId,request.requestId])).rows[0].n,0);
});
test('pre-config pending task requires a fresh master submission, while already published history remains published',async()=>{
 const old=s.legacyPending;assert.equal((await dailyRequest(s,path(old)+'/publish','rp','POST',body(old,'publish'))).status,409);
 const draft=await dailyAction(s,old,'reopen');const pending=await dailyAction(s,draft,'submit');assert.equal((await route(pending)).route.attempt.number,1);
 assert.equal((await dailyRequest(s,path(s.legacyPublished))).body.status,'published');assert.equal((await route(s.legacyPublished,'rp')).route.attempt,null);
});
test('legacy SQL without a route event fails closed, histories are immutable and tenant isolated',async()=>{
 let t=await newReadyDayTask(s);
 await assert.rejects(withTenant(restricted,fixture.tenantId,user('master').id,c=>c.query("UPDATE daily_tasks SET status='pending_approval',version=version+1 WHERE id=$1",[t.id])),(e:any)=>e.code==='23514'&&e.message.includes('daily route transition requires'));
 t=await dailyAction(s,t,'submit');
 await assert.rejects(withTenant(restricted,fixture.tenantId,user('rp').id,c=>c.query("UPDATE daily_tasks SET status='published',version=version+1 WHERE id=$1",[t.id])),(e:any)=>e.code==='23514'&&e.message.includes('daily route transition requires'));
 assert.deepEqual(await counts(t),{attempts:1,events:1,publications:0});
 for(const table of ['daily_task_route_attempts','daily_task_route_events']){
  assert.equal((await withTenant(restricted,fixture.foreignId,user('rp').id,c=>c.query(`SELECT * FROM ${table} WHERE task_id=$1`,[t.id]))).rowCount,0);
  await assert.rejects(withTenant(restricted,fixture.tenantId,user('rp').id,c=>c.query(`DELETE FROM ${table} WHERE task_id=$1`,[t.id])),{code:'42501'});
 }
 assert.equal((await dailyRequest(s,path(t)+'/route','worker')).status,403);
 assert.equal((await dailyRequest(s,path(t)+'/route','rp','GET',undefined,fixture.foreignId)).status,403);
 assert.equal((await dailyRequest(s,`/projects/${fixture.otherProjectId}/tasks/${t.id}/route`,'master')).status,404);
});
test('saving config while task locks a linked admin follows project-before-memberships and cannot deadlock',async()=>{
 await admin.query('UPDATE employees SET user_id=$1 WHERE tenant_id=$2 AND id=$3',[user('admin').id,fixture.tenantId,s.employee.id]);
 const t=await newReadyDayTask(s),gate=await admin.connect();let submit:Promise<any>|undefined,configuration:Promise<any>|undefined;
 try{
  await gate.query('BEGIN');await gate.query('SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE',[fixture.tenantId,s.employee.id]);
  submit=dailyRequest(s,path(t)+'/submit','master','POST',body(t,'submit'));
  async function waiting(fragment:string){for(let i=0;i<300;i++){if((await admin.query("SELECT 1 FROM pg_stat_activity WHERE usename='helios_app' AND wait_event_type='Lock' AND query LIKE $1",[fragment+'%'])).rowCount)return;await delay(10);}throw Error('Expected SQL gate was not reached: '+fragment);}
  await waiting('SELECT id FROM employees');configuration=saveDailyConfiguration(s);await waiting('SELECT id FROM projects');await gate.query('COMMIT');
  assert.equal((await submit).status,200);await configuration;
 }finally{await gate.query('ROLLBACK');gate.release();await Promise.allSettled([submit,configuration]);await admin.query('UPDATE employees SET user_id=$1 WHERE tenant_id=$2 AND id=$3',[user('worker').id,fixture.tenantId,s.employee.id]);}
});
