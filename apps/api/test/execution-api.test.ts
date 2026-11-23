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
const tenant=id(),foreign=id(),org=id(),foreignOrg=id(),foreignProject=id(),foreignEmployee=id(),p=id(),p2=id(),director=id(),worker=id(),master=id(),pto=id(),outsider=id();
const users=[director,worker,master,pto,outsider],tokens=new Map<string,string>();
let app:INestApplication|undefined,base:string,employee:any,task:any,publication:any;
const command=(b:any)=>({requestId:id(),...b});
async function req(path:string,body?:unknown,user:string=director,method=body===undefined?'GET':'POST') {
  const r=await fetch(`${base}/api/v1${path}`,{method,headers:{authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':tenant,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json()};
}
async function ok(path:string,body?:unknown,user:string=director,method=body===undefined?'GET':'POST') {const r=await req(path,body,user,method);assert.equal(r.status,method==='POST'?201:200,JSON.stringify(r));return r.body;}
function event(kind:string,shiftId:string,expectedVersion:number,occurredAt:string,extra:any={}) {return command({kind,employeeId:employee.id,projectId:p,shiftId,expectedVersion,occurredAt,...extra});}
async function batch(events:any[],user:string=worker){const r=await req('/execution/events',{events},user);assert.equal(r.status,200,JSON.stringify(r));return r.body.results;}
async function accepted(e:any,user:string=worker){const r=(await batch([e],user))[0];assert.equal(r.outcome,'success',JSON.stringify(r));assert.equal(r.status,201);return r.result;}
async function effects(requestId:string){return (await admin.query(`SELECT (SELECT count(*)::int FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2) receipts,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND details->>'requestId'=$2::text) audits,(SELECT count(*)::int FROM managed_execution_events WHERE tenant_id=$1 AND request_id=$2) events`,[tenant,requestId])).rows[0];}
test.before(async()=>{
  const actual=(await admin.query(`SELECT current_setting('port') port,current_setting('data_directory') dir`)).rows[0];assert.equal(actual.port,'54339');assert.ok(actual.dir.endsWith('codex-api/.data/pg-54339'));
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Execution fixture','Europe/Moscow'),($2,'Foreign','UTC')`,[tenant,foreign]);
  for(const u of users)await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`,[u,`${u}@execution.test`,hashPassword('execution-password')]);
  for(const [u,role] of [[director,'director'],[worker,'worker'],[master,'master'],[pto,'pto']])await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,u,role]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`,[foreign,outsider]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own')`,[tenant,org]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'P1'),($1,$3,'P2')`,[tenant,p,p2]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Foreign')`,[foreign,foreignOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Foreign project')`,[foreign,foreignProject]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Foreign employee')`,[foreign,foreignEmployee,foreignOrg]);
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
  publication=(await admin.query(`SELECT * FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,task.id])).rows;
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

// All race gates are observed through PostgreSQL's actual lock graph before mutation/release.
async function waiters(pid:number,count=1){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){
    const rows=await admin.query(`WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM waiting`,[pid]);
    if(rows.rows[0].n>=count)return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(`Expected ${count} actual PostgreSQL waiters behind ${pid}`);
}
async function executionState(){
  return Promise.all(['managed_execution_streams','managed_shifts','managed_segments','managed_execution_events','managed_execution_reports'].map(async table=>(await admin.query(`SELECT * FROM ${table} WHERE tenant_id=$1 ORDER BY to_jsonb(${table})::text`,[tenant])).rows));
}
async function gateFailure(e:any,user:string,table:string,key:string,mutate:(c:any)=>Promise<unknown>,restore:()=>Promise<unknown>,code:string){
  const c=await admin.connect(),before=await executionState(),beforeEffects=await effects(e.requestId);let pending:Promise<any>|undefined;
  try{
    await c.query('BEGIN');await c.query(`SELECT 1 FROM ${table} WHERE tenant_id=$1 AND ${table==='memberships'||table==='project_memberships'?'user_id':'id'}=$2 ${table==='project_memberships'?'AND project_id=$3':''} FOR NO KEY UPDATE`,table==='project_memberships'?[tenant,key,p]:[tenant,key]);
    const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pending=batch([e],user);await waiters(pid);await mutate(c);await c.query('COMMIT');
    const r=(await pending)[0];assert.equal(r.outcome,'error',JSON.stringify(r));assert.equal(r.code,code,JSON.stringify(r));
    assert.deepEqual(await effects(e.requestId),beforeEffects);assert.deepEqual(await executionState(),before);
  }finally{await c.query('ROLLBACK');c.release();await pending;await restore();}
}
async function refreshAdmission(project=p){
  const template=await ok(`/projects/${project}/admission-template`);
  const check=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:project,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:true}))}));
  const prior=(await admin.query(`SELECT version FROM employee_project_assignments WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,project,employee.id])).rows[0];
  await ok(`/projects/${project}/assignments/${employee.id}`,command({expectedVersion:prior?.version??0,status:'active',admissionCheckId:check.id}),director,'PUT');
  return check;
}
test('authority matrix, target linked master/director compatibility, mandatory manager reason and tenant/project fences',async()=>{
  const v=await currentVersion(),start=event('shift_start',id(),v,at);
  assert.equal((await req('/execution/events',{events:[start]},outsider)).status,403);
  assert.equal((await batch([start],pto))[0].code,'role_denied');
  for(const manager of [master,director])assert.equal((await batch([start],manager))[0].code,'on_behalf_reason_required');
  assert.equal((await batch([{...start,projectId:p2}],worker))[0].status,404);
  assert.equal((await batch([{...start,projectId:p2,onBehalfReason:'Assist'}],master))[0].status,404);
  assert.equal((await batch([{...start,employeeId:id()}],director))[0].status,404);
  const other=await ok('/employees',command({fullName:'Unlinked',organizationId:org}));
  assert.equal((await batch([{...start,employeeId:other.id}],worker))[0].code,'employee_denied');
  // Linked employees may hold any active tenant role, exactly as assignment/publication allow.
  for(const linkedUser of [master,director]){
    await admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,linkedUser]);
    await admin.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,linkedUser]);
    try{
      const shift=id(),version=await currentVersion();
      const e=event('shift_start',shift,version,at,{onBehalfReason:'Record linked manager presence'});
      await accepted(e,director);
      // A master linked to the employee still needs its own project grant as actor.
      if(linkedUser===master)assert.equal((await batch([event('shift_end',shift,version+1,at)],master))[0].status,404);
      await accepted(event('shift_end',shift,version+1,at,{onBehalfReason:'Close linked manager presence'}),director);
    }finally{
      await admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,worker]);
      await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,linkedUser]);
    }
  }
});
test('real waits: current actor role, tenant/project status, employee link and archive are reread after every prerequisite gate',async()=>{
  const start=()=>event('shift_start',id(),0,at); // Failure must precede the intentionally stale version.
  for(const [column,value,reset] of [['role','pto','worker'],['status','revoked','active']]){
    await gateFailure(start(),worker,'memberships',worker,c=>c.query(`UPDATE memberships SET ${column}=$3 WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker,value]),()=>admin.query(`UPDATE memberships SET ${column}=$3 WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker,reset]),'role_denied');
  }
  await gateFailure(start(),worker,'project_memberships',worker,c=>c.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,worker]),()=>admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,worker]),'not_found');
  await gateFailure(start(),worker,'employees',employee.id,c=>c.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,master]),()=>admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,worker]),'employee_denied');
  await gateFailure(start(),worker,'employees',employee.id,c=>c.query(`UPDATE employees SET status='archived' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]),()=>admin.query(`UPDATE employees SET status='active' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]),'employee_denied');
  await gateFailure({...start(),onBehalfReason:'Assist'},master,'employees',employee.id,c=>c.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]),()=>admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]),'not_found');
});
test('real work races: assignment, template/latest admission, evidence version/status/expiry/workDate, cancellation and linked status invalidate after wait',async()=>{
  const q=await ok(`/employees/${employee.id}/qualifications`,command({code:'execution-license',title:'License',validUntil:'2028-01-01'}));
  const template=await ok(`/projects/${p}/admission-template`);
  await ok(`/projects/${p}/admission-template`,command({expectedVersion:template.version,title:template.title,items:template.items,requiredQualificationCodes:['execution-license']}),director,'PUT');
  await refreshAdmission();
  const shift=id(),version=await currentVersion();await accepted(event('shift_start',shift,version,at));
  const work=()=>event('segment_change',shift,version+1,at,{mode:'work',taskId:task.id});
  await gateFailure(work(),worker,'projects',p,c=>c.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]),()=>admin.query(`UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]),'assignment_required');
  await gateFailure(work(),worker,'projects',p,c=>c.query(`UPDATE admission_templates SET version=version+1 WHERE tenant_id=$1 AND project_id=$2`,[tenant,p]),()=>admin.query(`UPDATE admission_templates SET version=version-1 WHERE tenant_id=$1 AND project_id=$2`,[tenant,p]),'admission_required');
  // The new failed attempt is created through the real production command inside the observed project wait.
  const gate=await admin.connect();let pending:Promise<any>|undefined;
  try{
    await gate.query('BEGIN');await gate.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);
    const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    // A project owner first creates the attempt, then queues work behind it on employee.
    const t=await ok(`/projects/${p}/admission-template`);
    const checkCall=req(`/employees/${employee.id}/admission-checks`,command({projectId:p,templateVersion:t.version,answers:t.items.map((i:any)=>({itemId:i.id,value:false}))}));
    await waiters(pid);pending=batch([work()]);await waiters(pid,2);await gate.query('COMMIT');const newer=await checkCall;assert.equal(newer.status,201);assert.equal((await pending)[0].code,'admission_required');
  }finally{await gate.query('ROLLBACK');gate.release();await pending;await refreshAdmission();}
  for(const [change,restore] of [[`version=version+1`,`version=${q.version}`],[`status='revoked'`,`status='active'`],[`valid_until='2000-01-01'`,`valid_until='2028-01-01'`],[`valid_until='2027-01-14'`,`valid_until='2028-01-01'`]]){
    await gateFailure(work(),worker,'employees',employee.id,c=>c.query(`UPDATE employee_qualifications SET ${change} WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]),()=>admin.query(`UPDATE employee_qualifications SET ${restore} WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]),'admission_required');
  }
  await gateFailure(work(),worker,'projects',p,c=>c.query(`UPDATE daily_tasks SET status='cancelled' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]),()=>admin.query(`UPDATE daily_tasks SET status='published' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]),'published_managed_task_required');
  await gateFailure({...work(),onBehalfReason:'Assist'},director,'memberships',worker,c=>c.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]),()=>admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]),'employee_not_ready');
  // Inclusive workDate boundary remains valid when the current exact evidence has that expiry.
  await admin.query(`UPDATE employee_qualifications SET valid_until='2027-01-15' WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]);await refreshAdmission();
  await accepted(work());await accepted(event('shift_end',shift,version+2,'2027-02-01T00:00:00.001Z'));
  await admin.query(`UPDATE employee_qualifications SET valid_until='2028-01-01' WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]);await refreshAdmission();
});
test('queued same receipt, same-version devices and competing projects serialize with one winner, without deadlocks',async()=>{
  await ok(`/projects/${p2}/admission-template`,command({code:'safe2',title:'Second',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]}));await refreshAdmission(p2);
  for(const mode of ['receipt','version','projects']){
    const c=await admin.connect(),v=await currentVersion(),first=event('shift_start',id(),v,'2027-02-02T00:00:00Z');
    const second=mode==='receipt'?first:{...first,requestId:id(),shiftId:id(),...(mode==='projects'?{projectId:p2}:{})};let calls:Promise<any>[]=[];
    try{
      await c.query('BEGIN');await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
      calls=[batch([first])];await waiters(pid);calls.push(batch([second]));await waiters(pid,2);await c.query('COMMIT');
      const [a,b]=await Promise.all(calls);assert.equal(a[0].outcome,'success');assert.equal(b[0].outcome,mode==='receipt'?'duplicate':'error');
      if(mode==='receipt')assert.deepEqual(b[0].result,a[0].result);else assert.equal(b[0].code,'stale_version');
      assert.equal(await currentVersion(),v+1);assert.equal((await admin.query(`SELECT count(*)::int n FROM managed_shifts WHERE tenant_id=$1 AND employee_id=$2 AND ended_at IS NULL`,[tenant,employee.id])).rows[0].n,1);
      await accepted(event('shift_end',first.shiftId,v+1,'2027-02-02T00:00:00Z'));
    }finally{await c.query('ROLLBACK');c.release();await Promise.all(calls);}
  }
});
test('exact replay rechecks current authority but survives business invalidation; managers close archived/revoked time with audited reason',async()=>{
  const shift=id(),v=await currentVersion(),start=event('shift_start',shift,v,'2027-02-03T00:00:00Z');const original=await accepted(start);
  await admin.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND employee_id=$2`,[tenant,employee.id]);
  await admin.query(`UPDATE admission_templates SET version=version+1 WHERE tenant_id=$1 AND project_id=$2`,[tenant,p]);
  try{
    assert.deepEqual((await batch([start]))[0].result,original);
    await gateFailure(start,worker,'memberships',worker,c=>c.query(`UPDATE memberships SET role='pto' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]),()=>admin.query(`UPDATE memberships SET role='worker' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]),'role_denied');
    await admin.query(`UPDATE employees SET status='archived' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]);
    await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]);
    const end=event('shift_end',shift,v+1,'2027-02-03T01:00:00Z');
    assert.equal((await req('/execution/events',{events:[end]},worker)).status,403);
    await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]);assert.equal((await batch([end]))[0].code,'employee_denied');assert.equal((await batch([end],master))[0].code,'on_behalf_reason_required');
    await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]);
    const cleanup={...end,onBehalfReason:'Resolve archived assignee open time'};const done=await accepted(cleanup,master);
    assert.deepEqual((await batch([cleanup],master))[0].result,done);
    const audit=(await admin.query(`SELECT actor_user_id,details FROM audit_log WHERE tenant_id=$1 AND details->>'requestId'=$2`,[tenant,cleanup.requestId])).rows[0];assert.equal(audit.actor_user_id,master);assert.equal(audit.details.onBehalfReason,cleanup.onBehalfReason);
  }finally{
    await admin.query(`UPDATE employees SET status='active' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]);
    await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]);
    await admin.query(`UPDATE admission_templates SET version=version-1 WHERE tenant_id=$1 AND project_id=$2`,[tenant,p]);await refreshAdmission();await refreshAdmission(p2);
  }
});
test('all real people/task operation families share execution receipt namespace; unrelated receipts never satisfy dependencies',async()=>{
  const shift=id(),v=await currentVersion(),start=event('shift_start',shift,v,'2027-02-04T00:00:00Z',{onBehalfReason:'Namespace proof'});
  await accepted(start,director);await accepted(event('shift_end',shift,v+1,'2027-02-04T00:00:00Z',{onBehalfReason:'Namespace proof'}),director);
  const zone=(await ok(`/projects/${p}/zones`)).items[0],type=(await ok(`/projects/${p}/work-types`)).items[0];
  const qualification=(await ok(`/employees/${employee.id}/qualifications`)).items[0],admission=await ok(`/projects/${p}/admission-template`),front=await ok(`/projects/${p}/front-template`);
  const crew=await ok(`/projects/${p}/crews`,command({name:'Namespace crew'}));
  const templates={title:'Namespace',items:[{id:'safe',label:'Safe',critical:true}]};
  const plan={zoneId:zone.id,workTypeId:type.id,title:'Namespace',workDate:'2027-01-15',plannedQuantity:'1',assigneeEmployeeId:employee.id,responsibleUserId:master,plannedStart:'2027-01-15T09:00:00+03:00',plannedEnd:'2027-01-15T10:00:00+03:00',rdReference:null};
  const calls:[string,string,any][]=[
    ['POST','/employees',{fullName:'Namespace',organizationId:org}],
    ['PUT',`/employees/${employee.id}`,{fullName:'Namespace',organizationId:org,phone:null,userId:worker,expectedVersion:1,status:'active'}],
    ['POST',`/employees/${employee.id}/qualifications`,{code:'extra',title:'Namespace'}],
    ['PUT',`/employees/${employee.id}/qualifications/${qualification.id}`,{title:'Namespace',documentReference:null,validUntil:null,expectedVersion:1,status:'active'}],
    ['POST',`/projects/${p}/admission-template`,{...templates,code:'safe',requiredQualificationCodes:[]}],
    ['PUT',`/projects/${p}/admission-template`,{...templates,expectedVersion:1,requiredQualificationCodes:[]}],
    ['POST',`/employees/${employee.id}/admission-checks`,{projectId:p,templateVersion:admission.version,answers:[{itemId:'safe',value:true}]}],
    ['PUT',`/projects/${p}/memberships/${master}`,{expectedVersion:0,status:'active'}],
    ['PUT',`/projects/${p}/assignments/${employee.id}`,{expectedVersion:0,status:'active',admissionCheckId:id()}],
    ['POST',`/projects/${p}/crews`,{name:'Namespace'}],
    ['PUT',`/projects/${p}/crews/${crew.id}/members/${employee.id}`,{expectedVersion:0,status:'active'}],
    ['POST',`/projects/${p}/zones`,{name:'Namespace'}],
    ['PUT',`/projects/${p}/zones/${zone.id}`,{name:'Namespace',expectedVersion:1,status:'active'}],
    ['POST',`/projects/${p}/work-types`,{name:'Namespace',unit:'m',requiresRd:false,requiresId:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false}],
    ['PUT',`/projects/${p}/work-types/${type.id}`,{name:'Namespace',unit:'m',requiresRd:false,requiresId:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,expectedVersion:1,status:'active'}],
    ['POST',`/projects/${p}/front-template`,{...templates,code:'front'}],
    ['PUT',`/projects/${p}/front-template`,{...templates,expectedVersion:1}],
    ['POST',`/projects/${p}/tasks`,plan],
    ['PUT',`/projects/${p}/tasks/${task.id}`,{...plan,expectedVersion:1}],
    ['POST',`/projects/${p}/tasks/${task.id}/front-checks`,{expectedVersion:1,templateVersion:front.version,answers:[{itemId:'ready',value:true}]}],
    ...['submit','publish','reject','reopen','cancel'].map(action=>['POST',`/projects/${p}/tasks/${task.id}/${action}`,{expectedVersion:1,...(['reject','reopen','cancel'].includes(action)?{reason:'Namespace'}:{})}] as [string,string,any])
  ];
  const before=await executionState(),original=(await admin.query(`SELECT * FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,director,start.requestId])).rows[0];
  for(const [method,path,payload] of calls){const r=await req(path,{requestId:start.requestId,...payload},director,method);assert.equal(r.status,409,JSON.stringify({method,path,r}));assert.equal(r.body.error,'idempotency_payload_mismatch');}
  assert.deepEqual(await executionState(),before);assert.deepEqual((await admin.query(`SELECT * FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,director,start.requestId])).rows[0],original);
  const receipts=(await admin.query(`SELECT * FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND operation<>'POST /execution/events' ORDER BY operation`,[tenant,director])).rows;
  assert.ok(receipts.some(r=>r.operation===`POST /employees/${employee.id}/admission-checks`));
  for(const receipt of receipts){
    const reused={...start,requestId:receipt.request_id,shiftId:id(),expectedVersion:await currentVersion()};
    assert.equal((await batch([reused],director))[0].code,'idempotency_payload_mismatch');
    assert.deepEqual((await admin.query(`SELECT * FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,director,receipt.request_id])).rows[0],receipt);
    const dependent={...reused,requestId:id(),previousEventId:receipt.request_id};assert.equal((await batch([dependent],director))[0].code,'missing_dependency');assert.deepEqual(await effects(dependent.requestId),{receipts:0,audits:0,events:0});
  }
  // An execution predecessor belonging to another actor/project/employee is also unrelated.
  for(const extra of [{previousEventId:start.requestId},{projectId:p2,previousEventId:start.requestId}]){
    const dependent=event('shift_start',id(),await currentVersion(),'2027-02-04T00:00:00Z',extra);assert.equal((await batch([dependent]))[0].code,'missing_dependency');
  }
});
test('start and final volume revalidate after waits; expired admission/cancelled work never strands an authorized worker end',async()=>{
  const q=(await ok(`/employees/${employee.id}/qualifications`)).items[0];
  const v=await currentVersion(),shift=id(),start=event('shift_start',shift,v,'2027-02-05T00:00:00Z');
  await gateFailure(start,worker,'projects',p,c=>c.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]),()=>admin.query(`UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]),'assignment_required');
  await accepted(start);await accepted(event('segment_change',shift,v+1,'2027-02-05T00:00:00Z',{mode:'work',taskId:task.id}));
  await admin.query(`UPDATE employee_qualifications SET status='revoked' WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]);
  await admin.query(`UPDATE daily_tasks SET status='cancelled' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]);
  try{
    await accepted(event('segment_change',shift,v+2,'2027-02-05T00:00:00.001Z',{mode:'downtime',taskId:task.id,reasonCode:'safety',comment:'Admission revoked after work'}));
    await accepted(event('segment_change',shift,v+3,'2027-02-05T00:00:00.002Z',{mode:'break'}));
    await accepted(event('shift_end',shift,v+4,'2027-02-05T00:00:00.003Z'));
  }finally{
    await admin.query(`UPDATE employee_qualifications SET status='active' WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]);
    await admin.query(`UPDATE daily_tasks SET status='published' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]);
  }
  const report=()=>event('submit_volume',shift,v+5,'2027-02-05T01:00:00Z',{taskId:task.id,reportId:id(),submittedQuantity:'0.001'});
  await gateFailure(report(),worker,'employees',employee.id,c=>c.query(`UPDATE employee_qualifications SET version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]),()=>admin.query(`UPDATE employee_qualifications SET version=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,q.id,q.version]),'admission_required');
  await gateFailure(report(),worker,'projects',p,c=>c.query(`UPDATE daily_tasks SET status='cancelled' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]),()=>admin.query(`UPDATE daily_tasks SET status='published' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]),'published_managed_task_required');
  const final=report(),result=await accepted(final);
  await admin.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]);
  await admin.query(`UPDATE daily_tasks SET status='cancelled' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]);
  try{assert.deepEqual((await batch([final]))[0].result,result);}finally{await admin.query(`UPDATE daily_tasks SET status='published' WHERE tenant_id=$1 AND id=$2`,[tenant,task.id]);await refreshAdmission();}
});
async function pendingExecutionTask(){
  const zone=(await ok(`/projects/${p}/zones`)).items[0],type=(await ok(`/projects/${p}/work-types`)).items[0],front=await ok(`/projects/${p}/front-template`);
  let t=await ok(`/projects/${p}/tasks`,command({zoneId:zone.id,workTypeId:type.id,title:'Concurrent plan',workDate:'2027-02-06',plannedQuantity:'1',assigneeEmployeeId:employee.id,responsibleUserId:master,plannedStart:'2027-02-06T09:00:00+03:00',plannedEnd:'2027-02-06T10:00:00+03:00',rdReference:null}));
  await ok(`/projects/${p}/tasks/${t.id}/front-checks`,command({expectedVersion:t.version,templateVersion:front.version,answers:front.items.map((i:any)=>({itemId:i.id,value:true}))}));
  t=await ok(`/projects/${p}/tasks/${t.id}`);const submitted=await req(`/projects/${p}/tasks/${t.id}/submit`,command({expectedVersion:t.version}));assert.equal(submitted.status,200);return submitted.body;
}
test('actual publication and employee archive commands coexist with queued starts in both lock orderings',async()=>{
  // Publication first; start waits on its project while both serialize on the employee.
  for(const publicationFirst of [true,false]){
    const t=await pendingExecutionTask(),c=await admin.connect(),v=await currentVersion(),shift=id();let pub:Promise<any>|undefined,start:Promise<any>|undefined;
    try{
      await c.query('BEGIN');await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
      const publish=()=>req(`/projects/${p}/tasks/${t.id}/publish`,command({expectedVersion:t.version}));
      const begin=()=>batch([event('shift_start',shift,v,'2027-02-06T00:00:00Z')]);
      if(publicationFirst){pub=publish();await waiters(pid);start=begin();}else{start=begin();await waiters(pid);pub=publish();}
      await waiters(pid,2);await c.query('COMMIT');assert.equal((await pub).status,200);assert.equal((await start)[0].outcome,'success');
      await accepted(event('shift_end',shift,v+1,'2027-02-06T00:00:00Z'));
      const published=await ok(`/projects/${p}/tasks/${t.id}`);assert.equal((await req(`/projects/${p}/tasks/${t.id}/cancel`,command({expectedVersion:published.version,reason:'Release next publication test interval'}))).status,200);
    }finally{await c.query('ROLLBACK');c.release();await pub;await start;}
  }
  for(const archiveFirst of [true,false]){
    const c=await admin.connect(),v=await currentVersion(),shift=id(),e=await ok(`/employees/${employee.id}`);let archive:Promise<any>|undefined,start:Promise<any>|undefined;
    try{
      await c.query('BEGIN');await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
      const archiveCall=()=>req(`/employees/${employee.id}`,command({expectedVersion:e.version,fullName:e.fullName,organizationId:e.organizationId,phone:e.phone,userId:e.userId,status:'archived'}),director,'PUT');
      const begin=()=>batch([event('shift_start',shift,v,'2027-02-07T00:00:00Z')]);
      if(archiveFirst){archive=archiveCall();await waiters(pid);start=begin();}else{start=begin();await waiters(pid);archive=archiveCall();}
      await waiters(pid,2);await c.query('COMMIT');assert.equal((await archive).status,200);const outcome=(await start)[0];
      if(archiveFirst){assert.equal(outcome.code,'employee_denied');assert.equal(await currentVersion(),v);}
      else{assert.equal(outcome.outcome,'success');await accepted(event('shift_end',shift,v+1,'2027-02-07T00:00:00Z',{onBehalfReason:'Resolve employee archived after start'}),director);}
    }finally{
      await c.query('ROLLBACK');c.release();await archive;await start;
      await admin.query(`UPDATE employees SET status='active' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]);await refreshAdmission();await refreshAdmission(p2);
    }
  }
  // Immutable publication snapshots and base task plan survive every execution mutation/race.
  assert.deepEqual(await ok(`/projects/${p}/tasks/${task.id}`),task);
});
test('real foreign tenant/project, draft/pending/legacy/cancelled/other-assignee task references cannot authorize work',async()=>{
  const v=await currentVersion(),shift=id(),start=event('shift_start',shift,v,'2027-02-08T00:00:00Z');
  for(const extra of [{projectId:foreignProject},{employeeId:foreignEmployee}]){
    const e={...start,requestId:id(),onBehalfReason:'Cannot cross tenant',...extra};assert.equal((await batch([e],director))[0].status,404);assert.deepEqual(await effects(e.requestId),{receipts:0,audits:0,events:0});
  }
  await accepted(start);
  const pending=await pendingExecutionTask();
  const legacy=id();await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Legacy own','2027-02-08',1,'m3',$4)`,[tenant,legacy,p,employee.id]);
  const otherTask=(await admin.query(`SELECT id FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND assignee_employee_id<>$3 LIMIT 1`,[tenant,p,employee.id])).rows[0].id;
  const list=[{taskId:pending.id,code:'published_managed_task_required'},{taskId:legacy,code:'published_managed_task_required'},{taskId:otherTask,code:'task_reference_denied'},{taskId:id(),code:'task_reference_denied'}];
  for(const entry of list){const e=event('segment_change',shift,v+1,'2027-02-08T00:00:00Z',{mode:'work',taskId:entry.taskId});assert.equal((await batch([e]))[0].code,entry.code);assert.deepEqual(await effects(e.requestId),{receipts:0,audits:0,events:0});}
  for(const action of ['reject','submit','reopen','submit','cancel']){
    const current=await ok(`/projects/${p}/tasks/${pending.id}`);const response=await req(`/projects/${p}/tasks/${pending.id}/${action}`,command({expectedVersion:current.version,...(action==='submit'?{}:{reason:'Task state must not authorize execution'})}));assert.equal(response.status,200);
    const e=event('segment_change',shift,v+1,'2027-02-08T00:00:00Z',{mode:'work',taskId:pending.id});assert.equal((await batch([e]))[0].code,'published_managed_task_required');
  }
  await accepted(event('shift_end',shift,v+1,'2027-02-08T00:00:00Z'));
  assert.deepEqual((await admin.query(`SELECT * FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,task.id])).rows,publication);
  assert.deepEqual(await ok(`/projects/${p}/tasks/${task.id}`),task);
});

test('scoped reads: deterministic pages, current own link/assignment/grants, no foreign or other employee disclosure',async()=>{
  const root=`/projects/${p}/execution`,list=await ok(`${root}/shifts`,undefined,worker);
  assert.ok(list.total>3);assert.equal(list.limit,25);assert.equal(list.offset,0);assert.ok(list.items.every((s:any)=>s.employeeId===employee.id&&s.projectId===p));assert.ok(list.items.every((s:any)=>s.version===list.items[0].version));
  const paged=await ok(`${root}/shifts?limit=1&offset=1`,undefined,worker);assert.equal(paged.total,list.total);assert.deepEqual(paged.items,[list.items[1]]);
  assert.equal(list.items[0].startEvent.reviewFlags.future,true);assert.ok(list.items[0].startEvent.receivedAt);assert.ok(list.items[0].endEvent.occurredAt);
  const shift=list.items[0].id,segments=await ok(`${root}/shifts/${shift}/segments?limit=1`,undefined,worker);assert.ok(segments.total>=1);assert.equal(segments.items.length,1);
  const other=(await admin.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id<>$2 LIMIT 1`,[tenant,employee.id])).rows[0].id;
  for(const user of [director,master,pto])assert.equal((await req(`${root}/shifts`,undefined,user)).status,200);
  for(const path of [`/projects/${foreignProject}/execution/shifts`,`${root}/shifts?employeeId=${other}`,`${root}/employees/${other}/day?day=2026-11-01`,`${root}/shifts/${id()}/segments`])assert.equal((await req(path,undefined,worker)).status,404,path);
  assert.equal((await req(`${root}/shifts`,undefined,outsider)).status,403);
  const paths=[`${root}/shifts`,`${root}/shifts/${shift}/segments`,`${root}/reports`,`${root}/employees/${employee.id}/day?day=2026-11-01`];
  for(const [table,key,restore] of [['employee_project_assignments','employee_id',employee.id],['project_memberships','user_id',worker]] as const){
    await admin.query(`UPDATE ${table} SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND ${key}=$3`,[tenant,p,restore]);
    try{for(const path of paths)assert.equal((await req(path,undefined,worker)).status,404,path);}finally{await admin.query(`UPDATE ${table} SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND ${key}=$3`,[tenant,p,restore]);}
  }
  await admin.query(`UPDATE employees SET user_id=NULL WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]);
  try{for(const path of paths)assert.equal((await req(path,undefined,worker)).status,404);}finally{await admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,worker]);}
  await admin.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,pto]);
  try{assert.equal((await req(`${root}/shifts`,undefined,pto)).status,404);}finally{await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,pto]);}
  // A stream version is employee-wide: current other-project increments are reflected without rows leaking.
  assert.equal(list.items[0].version,await currentVersion());
});
// Explicit read fixtures cover historical civil dates without altering the immutable event ledger.
async function readInterval(start:string,end:string|null,mode='idle',taskId:string|null=null){
  const shift=id();
  await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6)`,[tenant,p,employee.id,shift,start,end]);
  await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,task_id,reason_code,comment,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[tenant,p,employee.id,shift,id(),mode,taskId,mode==='downtime'?'weather':null,mode==='downtime'?'Rain':null,start,end]);
  return shift;
}
async function dayRead(day:string,asOf:string,user=worker){return ok(`/projects/${p}/execution/employees/${employee.id}/day?day=${day}&asOf=${encodeURIComponent(asOf)}`,undefined,user);}
test('civil day clips exact milliseconds, cross-midnight modes and per-task attribution; zero and before-asOf edges',async()=>{
  const tz=(await admin.query(`SELECT timezone FROM tenants WHERE id=$1`,[tenant])).rows[0].timezone;
  await admin.query(`UPDATE tenants SET timezone='Asia/Kathmandu' WHERE id=$1`,[tenant]);
  try{
    await readInterval('2026-10-19T18:14:59.999Z','2026-10-19T18:15:00.001Z','work',task.id);
    await readInterval('2026-10-20T18:14:59.999Z','2026-10-20T18:15:00.001Z','downtime',task.id);
    await readInterval('2026-10-20T12:00:00.000Z','2026-10-20T12:00:00.001Z','break');
    await readInterval('2026-10-20T13:00:00.000Z','2026-10-20T13:00:00.000Z');
    const d=await dayRead('2026-10-20','2026-10-21T00:00:00Z');
    assert.deepEqual([d.presenceMs,d.workMs,d.downtimeMs,d.breakMs,d.idleMs],['3','1','1','1','0']);assert.equal(d.timezone,'Asia/Kathmandu');assert.equal(d.source,'server_as_of');assert.equal(d.provisional,true);assert.equal(d.hasOpenIntervals,false);assert.equal(d.version,await currentVersion());assert.deepEqual(d.tasks,[{taskId:task.id,workMs:'1',downtimeMs:'1'}]);
    const before=await dayRead('2026-10-20','2026-10-19T00:00:00Z');assert.equal(before.presenceMs,'0');assert.deepEqual(before.tasks,[]);
    const empty=await dayRead('2026-10-22','2026-10-23T00:00:00Z');assert.equal(empty.presenceMs,'0');assert.deepEqual(empty.tasks,[]);
    const atEnd=await dayRead('2026-10-20','2026-10-19T18:15:00.001Z');assert.equal(atEnd.presenceMs,'1');
  }finally{await admin.query(`UPDATE tenants SET timezone=$2 WHERE id=$1`,[tenant,tz]);}
});
test('DST boundaries are independent: exact 23h and 25h days, open asOf clipping and future/invalid queries',async()=>{
  await admin.query(`UPDATE tenants SET timezone='America/New_York' WHERE id=$1`,[tenant]);
  let open:string|undefined;
  try{
    await readInterval('2026-03-08T05:00:00Z','2026-03-09T04:00:00Z');
    await readInterval('2026-11-01T04:00:00Z','2026-11-02T05:00:00Z');
    for(const [day,ms] of [['2026-03-08','82800000'],['2026-11-01','90000000']]){const d=await dayRead(day!,'2026-11-03T00:00:00Z');assert.equal(d.presenceMs,ms);assert.equal(d.idleMs,ms);assert.equal(d.workMs,'0');}
    open=await readInterval('2026-11-03T05:00:00.001Z',null,'work',task.id);
    const d=await dayRead('2026-11-03','2026-11-03T05:00:01.002Z');assert.equal(d.presenceMs,'1001');assert.equal(d.workMs,'1001');assert.equal(d.hasOpenIntervals,true);assert.deepEqual(d.tasks,[{taskId:task.id,workMs:'1001',downtimeMs:'0'}]);
    assert.equal((await dayRead('2026-11-03','2026-11-03T05:00:00.001Z')).presenceMs,'0');
    assert.equal((await dayRead('2026-11-03','2026-11-03T04:59:59Z')).hasOpenIntervals,false);
    const defaultAsOf=await ok(`/projects/${p}/execution/employees/${employee.id}/day?day=2026-11-03`,undefined,worker);assert.ok(+new Date(defaultAsOf.asOf)<=Date.now());assert.match(defaultAsOf.presenceMs,/^\d+$/);
    const root=`/projects/${p}/execution`;
    for(const path of [`${root}/employees/${employee.id}/day`,`${root}/employees/${employee.id}/day?day=2026-02-30`,`${root}/employees/${employee.id}/day?day=2026-11-03&asOf=2099-01-01T00:00:00Z`,`${root}/employees/${employee.id}/day?day=2026-11-03&asOf=2026-11-03T00:00:00.0001Z`,`${root}/shifts?limit=101`,`${root}/shifts?limit=1&limit=2`,`${root}/reports?day=2026-02-30`,`${root}/reports?taskId=no`,`${root}/shifts?unexpected=1`,`${root}/employees/${employee.id}/day?day=2026-11-03&employeeId=${id()}`])assert.equal((await req(path,undefined,worker)).status,400,path);
    await admin.query(`UPDATE tenants SET timezone='invalid/zone' WHERE id=$1`,[tenant]);
    for(const path of [`${root}/employees/${employee.id}/day?day=2026-11-03`,`${root}/reports`,`/overview?day=2026-11-03`])assert.equal((await req(path)).status,422,path);
  }finally{if(open){await admin.query(`UPDATE managed_segments SET ended_at='2026-11-03T05:00:01.002Z' WHERE tenant_id=$1 AND shift_id=$2`,[tenant,open]);await admin.query(`UPDATE managed_shifts SET ended_at='2026-11-03T05:00:01.002Z' WHERE tenant_id=$1 AND id=$2`,[tenant,open]);}await admin.query(`UPDATE tenants SET timezone='Europe/Moscow' WHERE id=$1`,[tenant]);}
});
test('reports use tenant submission occurredAt day and quantities by unit; mixed legacy overview counts each source once',async()=>{
  const root=`/projects/${p}/execution`,reports=await ok(`${root}/reports?day=2027-01-16&employeeId=${employee.id}&taskId=${task.id}`,undefined,worker);
  assert.equal(reports.total,1);const r=reports.items[0];assert.equal(r.submittedQuantity,'13.001');assert.equal(r.acceptedQuantity,null);assert.equal(r.provisional,true);assert.equal(r.source,'managed_execution_events.occurred_at');assert.ok(r.reviewFlags);assert.notEqual(r.occurredAt.slice(0,10),r.receivedAt.slice(0,10));
  assert.equal((await ok(`${root}/reports?day=2027-01-15&taskId=${task.id}`,undefined,worker)).total,0);
  assert.deepEqual((await ok(`${root}/reports?day=2027-01-16&limit=1&offset=1`,undefined,worker)).items,[]);
  const legacy=(await admin.query(`SELECT id FROM daily_tasks WHERE tenant_id=$1 AND project_id=$2 AND assignee_employee_id=$3 AND workflow_kind='legacy' LIMIT 1`,[tenant,p,employee.id])).rows[0].id;
  const shift=id(),report=id();await admin.query(`INSERT INTO shifts(tenant_id,id,task_id,employee_id,started_at,status) VALUES($1,$2,$3,$4,'2027-01-16T00:00:00+03:00','open')`,[tenant,shift,legacy,employee.id]);
  await admin.query(`INSERT INTO work_reports(tenant_id,id,task_id,submitted_quantity,created_at) VALUES($1,$2,$3,2.500,'2027-01-16T00:00:00+03:00')`,[tenant,report,legacy]);
  const o=await ok(`/overview?projectId=${p}&day=2027-01-16`,undefined,worker);
  assert.equal(o.employeesStartedShiftsForDay,1);assert.equal(o.currentOpenShifts,1);assert.equal(o.submittedReportsForDay,1);assert.equal(o.quantities[0].submittedQuantity,'2.500');
  assert.equal(o.managedExecution.employeesStartedShiftsForDay,0);assert.equal(o.managedExecution.currentOpenShifts,0);assert.equal(o.managedExecution.submittedReportsForDay,1);assert.deepEqual(o.managedExecution.quantities,[{unit:'m3',submittedQuantity:'13.001',acceptedQuantity:null}]);assert.equal(o.managedExecution.provisional,true);assert.equal(o.quality.status,'unavailable');assert.equal(o.downtimeDuration.status,'unavailable');
  assert.equal(o.managedExecution.reportDateSource,r.source);assert.equal(o.managedExecution.source,'server_as_of');
  for(const user of [director,master,pto])assert.equal((await ok(`/overview?projectId=${p}&day=2027-01-16`,undefined,user)).managedExecution.submittedReportsForDay,1);
  assert.deepEqual(await ok(`/projects/${p}/tasks/${task.id}`),task);
});

const originalOperationInventory=[["post","/api/v1/auth/login"],["post","/api/v1/auth/logout"],["get","/api/v1/me"],["get","/api/v1/projects"],["get","/api/v1/projects/{id}"],["get","/api/v1/projects/{id}/tasks"],["post","/api/v1/projects/{id}/tasks"],["get","/api/v1/employees"],["post","/api/v1/employees"],["get","/api/v1/employees/{id}"],["put","/api/v1/employees/{id}"],["get","/api/v1/overview"],["get","/api/v1/openapi.json"],["get","/api/v1/employees/{id}/qualifications"],["post","/api/v1/employees/{id}/qualifications"],["put","/api/v1/employees/{id}/qualifications/{qid}"],["get","/api/v1/projects/{p}/admission-template"],["post","/api/v1/projects/{p}/admission-template"],["put","/api/v1/projects/{p}/admission-template"],["get","/api/v1/projects/{p}/admission-template/versions"],["get","/api/v1/employees/{id}/admission-checks"],["post","/api/v1/employees/{id}/admission-checks"],["get","/api/v1/employees/{id}/admission-checks/{check}"],["get","/api/v1/projects/{p}/memberships"],["put","/api/v1/projects/{p}/memberships/{user}"],["get","/api/v1/projects/{p}/assignments"],["put","/api/v1/projects/{p}/assignments/{e}"],["get","/api/v1/projects/{p}/crews"],["post","/api/v1/projects/{p}/crews"],["get","/api/v1/projects/{p}/crews/{crew}"],["put","/api/v1/projects/{p}/crews/{crew}/members/{e}"],["get","/api/v1/projects/{p}/zones"],["post","/api/v1/projects/{p}/zones"],["put","/api/v1/projects/{p}/zones/{catalog}"],["get","/api/v1/projects/{p}/work-types"],["post","/api/v1/projects/{p}/work-types"],["put","/api/v1/projects/{p}/work-types/{catalog}"],["get","/api/v1/projects/{id}/tasks/{task}"],["put","/api/v1/projects/{id}/tasks/{task}"],["get","/api/v1/projects/{p}/front-template"],["post","/api/v1/projects/{p}/front-template"],["put","/api/v1/projects/{p}/front-template"],["get","/api/v1/projects/{p}/front-template/versions"],["get","/api/v1/projects/{id}/tasks/{task}/front-checks"],["post","/api/v1/projects/{id}/tasks/{task}/front-checks"],["get","/api/v1/projects/{id}/tasks/{task}/front-checks/{check}"],["get","/api/v1/projects/{id}/tasks/{task}/readiness"],["post","/api/v1/projects/{id}/tasks/{task}/submit"],["post","/api/v1/projects/{id}/tasks/{task}/reject"],["post","/api/v1/projects/{id}/tasks/{task}/reopen"],["post","/api/v1/projects/{id}/tasks/{task}/cancel"],["post","/api/v1/projects/{id}/tasks/{task}/publish"],["post","/api/tasks"]];
test('OpenAPI81 retains exact old58 inventory plus time days and route configuration, strict execution forms and all references',async()=>{
  const spec=await (await fetch(`${base}/api/v1/openapi.json`)).json(),schemas=spec.components.schemas;
  const added=[['post','/api/v1/execution/events'],['get','/api/v1/projects/{p}/execution/shifts'],['get','/api/v1/projects/{p}/execution/shifts/{shift}/segments'],['get','/api/v1/projects/{p}/execution/reports'],['get','/api/v1/projects/{p}/execution/employees/{employee}/day']];
  const actual=Object.entries(spec.paths).filter(([p])=>!p.includes('/invitations')&&!p.includes('/join/')).flatMap(([p,v]:any)=>Object.keys(v).map(m=>`${m} ${p}`));
  const evidence='/api/v1/projects/{p}/evidence',time='/api/v1/projects/{p}/time',daily=time+'/employees/{employee}/days/{day}';
  const added03b=[['post',evidence],['get',evidence],['get',evidence+'/{file}'],['put',evidence+'/{file}/content'],['get',evidence+'/{file}/content'],['post',evidence+'/{file}/attachment'],['get',daily],['get',daily+'/history'],['post',daily+'/approvals'],['post',daily+'/revoke'],['get',time+'/export.xlsx']];
  added03b.push(['get',time+'/days']);
  const routeConfig=[['get','/api/v1/projects/{projectId}/route-config'],['post','/api/v1/projects/{projectId}/route-config'],['get','/api/v1/projects/{id}/tasks/{task}/route']];
  const phoneRoutes=[['post','/api/v1/auth/phone/challenge'],['post','/api/v1/auth/phone/login']];
  const orders=[['get','/api/v1/responsibility-orders'],['post','/api/v1/responsibility-orders'],['get','/api/v1/responsibility-orders/applicability'],['get','/api/v1/responsibility-orders/{id}'],['post','/api/v1/responsibility-orders/{id}'],['post','/api/v1/responsibility-orders/{id}/revoke']];
  const prices=[['get','/api/v1/contract-prices/projects'],['get','/api/v1/projects/{projectId}/contract-prices'],['post','/api/v1/projects/{projectId}/contract-prices'],['post','/api/v1/projects/{projectId}/contract-prices/checks'],['post','/api/v1/projects/{projectId}/contract-prices/imports']];
  const checklistTemplates=[["get", "/api/v1/checklist-templates"], ["get", "/api/v1/projects/{projectId}/checklist-templates"], ["post", "/api/v1/projects/{projectId}/checklist-templates"], ["get", "/api/v1/projects/{projectId}/checklist-templates/{templateId}"], ["post", "/api/v1/projects/{projectId}/checklist-templates/{templateId}"], ["post", "/api/v1/projects/{projectId}/checklist-templates/{templateId}/submit"], ["post", "/api/v1/projects/{projectId}/checklist-templates/{templateId}/decision"]];
  const checklistRuns=[["get","/api/v1/projects/{projectId}/tasks/{taskId}/checklist-runs"],["post","/api/v1/projects/{projectId}/tasks/{taskId}/checklist-runs"],["post","/api/v1/projects/{projectId}/tasks/{taskId}/checklist-files"],["get","/api/v1/projects/{projectId}/tasks/{taskId}/checklist-files/{fileId}"]];
  const primaryDayOps=[["get", "/api/v1/projects/{p}/time/primary-days/{day}"], ["post", "/api/v1/projects/{p}/time/primary-days/{day}/close"], ["post", "/api/v1/projects/{p}/time/primary-days/{day}/corrections"], ["get", "/api/v1/projects/{p}/time/consolidated/{day}"], ["post", "/api/v1/projects/{p}/time/consolidated/{day}/revisions"]];
  const staffImports=[['post','/api/v1/staff-imports/checks'],['get','/api/v1/staff-imports'],['post','/api/v1/staff-imports']];
  const materialRoutes=[['post','/api/v1/projects/{projectId}/material-batches/{batchId}/control'],['get','/api/v1/material-batches/projects'],['get','/api/v1/projects/{projectId}/material-batches'],['post','/api/v1/projects/{projectId}/material-batches'],['get','/api/v1/projects/{projectId}/material-batches/{batchId}'],['post','/api/v1/projects/{projectId}/material-batches/{batchId}'],['put','/api/v1/projects/{projectId}/material-batches/{batchId}/documents/{documentId}/content'],['get','/api/v1/projects/{projectId}/material-batches/{batchId}/documents/{documentId}/content']];
  const volumeReviewOps=[['get','/api/v1/projects/{project}/volume-reviews'],['get','/api/v1/projects/{project}/volume-reviews/{report}'],['post','/api/v1/projects/{project}/volume-reviews/{report}']];
  volumeReviewOps.push(['post','/api/v1/projects/{project}/volume-reviews/{report}/remainder'],['post','/api/v1/projects/{project}/volume-reviews/{report}/corrections']);
  const internalInspectionOps=[['get','/api/v1/projects/{project}/accepted-parts/{part}/internal-inspection'],['post','/api/v1/projects/{project}/accepted-parts/{part}/internal-inspection'],['get','/api/v1/projects/{project}/internal-inspection-policy'],['post','/api/v1/projects/{project}/internal-inspection-policy']];
  const idSetOps=[['get','/api/v1/projects/{p}/id-sets'],['post','/api/v1/projects/{p}/work-types/{workType}/id-set']];
  const admissionSafetyOps=[['get','/api/v1/employees/{id}/admission-checks/{check}/safety-review'],['post','/api/v1/employees/{id}/admission-checks/{check}/safety-review']];
  const admissionApprovalOps=[['get','/api/v1/employees/{id}/admission-checks/{check}/approval'],['post','/api/v1/employees/{id}/admission-checks/{check}/approval']];
  const customerSubmissionOps=[['get','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission'],['post','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission'],['post','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission/remarks'],['post','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission/remarks/{remark}/close'],['post','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission/remarks/{remark}/photos'],['get','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission/remarks/{remark}/photos/{photo}'],['post','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission/scans'],['get','/api/v1/projects/{project}/accepted-parts/{part}/customer-submission/scans/{scan}'],['get','/api/v1/projects/{project}/customer-submission-zones']];
  const crewTaskOps=[['post','/api/v1/projects/{id}/crew-tasks'],['post','/api/v1/projects/{id}/tasks/{task}/crew-volume']];
  const newKeys=[...added03b,...routeConfig,...orders,...phoneRoutes,...prices,...checklistTemplates,...checklistRuns,...primaryDayOps,...staffImports,...materialRoutes,...volumeReviewOps,...internalInspectionOps,...customerSubmissionOps,...admissionSafetyOps,...admissionApprovalOps,...idSetOps,...crewTaskOps].map(([m,p])=>`${m} ${p}`),retained=actual.filter(k=>!newKeys.includes(k));
  assert.equal(originalOperationInventory.length,53);assert.equal(retained.length,58);assert.deepEqual(retained.sort(),[...originalOperationInventory,...added].map(([m,p])=>`${m} ${p}`).sort());
  assert.equal(added03b.length,12);assert.equal(orders.length,6);assert.equal(actual.length,139);assert.deepEqual(actual.sort(),[...originalOperationInventory.map(([m,p])=>`${m} ${p}`),...added.map(([m,p])=>`${m} ${p}`),...newKeys].sort());
  const ids=Object.values(spec.paths).flatMap((p:any)=>Object.values(p).map((v:any)=>v.operationId));assert.equal(new Set(ids).size,145);

  const scan=(v:any):void=>{if(v&&typeof v==='object'){if(v.$ref?.startsWith('#/'))assert.ok(v.$ref.slice(2).split('/').reduce((o:any,k:string)=>o?.[k],spec),v.$ref);Object.values(v).forEach(scan);}};scan(spec);
  function matches(v:any,s:any):void{
    if(s.$ref)return matches(v,schemas[s.$ref.split('/').at(-1)]);
    if(v===null&&s.nullable)return;
    if(s.oneOf){const matching=s.oneOf.filter((child:any)=>{try{matches(v,child);return true;}catch{return false;}});assert.equal(matching.length,1,JSON.stringify(v));return;}
    if(s.enum)assert.ok(s.enum.includes(v),JSON.stringify(v));
    if(s.type==='object'){assert.ok(v&&typeof v==='object'&&!Array.isArray(v));for(const key of s.required??[])assert.ok(key in v,key);for(const [k,x]of Object.entries(v)){if(s.additionalProperties===false)assert.ok(k in s.properties,k);if(s.properties[k])matches(x,s.properties[k]);}}
    else if(s.type==='array'){assert.ok(Array.isArray(v));if(s.minItems!==undefined)assert.ok(v.length>=s.minItems);if(s.maxItems!==undefined)assert.ok(v.length<=s.maxItems);v.forEach(x=>matches(x,s.items));}
    else if(s.type==='integer'){assert.ok(Number.isSafeInteger(v));if(s.minimum!==undefined)assert.ok(v>=s.minimum);if(s.maximum!==undefined)assert.ok(v<=s.maximum);}
    else{assert.equal(typeof v,s.type);if(s.pattern)assert.match(v,new RegExp(s.pattern));if(s.minimum!==undefined)assert.ok(v>=s.minimum);if(s.maximum!==undefined)assert.ok(v<=s.maximum);}
  }
  const root=`/projects/${p}/execution`,shifts=await ok(`${root}/shifts`,undefined,worker);
  for(const [path,schema]of [[`${root}/shifts`,'ExecutionShiftList'],[`${root}/shifts/${shifts.items[0].id}/segments`,'ExecutionSegmentList'],[`${root}/reports`,'ExecutionReportList'],[`${root}/employees/${employee.id}/day?day=2026-11-03&asOf=2026-11-04T00:00:00Z`,'ExecutionDay'],[`/overview?day=2026-11-03&projectId=${p}`,'Overview']])matches(await ok(path!,undefined,worker),schemas[schema!]);
  const c=event('shift_start',id(),await currentVersion(),'2027-02-09T00:00:00Z'),forms=[c,{...c,kind:'shift_end'},...['idle','break','work','downtime'].map(mode=>({...c,kind:'segment_change',mode,...(mode==='work'?{taskId:task.id}:{}),...(mode==='downtime'?{taskId:task.id,reasonCode:'other',comment:'Client assertion'}:{})})),{...c,kind:'submit_volume',taskId:task.id,reportId:id(),submittedQuantity:'0.001'}];
  assert.equal(schemas.ExecutionEventInput.oneOf.length,7);
  for(const form of forms){matches({events:[form]},schemas.ExecutionBatchInput);const shape=schemas[schemas.ExecutionEventInput.oneOf.find((r:any)=>{try{matches(form,r);return true;}catch{return false;}}).$ref.split('/').at(-1)];assert.equal(shape.additionalProperties,false);assert.throws(()=>matches({...form,actorUserId:worker},schemas.ExecutionEventInput));}
  assert.equal(schemas.ExecutionGeo.additionalProperties,false);assert.equal(schemas.ExecutionBatchInput.properties.events.maxItems,50);
  for(const [method,path]of added){const op=spec.paths[path!][method!];for(const code of ['200','400','401','403',...(method==='get'?['404']:[]),...(path!.includes('/day')||path!.endsWith('/reports')?['422']:[])])assert.ok(op.responses[code]);if(method==='post')assert.equal(op.requestBody.required,true);}
  const original=(await admin.query(`SELECT original_payload FROM managed_execution_events WHERE tenant_id=$1 AND actor_user_id=$2 ORDER BY version LIMIT 1`,[tenant,worker])).rows[0].original_payload;
  const blocked={...c,previousEventId:id()},results=await batch([original,blocked]);assert.equal(results[0].outcome,'duplicate');assert.equal(results[1].code,'missing_dependency');matches({results},schemas.ExecutionBatchResult);
  const volumes=(await admin.query(`SELECT original_payload FROM managed_execution_events WHERE tenant_id=$1 AND kind='submit_volume' AND actor_user_id=$2 LIMIT 1`,[tenant,worker])).rows[0].original_payload;
  matches({results:await batch([volumes])},schemas.ExecutionBatchResult);
});
test('managed overview never sums incompatible units: two task reports in one shift remain separate provisional totals',async()=>{
  const zone=(await ok(`/projects/${p}/zones`)).items[0],front=await ok(`/projects/${p}/front-template`);
  const type=await ok(`/projects/${p}/work-types`,command({name:'Area',unit:'m2',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
  let second=await ok(`/projects/${p}/tasks`,command({zoneId:zone.id,workTypeId:type.id,title:'Area plan',workDate:'2027-02-09',plannedQuantity:'10',assigneeEmployeeId:employee.id,responsibleUserId:master,plannedStart:'2027-02-09T09:00:00+03:00',plannedEnd:'2027-02-09T10:00:00+03:00',rdReference:null}));
  await ok(`/projects/${p}/tasks/${second.id}/front-checks`,command({expectedVersion:second.version,templateVersion:front.version,answers:front.items.map((i:any)=>({itemId:i.id,value:true}))}));
  for(const action of ['submit','publish']){second=await ok(`/projects/${p}/tasks/${second.id}`);const r=await req(`/projects/${p}/tasks/${second.id}/${action}`,command({expectedVersion:second.version}));assert.equal(r.status,200,JSON.stringify(r));}
  const v=await currentVersion(),shift=id();
  const events=[event('shift_start',shift,v,'2027-02-09T09:00:00+03:00'),event('segment_change',shift,v+1,'2027-02-09T09:00:00+03:00',{mode:'work',taskId:task.id}),event('segment_change',shift,v+2,'2027-02-09T09:00:00.001+03:00',{mode:'work',taskId:second.id}),event('shift_end',shift,v+3,'2027-02-09T09:00:00.002+03:00'),event('submit_volume',shift,v+4,'2027-02-10T00:00:00+03:00',{taskId:task.id,reportId:id(),submittedQuantity:'99999999999.999'}),event('submit_volume',shift,v+5,'2027-02-10T00:00:00+03:00',{taskId:second.id,reportId:id(),submittedQuantity:'0.001'})];
  assert.deepEqual((await batch(events)).map((r:any)=>r.outcome),events.map(()=>'success'));
  const o=(await ok(`/overview?projectId=${p}&day=2027-02-10`,undefined,worker)).managedExecution;
  assert.equal(o.submittedReportsForDay,2);assert.deepEqual(o.quantities,[{unit:'m2',submittedQuantity:'0.001',acceptedQuantity:null},{unit:'m3',submittedQuantity:'99999999999.999',acceptedQuantity:null}]);
  const read=await ok(`/projects/${p}/execution/reports?day=2027-02-10&limit=1`,undefined,worker);assert.equal(read.total,2);assert.equal(read.items.length,1);
  const all=await ok(`/projects/${p}/execution/reports?day=2027-02-10`,undefined,worker);assert.deepEqual([...all.items].sort((a:any,b:any)=>a.reportId.localeCompare(b.reportId)),all.items);
});
