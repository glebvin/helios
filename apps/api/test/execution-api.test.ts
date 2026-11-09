import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {createPool,adminUrl,withTenant} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {AllExceptionsFilter} from '../src/http.js';
import {executionReviewFlags} from '../src/execution.service.js';
const admin=createPool(adminUrl),restricted=createPool();
const tenant=id(),foreign=id(),org=id(),p=id(),p2=id(),director=id(),worker=id(),master=id(),pto=id(),outsider=id();
const users=[director,worker,master,pto,outsider],tokens=new Map<string,string>();
let app:INestApplication|undefined,base:string,employee:any,task:any;
const command=(b:any)=>({requestId:id(),...b});
async function req(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST') {
  const r=await fetch(`${base}/api/v1${path}`,{method,headers:{authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':tenant,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json()};
}
async function ok(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST') {const r=await req(path,body,user,method);assert.equal(r.status,method==='POST'?201:200,JSON.stringify(r));return r.body;}
function event(kind:string,shiftId:string,expectedVersion:number,occurredAt:string,extra:any={}) {return command({kind,employeeId:employee.id,projectId:p,shiftId,expectedVersion,occurredAt,...extra});}
async function batch(events:any[],user=worker){const r=await req('/execution/events',{events},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results;}
async function accepted(e:any,user=worker){const r=(await batch([e],user))[0];assert.equal(r.outcome,'success',JSON.stringify(r));assert.equal(r.status,201);return r.result;}
async function effects(requestId:string){return (await admin.query(`SELECT (SELECT count(*)::int FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2) receipts,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND details->>'requestId'=$2::text) audits,(SELECT count(*)::int FROM managed_execution_events WHERE tenant_id=$1 AND request_id=$2) events`,[tenant,requestId])).rows[0];}
test.before(async()=>{
  const actual=(await admin.query(`SELECT current_setting('port') port,current_setting('data_directory') dir`)).rows[0];assert.equal(actual.port,'54339');assert.ok(actual.dir.endsWith('codex-api/.data/pg-54339'));
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Execution fixture','Europe/Moscow'),($2,'Foreign','UTC')`,[tenant,foreign]);
  for(const u of users)await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`,[u,`${u}@execution.test`,hashPassword('execution-password')]);
  for(const [u,role] of [[director,'director'],[worker,'worker'],[master,'master'],[pto,'pto']])await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,u,role]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`,[foreign,outsider]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own')`,[tenant,org]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'P1'),($1,$3,'P2')`,[tenant,p,p2]);
  app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${server.address().port}`;
  for(const u of users){const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${u}@execution.test`,password:'execution-password'})});assert.equal(r.status,201);tokens.set(u,(await r.json()).token);}
  for(const u of [master,pto])await ok(`/projects/${p}/memberships/${u}`,command({expectedVersion:0,status:'active'}),director,'PUT');
  employee=await ok('/employees',command({fullName:'Execution worker',organizationId:org,userId:worker}));
  const template=await ok(`/projects/${p}/admission-template`,command({code:'safe',title:'Admission',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]}));
  const check=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p,templateVersion:template.version,answers:[{itemId:'safe',value:true}]}));
  await ok(`/projects/${p}/assignments/${employee.id}`,command({expectedVersion:0,status:'active',admissionCheckId:check.id}),director,'PUT');
  const zone=await ok(`/projects/${p}/zones`,command({name:'Execution zone'}));
  const type=await ok(`/projects/${p}/work-types`,command({name:'Concrete',unit:'m3',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
  const front=await ok(`/projects/${p}/front-template`,command({code:'front',title:'Front',items:[{id:'ready',label:'Ready',critical:true}]}));
  task=await ok(`/projects/${p}/tasks`,command({zoneId:zone.id,workTypeId:type.id,title:'Execution plan',workDate:'2027-01-15',plannedQuantity:'12.340',assigneeEmployeeId:employee.id,responsibleUserId:master,plannedStart:'2027-01-15T09:00:00+03:00',plannedEnd:'2027-01-15T10:00:00+03:00',rdReference:null}));
  await ok(`/projects/${p}/tasks/${task.id}/front-checks`,command({expectedVersion:task.version,templateVersion:front.version,answers:[{itemId:'ready',value:true}]}));
  task=await ok(`/projects/${p}/tasks/${task.id}`);
  for(const action of ['submit','publish']){const r=await req(`/projects/${p}/tasks/${task.id}/${action}`,command({expectedVersion:task.version}));assert.equal(r.status,200,JSON.stringify(r));task=r.body;}
  task=await ok(`/projects/${p}/tasks/${task.id}`);
});
test.after(async()=>{
  try{await app?.close();}finally{const c=await admin.connect();try{
    await c.query('BEGIN');await c.query('SET CONSTRAINTS ALL DEFERRED');
    for(const t of ['managed_execution_reports','managed_execution_events','managed_segments','managed_shifts','managed_execution_streams','report_effects','client_events','work_reports','shifts','task_publication_snapshots','task_front_checks','front_template_versions','front_templates','daily_tasks','project_work_zones','project_work_types','crew_members','crews','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','project_memberships','employee_qualifications','people_command_receipts','employees','memberships','projects','organizations','audit_log'])if((await c.query(`SELECT to_regclass($1) name`,[t])).rows[0].name)await c.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
    await c.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await c.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);await c.query('COMMIT');
  }finally{await c.query('ROLLBACK');c.release();await Promise.all([admin.end(),restricted.end()]);}}
});
test('tracer: own managed start/end and exact replay persist one atomic stream and immutable ledger',async()=>{
  const shift=id(),start=event('shift_start',shift,0,'2027-01-15T09:00:00+03:00'),end=event('shift_end',shift,1,'2027-01-15T10:00:00+03:00',{previousEventId:start.requestId});
  const results=await batch([start,end]);assert.deepEqual(results.map((r:any)=>r.outcome),['success','success']);assert.deepEqual(results.map((r:any)=>r.result.version),[1,2]);
  const replay=await batch([start,end]);assert.deepEqual(replay,results.map((r:any)=>({...r,outcome:'duplicate'})));
  for(const e of [start,end])assert.deepEqual(await effects(e.requestId),{receipts:1,audits:1,events:1});
  const rows=(await admin.query(`SELECT * FROM managed_segments WHERE tenant_id=$1 AND shift_id=$2`,[tenant,shift])).rows;assert.equal(rows.length,1);assert.equal(rows[0].mode,'idle');assert.equal(+rows[0].ended_at-+rows[0].started_at,3600000);
  const ledger=(await admin.query(`SELECT * FROM managed_execution_events WHERE tenant_id=$1 AND request_id=$2`,[tenant,start.requestId])).rows[0];assert.deepEqual(ledger.original_payload,start);assert.equal(ledger.command_hash.length,64);assert.ok(ledger.received_at);assert.equal(ledger.review_flags.future,true);
  assert.deepEqual(await ok(`/projects/${p}/tasks/${task.id}`),task);
});
const at='2027-02-01T00:00:00.000Z';
test('client clock review thresholds are exact, inclusive normal bounds; geo is only a client assertion',()=>{
  const received=new Date(at),mark=(ms:number)=>new Date(+received+ms).toISOString();
  assert.deepEqual(executionReviewFlags(mark(-86400000),received,mark(-86400000+300000)),{delayed:false,future:false,suspicious:false,geoTimeMismatch:false,abovePlannedQuantity:false});
  assert.equal(executionReviewFlags(mark(-86400001),received).delayed,true);
  assert.equal(executionReviewFlags(mark(300000),received).future,false);assert.equal(executionReviewFlags(mark(300001),received).future,true);
  assert.equal(executionReviewFlags(at,received,mark(-300000)).geoTimeMismatch,false);assert.equal(executionReviewFlags(at,received,mark(-300001)).geoTimeMismatch,true);
});
async function currentVersion(){return Number((await admin.query(`SELECT version FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2`,[tenant,employee.id])).rows[0]?.version??0);}
test('whole lifecycle: contiguous modes, zero edges, task work and one immutable final provisional volume',async()=>{
  const shift=id(),first=await currentVersion(),start=event('shift_start',shift,first,'2027-01-15T11:00:00+03:00',{geo:{latitude:55.75,longitude:37.61,accuracyMeters:3,capturedAt:'2027-01-15T11:05:00+03:00'}});
  const changes=[start,event('segment_change',shift,first+1,'2027-01-15T11:00:00+03:00',{mode:'work',taskId:task.id}),event('segment_change',shift,first+2,'2027-01-15T12:00:00+03:00',{mode:'break'}),event('segment_change',shift,first+3,'2027-01-15T12:15:00+03:00',{mode:'downtime',taskId:task.id,reasonCode:'equipment',comment:'  Pump stopped  '}),event('segment_change',shift,first+4,'2027-01-15T12:30:00+03:00',{mode:'work',taskId:task.id}),event('shift_end',shift,first+5,'2027-01-15T13:00:00+03:00')];
  changes.forEach((e,i)=>{if(i)e.previousEventId=changes[i-1].requestId;});
  const r=await batch(changes);assert.deepEqual(r.map((i:any)=>i.outcome),changes.map(()=>'success'));assert.equal(r[0].result.reviewFlags.geoTimeMismatch,false);
  const segments=(await admin.query(`SELECT *,extract(epoch FROM ended_at-started_at)*1000 ms FROM managed_segments WHERE tenant_id=$1 AND shift_id=$2 ORDER BY started_at,id`,[tenant,shift])).rows;
  assert.equal(segments.length,5);assert.deepEqual(segments.map(s=>s.mode).sort(),['break','downtime','idle','work','work']);
  assert.deepEqual(segments.map(s=>s.ms).sort(),['0.000000','1800000.000000','3600000.000000','900000.000000','900000.000000'].sort());assert.equal(segments.find(s=>s.mode==='downtime').comment,'Pump stopped');
  assert.equal(segments.reduce((sum,s)=>sum+Number(s.ms),0),7200000);
  const report=event('submit_volume',shift,first+6,'2027-01-16T01:00:00+03:00',{taskId:task.id,reportId:id(),submittedQuantity:'0013.001',previousEventId:changes.at(-1)!.requestId});
  const result=await accepted(report);assert.equal(result.submittedQuantity,'13.001');assert.equal(result.acceptedQuantity,null);assert.equal(result.provisional,true);assert.equal(result.reviewFlags.abovePlannedQuantity,true);
  const last=(await admin.query(`SELECT last_interval_at FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2`,[tenant,employee.id])).rows[0];assert.equal(last.last_interval_at.toISOString(),'2027-01-15T10:00:00.000Z');
  const second={...report,requestId:id(),reportId:id(),expectedVersion:first+7};assert.equal((await batch([second]))[0].code,'final_report_already_submitted');assert.deepEqual(await effects(second.requestId),{receipts:0,audits:0,events:0});
  assert.equal((await batch([report]))[0].outcome,'duplicate');assert.equal((await batch([{...report,submittedQuantity:'2'}]))[0].code,'idempotency_payload_mismatch');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM managed_execution_reports WHERE tenant_id=$1 AND shift_id=$2`,[tenant,shift])).rows[0].n,1);
  assert.deepEqual(await ok(`/projects/${p}/tasks/${task.id}`),task);
});
test('strict union: invalid outer/nested/unused fields, precision and duplicate IDs prevalidate the entire batch',async()=>{
  const e=event('shift_start',id(),await currentVersion(),at);
  const malformed=[{},[],{events:[]},{events:Array(51).fill(e)},{events:[e,e]},{events:[e,{...e,requestId:e.requestId.toUpperCase()}]},{events:[e],actorUserId:worker}];
  for(const b of malformed)assert.equal((await req('/execution/events',b,worker)).status,400,JSON.stringify(b));
  const variants=[{kind:'unknown'},{expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:Number.MAX_SAFE_INTEGER+1},{employeeId:'bad'},{occurredAt:'2027-02-30T00:00:00Z'},{occurredAt:'2027-02-01T00:00:00.1234Z'},{occurredAt:'2027-02-01T00:00:00+24:00'},{occurredAt:'2027-02-01T00:00:00'},{actorUserId:worker},{taskId:task.id},{onBehalfReason:'  '},{geo:{latitude:91,longitude:0,accuracyMeters:0,capturedAt:at}},{geo:{latitude:0,longitude:0,accuracyMeters:-1,capturedAt:at}},{geo:{latitude:0,longitude:0,capturedAt:at}},{geo:{latitude:0,longitude:0,accuracyMeters:0,capturedAt:at,proof:true}},{kind:'segment_change',mode:'work'},{kind:'segment_change',mode:'break',taskId:task.id},{kind:'segment_change',mode:'idle',reasonCode:'other'},{kind:'segment_change',mode:'downtime',comment:'X',reasonCode:'forged'},{kind:'segment_change',mode:'downtime',reasonCode:'other',comment:''},{kind:'submit_volume',taskId:task.id,reportId:id(),submittedQuantity:'1e2'},{kind:'submit_volume',taskId:task.id,reportId:id(),submittedQuantity:'0.000'},{kind:'submit_volume',taskId:task.id,reportId:id(),submittedQuantity:'1.0001'}];
  for(const extra of variants){const bad={...e,requestId:id(),...extra};assert.equal((await req('/execution/events',{events:[e,bad]},worker)).status,400,JSON.stringify(extra));assert.deepEqual(await effects(bad.requestId),{receipts:0,audits:0,events:0});}
  assert.deepEqual(await effects(e.requestId),{receipts:0,audits:0,events:0});
  assert.equal((await req('/execution/events?unknown=1',{events:[e]},worker)).status,400);
});
test('ordered independent outcomes, missing dependency retry, version and chronology failures have zero effects',async()=>{
  const v=await currentVersion(),shift=id(),start=event('shift_start',shift,v,at),missing=id();
  const blocked=event('segment_change',shift,v+1,at,{mode:'break',previousEventId:missing});
  const stale=event('segment_change',shift,v,at,{mode:'idle'}),end=event('shift_end',shift,v+1,at,{previousEventId:start.requestId});
  const results=await batch([blocked,start,stale,end]);assert.deepEqual(results.map((r:any)=>r.outcome),['error','success','error','success']);assert.equal(results[0].code,'missing_dependency');assert.equal(results[0].retryable,true);assert.equal(results[2].code,'stale_version');
  for(const e of [blocked,stale])assert.deepEqual(await effects(e.requestId),{receipts:0,audits:0,events:0});
  const earlier=event('shift_start',id(),v+2,'2027-01-31T23:59:59.999Z');assert.equal((await batch([earlier]))[0].code,'non_chronological_interval');
  const next=event('shift_start',id(),v+2,at),nextEnd=event('shift_end',next.shiftId,v+3,at,{previousEventId:next.requestId});
  assert.equal((await batch([nextEnd]))[0].code,'missing_dependency');await accepted(next);await accepted(nextEnd);
  const changed={...next,kind:'shift_end'};assert.equal((await batch([changed]))[0].code,'idempotency_payload_mismatch');
  const invalid=event('shift_end',id(),v+4,at);assert.equal((await batch([invalid]))[0].code,'shift_reference_denied');assert.equal(await currentVersion(),v+4);
  const early=event('submit_volume',next.shiftId,v+4,'2027-01-31T23:59:59.999Z',{taskId:task.id,reportId:id(),submittedQuantity:'1'});assert.equal((await batch([early]))[0].code,'report_before_shift_end');
  const noWork={...early,requestId:id(),occurredAt:at};assert.equal((await batch([noWork]))[0].code,'positive_closed_task_work_required');
});
test('work, terminal report and downtime references fail atomically while cleanup needs no admission',async()=>{
  const shift=id(),v=await currentVersion();await accepted(event('shift_start',shift,v,at));
  for(const b of [event('segment_change',shift,v+1,at,{mode:'work',taskId:id()}),event('segment_change',shift,v+1,at,{mode:'downtime',taskId:task.id,reasonCode:'front',comment:'No prior work'}),event('submit_volume',shift,v+1,at,{taskId:task.id,reportId:id(),submittedQuantity:'1'})]){const r=(await batch([b]))[0];assert.equal(r.outcome,'error');assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0,events:0});}
  await admin.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]);
  try{
    const work=event('segment_change',shift,v+1,at,{mode:'work',taskId:task.id});assert.equal((await batch([work]))[0].code,'assignment_required');
    await accepted(event('segment_change',shift,v+1,at,{mode:'break'}));await accepted(event('shift_end',shift,v+2,at));
  }finally{await admin.query(`UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]);}
});
test('post-ledger audit failure rolls back domain, stream, event, audit and shared receipt; exact retry succeeds once',async()=>{
  const v=await currentVersion(),shift=id(),start=event('shift_start',shift,v,at),suffix=id().replaceAll('-',''),fn=`execution_fail_${suffix}`;
  const snapshot=async()=>({stream:(await admin.query(`SELECT * FROM managed_execution_streams WHERE tenant_id=$1`,[tenant])).rows,shifts:(await admin.query(`SELECT * FROM managed_shifts WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows,segments:(await admin.query(`SELECT * FROM managed_segments WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows,effects:await effects(start.requestId)});
  const before=await snapshot();
  await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'requestId'='${start.requestId}' THEN RAISE EXCEPTION 'injected execution audit failure'; END IF; RETURN NEW; END $$`);
  try{await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);const r=(await batch([start]))[0];assert.equal(r.status,500);assert.equal(r.retryable,true);assert.deepEqual(await snapshot(),before);}
  finally{await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_log`);await admin.query(`DROP FUNCTION ${fn}()`);}
  await accepted(start);assert.equal((await batch([start]))[0].outcome,'duplicate');await accepted(event('shift_end',shift,v+1,at));
});
test('SQL: FORCE RLS, narrow grants, tenant/project/employee/task FKs, open uniqueness and migration repeat',async()=>{
  const tables=['managed_execution_streams','managed_shifts','managed_segments','managed_execution_events','managed_execution_reports'];
  for(const t of tables){
    assert.deepEqual((await admin.query(`SELECT relrowsecurity rls,relforcerowsecurity force FROM pg_class WHERE oid=$1::regclass`,[t])).rows[0],{rls:true,force:true});
    assert.equal((await restricted.query(`SELECT * FROM ${t}`)).rowCount,0);assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM ${t}`))).rowCount,0);
    assert.equal((await admin.query(`SELECT has_table_privilege('helios_app',$1,'DELETE') allowed`,[t])).rows[0].allowed,false);
  }
  for(const t of ['managed_execution_events','managed_execution_reports'])for(const privilege of ['UPDATE','DELETE'])assert.equal((await admin.query(`SELECT has_table_privilege('helios_app',$1,$2) allowed`,[t,privilege])).rows[0].allowed,false);
  const v=await currentVersion(),shift=id();await accepted(event('shift_start',shift,v,at));
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at) VALUES($1,$2,$3,$4,$5)`,[tenant,p,employee.id,id(),at])),(e:any)=>e.code==='23505');
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at) VALUES($1,$2,$3,$4,$5,'idle',$6)`,[tenant,p,employee.id,shift,id(),at])),(e:any)=>e.code==='23505');
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at) VALUES($1,$2,$3,$4,$5,'idle',$6)`,[tenant,p2,employee.id,shift,id(),at])),(e:any)=>e.code==='23503');
  const another=id();await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Other employee')`,[tenant,another,org]);
  const anotherTask=id();await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Other employee task','2027-02-01',1,'m3',$4)`,[tenant,anotherTask,p,another]);
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,task_id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,'work',$6,$7,$7)`,[tenant,p,employee.id,shift,id(),anotherTask,at])),(e:any)=>e.code==='23503');
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,task_id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,'work',$6,$7,$7)`,[tenant,p,another,shift,id(),task.id,at])),(e:any)=>e.code==='23503');
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`UPDATE managed_shifts SET started_at=$2 WHERE tenant_id=$1`,[tenant,at])),(e:any)=>e.code==='42501');
  await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`UPDATE managed_execution_events SET command_hash='forged' WHERE tenant_id=$1`,[tenant])),(e:any)=>e.code==='42501');
  await accepted(event('shift_end',shift,v+1,at));
  const snapshot=async()=>({ledger:(await admin.query(`SELECT * FROM schema_migrations ORDER BY filename`)).rows,data:await Promise.all(tables.map(async t=>(await admin.query(`SELECT * FROM ${t} WHERE tenant_id=$1 ORDER BY to_jsonb(${t})::text`,[tenant])).rows))});
  const before=await snapshot();assert.equal(before.ledger.filter(r=>r.filename==='007_managed_execution.sql').length,1);
  execFileSync('corepack',['pnpm','db:migrate'],{cwd:new URL('../../../',import.meta.url),env:{...process.env,DATABASE_URL:'postgres://helios_app:helios_app@127.0.0.1:54339/helios',ADMIN_DATABASE_URL:'postgres://helios:helios@127.0.0.1:54339/helios',HELIOS_DB_PORT:'54339',API_PORT:'4327'},stdio:'pipe'});
  assert.deepEqual(await snapshot(),before);
});
