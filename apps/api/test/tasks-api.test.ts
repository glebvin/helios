import assert from 'node:assert/strict';
import {randomUUID as id,createHash} from 'node:crypto';
import {stableEventBody} from '@helios/domain';
import {WorkforceService,type Actor} from '../src/workforce.service.js';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {createPool,adminUrl,withTenant} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {AllExceptionsFilter} from '../src/http.js';
const admin=createPool(adminUrl),restricted=createPool();
const tenant=id(),foreign=id(),org=id(),foreignOrg=id(),p=id(),p2=id(),fp=id();
const director=id(),master=id(),worker=id(),pto=id(),outsider=id(),worker2=id(),foreignEmployee=id();
const users=[director,master,worker,pto,outsider,worker2],tokens=new Map<string,string>();
let app:INestApplication|undefined,base:string,employee:any,zone:any,workType:any,draft:any;
const command=(b:any)=>({requestId:id(),...b});
async function req(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST',legacy=false) {
  const r=await fetch(`${base}${legacy?'/api':'/api/v1'}${path}`,{method,headers:{authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':tenant,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json()};
}
async function ok(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST') {
  const r=await req(path,body,user,method);assert.equal(r.status,method==='POST'?201:200,JSON.stringify(r));return r.body;
}
const zonePath=`/projects/${p}/zones`,typePath=`/projects/${p}/work-types`,taskPath=`/projects/${p}/tasks`;
function plan(extra:any={}) {return {zoneId:zone.id,workTypeId:workType.id,title:'Concrete placement',workDate:'2027-01-15',plannedQuantity:'0012.340',assigneeEmployeeId:employee.id,responsibleUserId:master,plannedStart:'2027-01-15T09:00:00+03:00',plannedEnd:'2027-01-15T10:00:00+03:00',rdReference:'RD-24',...extra};}
async function effects(requestId:string) {
  return (await admin.query(`SELECT (SELECT count(*)::int FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2) receipts,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND details->>'requestId'=$2::text) audits`,[tenant,requestId])).rows[0];
}
test.before(async()=>{
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Task fixture','Europe/Moscow'),($2,'Foreign','UTC')`,[tenant,foreign]);
  for(const u of users)await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`,[u,`${u}@tasks.test`,hashPassword('tasks-password')]);
  for(const [u,role] of [[director,'director'],[master,'master'],[worker,'worker'],[worker2,'worker'],[pto,'pto']])await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,u,role]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`,[foreign,outsider]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own'),($3,$4,'own','Foreign')`,[tenant,org,foreign,foreignOrg]);
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) VALUES($1,$2,$3,'Foreign employee')`,[foreign,foreignEmployee,foreignOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'P1'),($1,$3,'P2'),($4,$5,'Foreign')`,[tenant,p,p2,foreign,fp]);
  app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());
  const server=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${server.address().port}`;
  for(const u of users){const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${u}@tasks.test`,password:'tasks-password'})});assert.equal(r.status,201);tokens.set(u,(await r.json()).token);}
  for(const u of [master,pto])await ok(`/projects/${p}/memberships/${u}`,command({expectedVersion:0,status:'active'}),director,'PUT');
  employee=await ok('/employees',command({fullName:'Task worker',organizationId:org,userId:worker}));
  const t=await ok(`/projects/${p}/admission-template`,command({code:'safe',title:'Admission',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]}));
  const ch=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p,templateVersion:t.version,answers:[{itemId:'safe',value:true}]}));
  await ok(`/projects/${p}/assignments/${employee.id}`,command({expectedVersion:0,status:'active',admissionCheckId:ch.id}),director,'PUT');
});
test.after(async()=>{
  try{await app?.close();}finally{const cleanup=await admin.connect();try{
    await cleanup.query('BEGIN');await cleanup.query('SET CONSTRAINTS ALL DEFERRED');
    for(const t of ['report_effects','client_events','work_reports','shifts','task_publication_snapshots','task_front_checks','front_template_versions','front_templates','daily_tasks','project_work_zones','project_work_types','crew_members','crews','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','project_memberships','employee_qualifications','people_command_receipts','employees','memberships','projects','organizations','audit_log']){
      if((await admin.query(`SELECT to_regclass($1) name`,[t])).rows[0].name)await cleanup.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
    }
    await cleanup.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);
    await cleanup.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await cleanup.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);
    await cleanup.query('COMMIT');
  }finally{await cleanup.query('ROLLBACK');cleanup.release();await Promise.all([admin.end(),restricted.end()]);}}
});
test('catalog receipt: director creates project catalogs with durable single effect',async()=>{
  const b=command({name:'  Zone A  '});
  const results=await Promise.all(Array.from({length:5},()=>req(zonePath,b)));
  results.forEach(r=>assert.equal(r.status,201,JSON.stringify(r)));results.forEach(r=>assert.deepEqual(r,results[0]));
  zone=results[0].body;assert.equal(zone.name,'Zone A');assert.equal(zone.projectId,p);assert.equal(zone.version,1);assert.equal(zone.status,'active');
  assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1});
  assert.equal((await req(zonePath,{...b,name:'Other'})).status,409);
  const people=command({fullName:'Namespace',organizationId:org});await ok('/employees',people);
  assert.equal((await req(zonePath,{requestId:people.requestId,name:'Cross operation'})).status,409);
  workType=await ok(typePath,command({name:'Concrete',unit:'m3',requiresRd:true,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
  assert.equal(workType.unit,'m3');
});
test('catalog scopes and strict replacement, tenant RLS and composite references',async()=>{
  for(const u of [master,pto])assert.equal((await ok(zonePath,undefined,u)).items[0].id,zone.id);
  assert.equal((await req(zonePath,undefined,worker)).status,403);
  for(const u of [master,worker,pto]){const b=command({name:'Denied'});assert.equal((await req(zonePath,b,u)).status,403);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});}
  assert.equal((await req(`/projects/${p2}/zones`,undefined,master)).status,404);
  assert.equal((await req(`/projects/${fp}/zones`)).status,404);
  for(const body of [command({name:'X',status:'active'}),command({name:''}),command({name:'X',extra:true})])assert.equal((await req(zonePath,body)).status,400);
  assert.equal((await req(typePath,command({name:'X',unit:'m',requiresRd:'true',requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}))).status,400);
  assert.equal((await req(`${zonePath}?unknown=x`)).status,400);
  assert.equal((await req(`${zonePath}?limit=101`)).status,400);
  zone=await ok(`${zonePath}/${zone.id}`,command({expectedVersion:1,name:'Zone renamed',status:'active'}),director,'PUT');assert.equal(zone.version,2);
  assert.equal((await req(`${zonePath}/${zone.id}`,command({expectedVersion:1,name:'Stale',status:'active'}),director,'PUT')).status,409);
  for(const t of ['project_work_zones','project_work_types'])assert.equal((await restricted.query(`SELECT * FROM ${t}`)).rowCount,0);
});
test('draft: assigned master creates and replaces an exact single employee plan; worker views hide preparation',async()=>{
  draft=await ok(taskPath,command(plan()),master);assert.equal(draft.workflowKind,'managed02b');assert.equal(draft.status,'draft');assert.equal(draft.unit,'m3');assert.equal(draft.plannedQuantity,'12.340');assert.equal(draft.planRevision,1);assert.equal(draft.version,1);
  assert.deepEqual(await ok(`${taskPath}/${draft.id}`,undefined,pto),draft);
  assert.equal((await ok(taskPath,undefined,worker)).total,0);assert.equal((await req(`${taskPath}/${draft.id}`,undefined,worker)).status,404);
  const overview=await ok(`/overview?projectId=${p}&day=2027-01-15`,undefined,worker);assert.equal(JSON.stringify(overview).includes(draft.id),false);assert.equal(overview.tasksForDay,0);assert.equal((await ok(`/overview?projectId=${p}&day=2027-01-15`)).tasksForDay,1);
  const desk=await req('/desk',undefined,worker,'GET',true);assert.equal(desk.status,200);assert.equal(JSON.stringify(desk.body).includes(draft.id),false);assert.equal(desk.body.summary.live.tasksToday,0);
  assert.equal((await req('/summary',undefined,worker,'GET',true)).body.live.tasksToday,0);
  draft=await ok(`${taskPath}/${draft.id}`,command({...plan({title:'Revised'}),expectedVersion:1}),master,'PUT');assert.equal(draft.version,2);assert.equal(draft.planRevision,2);
  assert.equal((await req(`${taskPath}/${draft.id}`,command({...plan(),expectedVersion:1}),master,'PUT')).status,409);
  assert.equal((await ok(`${taskPath}?status=draft`,undefined,pto)).total,1);
  assert.equal((await req(`${taskPath}?status=forged`)).status,400);
});
test('quantity interval: malformed plans and hidden references roll back every durable effect',async()=>{
  const otherZone=await ok(`/projects/${p2}/zones`,command({name:'Other'}));
  const invalid=[{plannedQuantity:12},{plannedQuantity:'1e2'},{plannedQuantity:'-1'},{plannedQuantity:'0.000'},{plannedQuantity:'100000000000'},{plannedQuantity:'0.0001'},{plannedQuantity:'NaN'},{plannedQuantity:'+1'},{workDate:'2027-02-30'},{workDate:undefined},{workDate:'0000-01-01'},{plannedStart:'2027-01-15T09:00:00'},{plannedStart:'2027-01-15T09:00:00.1234Z'},{plannedStart:'2027-01-15T25:00:00Z'},{plannedStart:'2027-02-30T09:00:00Z'},{plannedStart:'2027-01-15T09:00:00+24:00'},{plannedEnd:'2027-01-15T08:00:00+03:00'},{plannedEnd:'2027-01-16T00:00:00+03:00'},{status:'published'},{passed:true},{planRevision:3},{unit:'forged'}];
  for(const extra of invalid){const b=command(plan(extra));const r=await req(taskPath,b,master);assert.equal(r.status,400,JSON.stringify({extra,r}));assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});}
  for(const extra of [{zoneId:otherZone.id},{workTypeId:id()},{assigneeEmployeeId:id()},{assigneeEmployeeId:foreignEmployee},{responsibleUserId:outsider}]){const b=command(plan(extra));assert.equal((await req(taskPath,b,master)).status,404);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});}
  const rd=command(plan({rdReference:null}));assert.equal((await req(taskPath,rd,master)).status,422);assert.deepEqual(await effects(rd.requestId),{receipts:0,audits:0});
  for(const u of [pto,worker])assert.equal((await req(taskPath,command(plan()),u)).status,403);
  await admin.query(`UPDATE tenants SET timezone='Invalid/Zone' WHERE id=$1`,[tenant]);
  try{assert.equal((await req(taskPath,command(plan()),master)).status,422);}finally{await admin.query(`UPDATE tenants SET timezone='Europe/Moscow' WHERE id=$1`,[tenant]);}
  assert.equal((await admin.query(`SELECT count(*)::int n FROM daily_tasks WHERE tenant_id=$1`,[tenant])).rows[0].n,1);
});
test('draft receipt replay reauthorizes scope and ignores later catalog business invalidation',async()=>{
  const b=command(plan({title:'Replay plan'}));const first=await req(taskPath,b,master);assert.equal(first.status,201);
  const edited=await ok(`${zonePath}/${zone.id}`,command({expectedVersion:zone.version,name:'Archived',status:'archived'}),director,'PUT');
  assert.deepEqual(await req(taskPath,b,master),first);assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1});
  const denied=command(plan());assert.equal((await req(taskPath,denied,master)).status,422);assert.deepEqual(await effects(denied.requestId),{receipts:0,audits:0});
  await ok(`/projects/${p}/memberships/${master}`,command({expectedVersion:1,status:'revoked'}),director,'PUT');assert.equal((await req(taskPath,b,master)).status,404);
  await ok(`/projects/${p}/memberships/${master}`,command({expectedVersion:2,status:'active'}),director,'PUT');
  zone=await ok(`${zonePath}/${zone.id}`,command({expectedVersion:edited.version,name:'Restored',status:'active'}),director,'PUT');
  await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE daily_tasks SET workflow_kind='legacy' WHERE id=$1`,[draft.id])),(e:any)=>e.code==='23514');
  await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`DELETE FROM daily_tasks WHERE id=$1`,[draft.id])),(e:any)=>e.code==='42501');
});

async function waitBlocked(pid:number) {
  const end=Date.now()+5000;
  while(Date.now()<end){
    const r=await admin.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))`,[pid]);
    if(r.rows[0].n>0)return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(`No transaction waited for row gate ${pid}`);
}
test('draft interval race: actor revoked after Guard while waiting for employee cannot commit',async()=>{
  const c=await admin.connect();let pending:Promise<any>|undefined;
  const b=command(plan({title:'Must not commit after revoke'}));
  try{
    await c.query('BEGIN');
    await c.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);
    const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pending=req(taskPath,b,master);
    await waitBlocked(pid);
    await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);
    await c.query('COMMIT');
    assert.equal((await pending).status,403);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});
  }finally{
    await c.query('ROLLBACK');c.release();await pending;
    await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);
  }
});
test('draft receipt rollback: failure after task insert rolls back task, audit and reservation',async()=>{
  const b=command(plan({title:'Injected rollback'})),suffix=id().replaceAll('-','');
  const fn=`task_audit_fail_${suffix}`,tr=`task_audit_fail_${suffix}`;
  const before=(await admin.query(`SELECT count(*)::int n FROM daily_tasks WHERE tenant_id=$1`,[tenant])).rows[0].n;
  await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'requestId'='${b.requestId}' THEN RAISE EXCEPTION 'injected task command audit failure'; END IF; RETURN NEW; END $$`);
  try{
    await admin.query(`CREATE TRIGGER ${tr} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    assert.equal((await req(taskPath,b,master)).status,500);
    assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});
    assert.equal((await admin.query(`SELECT count(*)::int n FROM daily_tasks WHERE tenant_id=$1`,[tenant])).rows[0].n,before);
  }finally{await admin.query(`DROP TRIGGER IF EXISTS ${tr} ON audit_log`);await admin.query(`DROP FUNCTION ${fn}()`);}
  const successful=await req(taskPath,b,master);assert.equal(successful.status,201);assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1});
});
test('catalog migration repeat preserves ledger and data; SQL grants and composite plan constraints hold',async()=>{
  const actual=(await admin.query(`SELECT current_setting('port') port,current_setting('data_directory') dir`)).rows[0];assert.equal(actual.port,'54339');assert.ok(actual.dir.endsWith('codex-api/.data/pg-54339'));
  for(const t of ['project_work_zones','project_work_types']){
    assert.deepEqual((await admin.query(`SELECT relrowsecurity rls,relforcerowsecurity force FROM pg_class WHERE oid=$1::regclass`,[t])).rows[0],{rls:true,force:true});
    assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM ${t}`))).rowCount,0);
    assert.equal((await admin.query(`SELECT has_table_privilege('helios_app',$1,'DELETE') allowed`,[t])).rows[0].allowed,false);
  }
  const otherZone=(await ok(`/projects/${p2}/zones`)).items[0];
  await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE daily_tasks SET zone_id=$2 WHERE id=$1`,[draft.id,otherZone.id])),(e:any)=>e.code==='23503');
  await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE daily_tasks SET plan_revision=NULL WHERE id=$1`,[draft.id])),(e:any)=>e.code==='23514');
  const snapshot=async()=>({ledger:(await admin.query(`SELECT * FROM schema_migrations ORDER BY filename`)).rows,tasks:(await admin.query(`SELECT * FROM daily_tasks WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows,zones:(await admin.query(`SELECT * FROM project_work_zones WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows,receipts:(await admin.query(`SELECT * FROM people_command_receipts WHERE tenant_id=$1 ORDER BY request_id`,[tenant])).rows});
  const before=await snapshot();assert.ok(before.ledger.some(r=>r.filename==='005_task_preparation.sql'));
  execFileSync('corepack',['pnpm','db:migrate'],{cwd:new URL('../../../',import.meta.url),env:{...process.env,DATABASE_URL:'postgres://helios_app:helios_app@127.0.0.1:54339/helios',ADMIN_DATABASE_URL:'postgres://helios:helios@127.0.0.1:54339/helios',HELIOS_DB_PORT:'54339',API_PORT:'4327'},stdio:'pipe'});
  assert.deepEqual(await snapshot(),before);
});

test('draft views hide current-day preparation counts and controlled preexisting shifts/reports',async()=>{
  const today=(await admin.query(`SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS day`)).rows[0].day;
  const t=await ok(taskPath,command(plan({title:'Today private plan',workDate:today,plannedStart:`${today}T09:00:00+03:00`,plannedEnd:`${today}T10:00:00+03:00`})),master);
  const shift=id(),report=id();
  try{
    await admin.query(`INSERT INTO shifts(tenant_id,id,task_id,employee_id,status) VALUES($1,$2,$3,$4,'open')`,[tenant,shift,t.id,employee.id]);
    await admin.query(`INSERT INTO work_reports(tenant_id,id,task_id,submitted_quantity) VALUES($1,$2,$3,1)`,[tenant,report,t.id]);
    const desk=await req('/desk',undefined,worker,'GET',true);assert.equal(desk.status,200);
    for(const hidden of [t.id,shift,report,t.title])assert.equal(JSON.stringify(desk.body).includes(hidden),false);
    assert.equal(desk.body.summary.live.tasksToday,0);assert.equal(desk.body.summary.live.openShifts,0);
    const summary=await req('/summary',undefined,worker,'GET',true);assert.equal(summary.body.live.tasksToday,0);assert.equal(summary.body.live.openShifts,0);
    const overview=await ok(`/overview?projectId=${p}&day=${today}`,undefined,worker);assert.equal(overview.tasksForDay,0);assert.equal(overview.currentOpenShifts,0);assert.equal(overview.submittedReportsForDay,0);
    assert.equal((await ok(`/overview?projectId=${p}&day=${today}`)).tasksForDay,1);
  }finally{
    await admin.query(`DELETE FROM shifts WHERE tenant_id=$1 AND id=$2`,[tenant,shift]);await admin.query(`DELETE FROM work_reports WHERE tenant_id=$1 AND id=$2`,[tenant,report]);await admin.query(`DELETE FROM daily_tasks WHERE tenant_id=$1 AND id=$2`,[tenant,t.id]);
  }
});

test('front lifecycle: immutable complete attempts and director-only atomic publication',async()=>{
  const template=await ok(`/projects/${p}/front-template`,command({code:'front',title:'Front',items:[{id:'access',label:'Access ready',critical:true},{id:'tidy',label:'Tidy',critical:false}]}));
  assert.equal(template.version,1);
  const t=await ok(taskPath,command(plan({title:'Publish lifecycle'})),master);
  const check=await ok(`${taskPath}/${t.id}/front-checks`,command({expectedVersion:1,templateVersion:1,answers:[{itemId:'access',value:true},{itemId:'tidy',value:false}]}),master);
  assert.equal(check.passed,true);assert.deepEqual(check.warnings,['noncritical_failed:tidy']);assert.equal(check.planRevision,1);
  const submitted=await req(`${taskPath}/${t.id}/submit`,command({expectedVersion:2}),master);assert.equal(submitted.status,200);assert.equal(submitted.body.status,'pending_approval');
  assert.equal((await req(`${taskPath}/${t.id}/publish`,command({expectedVersion:3}),master)).status,403);
  const b=command({expectedVersion:3});const results=await Promise.all([req(`${taskPath}/${t.id}/publish`,b),req(`${taskPath}/${t.id}/publish`,b)]);
  for(const r of results)assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(results[0],results[1]);
  assert.equal(results[0].body.status,'published');assert.ok(results[0].body.publicationSnapshotId);assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1});
  const visible=await ok(`${taskPath}/${t.id}`,undefined,worker);assert.equal(visible.status,'published');
  assert.equal((await req(`${taskPath}/${t.id}`,command({...plan(),expectedVersion:4}),master,'PUT')).status,409);
});

async function state(t:any) {
  return (await admin.query(`SELECT version,status,publication_snapshot_id snapshot,(SELECT count(*)::int FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2) snapshots,(SELECT count(*)::int FROM task_front_checks WHERE tenant_id=$1 AND task_id=$2) checks,(SELECT count(*)::int FROM shifts WHERE tenant_id=$1 AND task_id=$2) shifts,(SELECT count(*)::int FROM work_reports WHERE tenant_id=$1 AND task_id=$2) reports,(SELECT count(*)::int FROM pgboss.job WHERE data->>'tenantId'=$1::text) jobs FROM daily_tasks WHERE tenant_id=$1 AND id=$2`,[tenant,t.id])).rows[0];
}
const pathOf=(t:any)=>`/projects/${t.projectId}/tasks/${t.id}`;
async function actionOk(t:any,action:string,user=director,extra:any={}) {
  const r=await req(`${pathOf(t)}/${action}`,command({expectedVersion:t.version,...extra}),user);assert.equal(r.status,200,JSON.stringify(r));return r.body;
}
async function freshTask(extra:any={},project=p) {
  let body=plan({workDate:'2027-01-16',plannedStart:'2027-01-16T09:00:00+03:00',plannedEnd:'2027-01-16T10:00:00+03:00',...extra});
  if(project!==p){const z=await ok(`/projects/${project}/zones`,command({name:'Second zone'})),w=await ok(`/projects/${project}/work-types`,command({name:'Second type',unit:'m3',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));body={...body,zoneId:z.id,workTypeId:w.id};}
  return ok(`/projects/${project}/tasks`,command(body));
}
async function passing(t:any) {
  const template=await ok(`/projects/${t.projectId}/front-template`);
  await ok(`${pathOf(t)}/front-checks`,command({expectedVersion:t.version,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:true}))}));
  return ok(pathOf(t));
}
async function pendingTask(extra:any={},project=p) {return actionOk(await passing(await freshTask(extra,project)),'submit');}
async function failedAction(t:any,action:string,status:number,user=director,extra:any={}) {
  const before=await state(t),b=command({expectedVersion:t.version,...extra});const r=await req(`${pathOf(t)}/${action}`,b,user);assert.equal(r.status,status,JSON.stringify(r));assert.deepEqual(await state(t),before);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});return r;
}
test('lifecycle reasons and roles: reject, withdraw, terminal cancellation and exact versions',async()=>{
  let t=await freshTask();
  for(const action of ['reject','reopen','cancel'])await failedAction(t,action,400,director);
  for(const u of [worker,pto])await failedAction(t,'submit',403,u);
  t=await actionOk(t,'submit',master);
  await failedAction(t,'reject',403,master,{reason:'Denied'});
  t=await actionOk(t,'reject',director,{reason:'Revise plan'});assert.equal(t.status,'draft');
  t=await actionOk(t,'submit',master);t=await actionOk(t,'reopen',master,{reason:'Withdraw'});assert.equal(t.status,'draft');
  t=await actionOk(t,'cancel',master,{reason:'No longer needed'});assert.equal(t.status,'cancelled');
  await failedAction(t,'submit',409);await failedAction(t,'cancel',409,director,{reason:'Again'});
});
test('front latest failed, stale plan/catalog/template and malformed answers fail closed without effects',async()=>{
  let t=await freshTask();const checkPath=`${pathOf(t)}/front-checks`,template=await ok(`/projects/${p}/front-template`);
  for(const answers of [[{itemId:'access',value:true}],[{itemId:'access',value:true},{itemId:'access',value:true}],[{itemId:'other',value:true},{itemId:'tidy',value:true}],[{itemId:'access',value:'true'},{itemId:'tidy',value:true}]]){
    const before=await state(t),b=command({expectedVersion:t.version,templateVersion:template.version,answers});assert.equal((await req(checkPath,b)).status,400);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});assert.deepEqual(await state(t),before);
  }
  for(const u of [worker,pto])assert.equal((await req(checkPath,command({expectedVersion:1,templateVersion:template.version,answers:[{itemId:'access',value:true},{itemId:'tidy',value:true}]}),u)).status,403);
  assert.equal((await req(checkPath,undefined,worker)).status,403);assert.equal((await req(`/projects/${fp}/front-template`)).status,404);
  t=await passing(t);t=await actionOk(t,'submit');
  const failed=await ok(checkPath,command({expectedVersion:t.version,templateVersion:template.version,answers:[{itemId:'access',value:false},{itemId:'tidy',value:true}]}),master);assert.equal(failed.passed,false);t=await ok(pathOf(t));
  assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes('front_failed'));await failedAction(t,'publish',422);
  assert.equal((await ok(checkPath,undefined,pto)).items[0].id,failed.id);assert.deepEqual(await ok(`${checkPath}/${failed.id}`),failed);
  t=await passing(t);t=await actionOk(t,'reopen',master,{reason:'Plan change'});
  t=await ok(pathOf(t),command({...plan({workDate:'2027-01-16',plannedStart:'2027-01-16T09:00:00+03:00',plannedEnd:'2027-01-16T10:00:00+03:00'}),expectedVersion:t.version}),master,'PUT');t=await actionOk(t,'submit');
  assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes('front_plan_changed'));await failedAction(t,'publish',422);
  t=await passing(t);zone=await ok(`${zonePath}/${zone.id}`,command({expectedVersion:zone.version,name:'Changed for readiness',status:'active'}),director,'PUT');
  assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes('front_catalog_changed'));await failedAction(t,'publish',422);t=await passing(t);
  const revised=await ok(`/projects/${p}/front-template`,command({expectedVersion:template.version,title:'Front v2',items:template.items}),director,'PUT');
  assert.equal((await req(checkPath,command({expectedVersion:t.version,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:true}))}))).status,409);
  assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes('front_template_changed'));await failedAction(t,'publish',409);
  assert.equal((await ok(`/projects/${p}/front-template/versions?limit=1`)).total,2);assert.equal(revised.version,2);
  t=await passing(t);t=await actionOk(t,'publish');await failedAction(t,'reopen',409,master,{reason:'Too late'});
  await failedAction(t,'cancel',409,master,{reason:'Denied'});t=await actionOk(t,'cancel',director,{reason:'Cancelled published plan'});assert.ok(t.publicationSnapshotId);
});
test('unsupported real dependencies cannot be certified by front yes answers; RD and catalog remain current',async()=>{
  let t=await pendingTask();const fields={name:workType.name,unit:workType.unit,requiresRd:true,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false,status:'active'};
  for(const [flag,code] of [['requiresMaterialControl','material_not_accepted'],['requiresPredecessorAcceptance','predecessor_acceptance_unsupported'],['requiresId','id_unsupported']]){
    workType=await ok(`${typePath}/${workType.id}`,command({...fields,[flag]:true,expectedVersion:workType.version}),director,'PUT');t=await passing(t);
    assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes(code));await failedAction(t,'publish',422);
  }
  workType=await ok(`${typePath}/${workType.id}`,command({...fields,requiresRd:false,expectedVersion:workType.version}),director,'PUT');
  let rd=await freshTask({rdReference:null});rd=await passing(rd);rd=await actionOk(rd,'submit');
  workType=await ok(`${typePath}/${workType.id}`,command({...fields,expectedVersion:workType.version}),director,'PUT');assert.ok((await ok(`${pathOf(rd)}/readiness`)).reasons.includes('rd_required'));await failedAction(rd,'publish',422);
  zone=await ok(`${zonePath}/${zone.id}`,command({name:zone.name,status:'archived',expectedVersion:zone.version}),director,'PUT');assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes('zone_inactive'));await failedAction(t,'publish',422);
  zone=await ok(`${zonePath}/${zone.id}`,command({name:zone.name,status:'active',expectedVersion:zone.version}),director,'PUT');
});
test('publication future workDate qualification expires inclusively and requires exact current admission evidence',async()=>{
  const q=await ok(`/employees/${employee.id}/qualifications`,command({code:'license',title:'License',validUntil:'2027-01-16',documentReference:'L1'}));
  const original=await ok(`/projects/${p}/admission-template`);
  const template=await ok(`/projects/${p}/admission-template`,command({expectedVersion:original.version,title:'With license',items:original.items,requiredQualificationCodes:['license']}),director,'PUT');
  const ch=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:true}))}));
  const assignment=(await ok(`/projects/${p}/assignments`)).items.find((a:any)=>a.employeeId===employee.id);
  await ok(`/projects/${p}/assignments/${employee.id}`,command({expectedVersion:assignment.version,status:'active',admissionCheckId:ch.id}),director,'PUT');
  let t=await pendingTask({workDate:'2027-01-17',plannedStart:'2027-01-17T09:00:00+03:00',plannedEnd:'2027-01-17T10:00:00+03:00'});
  const readiness=await ok(`${pathOf(t)}/readiness`);assert.ok(readiness.reasons.includes('qualification_expired_on_work_date:license'));assert.equal(readiness.reasons.some((r:string)=>r.startsWith('admission:')),false);await failedAction(t,'publish',422);
  let inclusive=await pendingTask({plannedStart:'2027-01-16T13:00:00+03:00',plannedEnd:'2027-01-16T14:00:00+03:00'});assert.equal((await ok(`${pathOf(inclusive)}/readiness`)).ready,true);
  inclusive=await actionOk(inclusive,'publish');const snapshot=(await admin.query(`SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,inclusive.id])).rows[0].snapshot;assert.equal(snapshot.admissionCheck.qualificationEvidence[0].id,q.id);assert.equal(snapshot.admissionCheck.qualificationEvidence[0].version,1);
  const changed=await ok(`/employees/${employee.id}/qualifications/${q.id}`,command({expectedVersion:q.version,title:'License renewed',validUntil:'2028-01-01',documentReference:'L2',status:'active'}),director,'PUT');assert.equal(changed.version,2);
  assert.ok((await ok(`${pathOf(t)}/readiness`)).reasons.includes('admission:qualification_changed:license'));await failedAction(t,'publish',422);
  assert.deepEqual((await admin.query(`SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,inclusive.id])).rows[0].snapshot,snapshot);
  const current=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:true}))}));
  const currentAssignment=(await ok(`/projects/${p}/assignments`)).items.find((a:any)=>a.employeeId===employee.id);
  await ok(`/projects/${p}/assignments/${employee.id}`,command({expectedVersion:currentAssignment.version,status:'active',admissionCheckId:current.id}),director,'PUT');
  t=await actionOk(t,'publish');assert.equal(t.status,'published');
});
test('publication post-write failure rolls back snapshot task receipt and audit; same request retries',async()=>{
  const t=await pendingTask({plannedStart:'2027-01-16T15:00:00+03:00',plannedEnd:'2027-01-16T16:00:00+03:00'}),before=await state(t),b=command({expectedVersion:t.version}),suffix=id().replaceAll('-',''),fn=`publish_fail_${suffix}`;
  await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'requestId'='${b.requestId}' THEN RAISE EXCEPTION 'injected after publication writes'; END IF; RETURN NEW; END $$`);
  try{
    await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    assert.equal((await req(`${pathOf(t)}/publish`,b)).status,500);assert.deepEqual(await state(t),before);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});
  }finally{await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_log`);await admin.query(`DROP FUNCTION ${fn}()`);}
  const r=await req(`${pathOf(t)}/publish`,b);assert.equal(r.status,200);assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1});
  await actionOk(r.body,'cancel',director,{reason:'Free interval'});
  await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);
  try{assert.deepEqual(await req(`${pathOf(t)}/publish`,b),r);}finally{await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);}
  await admin.query(`UPDATE memberships SET role='pto' WHERE tenant_id=$1 AND user_id=$2`,[tenant,director]);
  try{assert.equal((await req(`${pathOf(t)}/publish`,b)).status,403);}finally{await admin.query(`UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2`,[tenant,director]);}
});

async function gatedFailure(t:any,table:'projects'|'employees'|'memberships',key:string,mutate:(c:any)=>Promise<void>,restore:()=>Promise<void>,expected=422) {
  const gate=await admin.connect(),before=await state(t),b=command({expectedVersion:t.version});let pending:Promise<any>|undefined;
  try{
    await gate.query('BEGIN');await gate.query(`SELECT 1 FROM ${table} WHERE ${table==='memberships'?'user_id':'id'}=$1 ${table==='projects'?'':'AND tenant_id=$2'} FOR NO KEY UPDATE`,table==='projects'?[key]:[key,tenant]);
    const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pending=req(`${pathOf(t)}/publish`,b);await waitBlocked(pid);await mutate(gate);await gate.query('COMMIT');
    const r=await pending;assert.equal(r.status,expected,JSON.stringify(r));assert.deepEqual(await state(t),before);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});
  }finally{await gate.query('ROLLBACK');gate.release();await pending;await restore();}
}
test('publication races: current assignment, admission, employee archive/link, actor and responsible grants',async()=>{
  const t=await pendingTask({plannedStart:'2027-01-16T17:00:00+03:00',plannedEnd:'2027-01-16T18:00:00+03:00'});
  await gatedFailure(t,'projects',p,c=>c.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]),()=>admin.query(`UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee.id]).then(()=>{}));
  await gatedFailure(t,'projects',p,c=>c.query(`UPDATE admission_templates SET version=version+1 WHERE tenant_id=$1 AND project_id=$2`,[tenant,p]),()=>admin.query(`UPDATE admission_templates SET version=version-1 WHERE tenant_id=$1 AND project_id=$2`,[tenant,p]).then(()=>{}));
  const q=(await admin.query(`SELECT id FROM employee_qualifications WHERE tenant_id=$1 AND employee_id=$2 AND code='license'`,[tenant,employee.id])).rows[0];
  for(const change of ["status='revoked'","version=version+1"]){
    await gatedFailure(t,'employees',employee.id,c=>c.query(`UPDATE employee_qualifications SET ${change} WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]),()=>admin.query(`UPDATE employee_qualifications SET status='active'${change.includes('version')?',version=version-1':''} WHERE tenant_id=$1 AND id=$2`,[tenant,q.id]).then(()=>{}));
  }
  await gatedFailure(t,'employees',employee.id,c=>c.query(`UPDATE employees SET status='archived' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]),()=>admin.query(`UPDATE employees SET status='active' WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id]).then(()=>{}));
  await gatedFailure(t,'employees',employee.id,async c=>{await c.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,worker2]);await c.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker2]);},async()=>{await admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee.id,worker]);await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker2]);});
  for(const [table,key,sql,reset,expected] of [
    ['employees',employee.id,`UPDATE memberships SET role='pto' WHERE tenant_id=$1 AND user_id=$2`,`UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2`,403],
    ['memberships',director,`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,403],
    ['memberships',master,`UPDATE memberships SET role='worker' WHERE tenant_id=$1 AND user_id=$2`,`UPDATE memberships SET role='master' WHERE tenant_id=$1 AND user_id=$2`,422],
  ] as const){const user=key===employee.id?director:key;await gatedFailure(t,table,key,c=>c.query(sql,[tenant,user]),()=>admin.query(reset,[tenant,user]).then(()=>{}),expected);}
  await gatedFailure(t,'projects',p,c=>c.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]),()=>admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]).then(()=>{}));
  await gatedFailure(t,'memberships',worker,c=>c.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]),()=>admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]).then(()=>{}));
  await gatedFailure(t,'projects',p,c=>c.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,worker]),()=>admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,worker]).then(()=>{}));
  const published=await actionOk(t,'publish');await actionOk(published,'cancel',director,{reason:'Race fixture complete'});
});
test('publication two-tier wait rereads current member after employee wait and member snapshot',async()=>{
  const t=await pendingTask({plannedStart:'2027-01-16T17:00:00+03:00',plannedEnd:'2027-01-16T18:00:00+03:00'}),employeeGate=await admin.connect(),memberGate=await admin.connect(),b=command({expectedVersion:t.version}),before=await state(t);let pending:Promise<any>|undefined;
  try{
    await employeeGate.query('BEGIN');await employeeGate.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);
    const ep=(await employeeGate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pending=req(`${pathOf(t)}/publish`,b);await waitBlocked(ep);
    await memberGate.query('BEGIN');await memberGate.query(`SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR NO KEY UPDATE`,[tenant,worker]);const mp=(await memberGate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    await employeeGate.query('COMMIT');await waitBlocked(mp);await memberGate.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]);await memberGate.query('COMMIT');
    assert.equal((await pending).status,422);assert.deepEqual(await state(t),before);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});
  }finally{await employeeGate.query('ROLLBACK');await memberGate.query('ROLLBACK');employeeGate.release();memberGate.release();await pending;await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,worker]);}
});
async function waitBlockedCount(pid:number,count:number) {
  const end=Date.now()+5000;while(Date.now()<end){const r=await admin.query(`WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM waiting`,[pid]);if(r.rows[0].n>=count)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail(`Expected ${count} waiters at gate ${pid}`);
}
test('front/template and plan lifecycle serialize against publish in both valid orderings',async()=>{
  for(const mutation of ['template','check','reopen']){
    const t=await pendingTask({plannedStart:'2027-01-16T17:00:00+03:00',plannedEnd:'2027-01-16T18:00:00+03:00'}),gate=await admin.connect(),b=command({expectedVersion:t.version});let first:Promise<any>|undefined,second:Promise<any>|undefined;
    try{
      await gate.query('BEGIN');await gate.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,p]);const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
      const template=await ok(`/projects/${p}/front-template`);
      first=mutation==='template'?req(`/projects/${p}/front-template`,command({expectedVersion:template.version,title:'Concurrent template',items:template.items}),director,'PUT'):mutation==='check'?req(`${pathOf(t)}/front-checks`,command({expectedVersion:t.version,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:false}))})):req(`${pathOf(t)}/reopen`,command({expectedVersion:t.version,reason:'Concurrent withdrawal'}),master);
      await waitBlocked(pid);second=req(`${pathOf(t)}/publish`,b);await waitBlockedCount(pid,2);await gate.query('COMMIT');
      assert.equal((await first).status,mutation==='check'?201:200);const result=await second;assert.equal(result.status,409,JSON.stringify(result));assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});assert.equal((await state(t)).snapshots,0);
    }finally{await gate.query('ROLLBACK');gate.release();await first;await second;}
  }
  let t=await pendingTask({plannedStart:'2027-01-16T17:00:00+03:00',plannedEnd:'2027-01-16T18:00:00+03:00'});t=await actionOk(t,'publish');
  const template=await ok(`/projects/${p}/front-template`);const check=command({expectedVersion:t.version,templateVersion:template.version,answers:template.items.map((i:any)=>({itemId:i.id,value:true}))});assert.equal((await req(`${pathOf(t)}/front-checks`,check)).status,409);assert.deepEqual(await effects(check.requestId),{receipts:0,audits:0});
  const saved=(await admin.query(`SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,t.id])).rows[0].snapshot;
  await ok(`/projects/${p}/front-template`,command({expectedVersion:template.version,title:'After publish',items:template.items}),director,'PUT');assert.deepEqual((await admin.query(`SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,t.id])).rows[0].snapshot,saved);await actionOk(t,'cancel',director,{reason:'Release race interval'});
  let draft=await freshTask();const old=draft.version;draft=await actionOk(draft,'submit');const stale=command({...plan(),expectedVersion:old});assert.equal((await req(pathOf(draft),stale,master,'PUT')).status,409);assert.deepEqual(await effects(stale.requestId),{receipts:0,audits:0});
});
test('master project grant revoked after Guard denies pending submit and completed replay',async()=>{
  const t=await freshTask(),b=command({expectedVersion:t.version}),gate=await admin.connect();let pending:Promise<any>|undefined;
  try{
    await gate.query('BEGIN');await gate.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pending=req(`${pathOf(t)}/submit`,b,master);await waitBlocked(pid);await admin.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]);await gate.query('COMMIT');
    assert.equal((await pending).status,404);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});assert.equal((await state(t)).version,t.version);
  }finally{await gate.query('ROLLBACK');gate.release();await pending;await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]);}
  const first=await req(`${pathOf(t)}/submit`,b,master);assert.equal(first.status,200);
  const replayGate=await admin.connect();let replay:Promise<any>|undefined;
  try{
    await replayGate.query('BEGIN');await replayGate.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,p]);const pid=(await replayGate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    replay=req(`${pathOf(t)}/submit`,b,master);await waitBlocked(pid);await replayGate.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]);await replayGate.query('COMMIT');assert.equal((await replay).status,404);assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1});
  }finally{await replayGate.query('ROLLBACK');replayGate.release();await replay;await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]);}
  assert.deepEqual(await req(`${pathOf(t)}/submit`,b,master),first);
});
test('cross-project employee gate permits one overlapping publication and both adjacent intervals',async()=>{
  for(const u of [master,worker])await ok(`/projects/${p2}/memberships/${u}`,command({expectedVersion:0,status:'active'}),director,'PUT');
  const at=await ok(`/projects/${p2}/admission-template`,command({code:'safe',title:'Admission P2',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]}));const ch=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p2,templateVersion:at.version,answers:[{itemId:'safe',value:true}]}));await ok(`/projects/${p2}/assignments/${employee.id}`,command({expectedVersion:0,status:'active',admissionCheckId:ch.id}),director,'PUT');
  await ok(`/projects/${p2}/front-template`,command({code:'front',title:'Front P2',items:[{id:'safe',label:'Safe',critical:true}]}));
  const a=await pendingTask({plannedStart:'2027-01-16T19:00:00+03:00',plannedEnd:'2027-01-16T20:00:00+03:00'}),b=await pendingTask({plannedStart:'2027-01-16T19:30:00+03:00',plannedEnd:'2027-01-16T20:30:00+03:00'},p2),gate=await admin.connect();let calls:Promise<any>[]=[];
  try{
    await gate.query('BEGIN');await gate.query(`SELECT id FROM employees WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,employee.id]);const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    const requests=[command({expectedVersion:a.version}),command({expectedVersion:b.version})];calls=[req(`${pathOf(a)}/publish`,requests[0]),req(`${pathOf(b)}/publish`,requests[1])];await waitBlockedCount(pid,2);await gate.query('COMMIT');
    const results=await Promise.all(calls);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const loser=results.findIndex(r=>r.status===409);assert.equal(results[loser].body.error,'assignment_overlap');assert.deepEqual(await effects(requests[loser].requestId),{receipts:0,audits:0});assert.equal((await state(loser===0?a:b)).snapshots,0);await actionOk(results.find(r=>r.status===200).body,'cancel',director,{reason:'Release interval'});
  }finally{await gate.query('ROLLBACK');gate.release();await Promise.all(calls);}
  const left=await pendingTask({plannedStart:'2027-01-16T19:00:00+03:00',plannedEnd:'2027-01-16T20:00:00+03:00'}),right=await pendingTask({plannedStart:'2027-01-16T20:00:00+03:00',plannedEnd:'2027-01-16T21:00:00+03:00'},p2);
  const adjacent=await Promise.all([req(`${pathOf(left)}/publish`,command({expectedVersion:left.version})),req(`${pathOf(right)}/publish`,command({expectedVersion:right.version}))]);for(const r of adjacent)assert.equal(r.status,200,JSON.stringify(r));
});
test('immutable histories SQL privileges RLS and published plan protect old snapshots after edits',async()=>{
  for(const table of ['front_templates','front_template_versions','task_front_checks','task_publication_snapshots']){
    assert.deepEqual((await admin.query(`SELECT relrowsecurity rls,relforcerowsecurity force FROM pg_class WHERE oid=$1::regclass`,[table])).rows[0],{rls:true,force:true});assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM ${table}`))).rowCount,0);
    for(const verb of ['UPDATE','DELETE'])if(table!=='front_templates')await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`${verb==='UPDATE'?`UPDATE ${table} SET snapshot='{}'`:`DELETE FROM ${table}`} WHERE tenant_id=$1`,[tenant])),(e:any)=>e.code==='42501');
  }
  const t=(await admin.query(`SELECT id,project_id FROM daily_tasks WHERE tenant_id=$1 AND status='published' LIMIT 1`,[tenant])).rows[0];
  for(const assignment of ["title='Altered'","planned_quantity=42","plan_revision=plan_revision+1","publication_snapshot_id=NULL","status='draft'"]){await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE daily_tasks SET ${assignment} WHERE tenant_id=$1 AND id=$2`,[tenant,t.id])),(e:any)=>e.code==='23514');}
  const before=(await admin.query(`SELECT * FROM task_publication_snapshots WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows;
  zone=await ok(`${zonePath}/${zone.id}`,command({expectedVersion:zone.version,name:'Post-publication rename',status:'active'}),director,'PUT');assert.deepEqual((await admin.query(`SELECT * FROM task_publication_snapshots WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows,before);
  const ledger=(await admin.query(`SELECT * FROM schema_migrations ORDER BY filename`)).rows;assert.ok(ledger.some(r=>r.filename==='006_task_publication.sql'));
  execFileSync('corepack',['pnpm','db:migrate'],{cwd:new URL('../../../',import.meta.url),env:{...process.env,DATABASE_URL:'postgres://helios_app:helios_app@127.0.0.1:54339/helios',ADMIN_DATABASE_URL:'postgres://helios:helios@127.0.0.1:54339/helios',HELIOS_DB_PORT:'54339',API_PORT:'4327'},stdio:'pipe'});
  assert.deepEqual((await admin.query(`SELECT * FROM schema_migrations ORDER BY filename`)).rows,ledger);assert.deepEqual((await admin.query(`SELECT * FROM task_publication_snapshots WHERE tenant_id=$1 ORDER BY id`,[tenant])).rows,before);
});
test('draft plan replacement and submit serialize with expectedVersion, and published assignment edits wait',async()=>{
  const t=await freshTask(),gate=await admin.connect();let edit:Promise<any>|undefined,submit:Promise<any>|undefined;
  try{
    await gate.query('BEGIN');await gate.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,p]);const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    edit=req(pathOf(t),command({...plan({workDate:'2027-01-16',plannedStart:'2027-01-16T09:00:00+03:00',plannedEnd:'2027-01-16T10:00:00+03:00',title:'Concurrent replacement'}),expectedVersion:t.version}),master,'PUT');await waitBlocked(pid);
    const b=command({expectedVersion:t.version});submit=req(`${pathOf(t)}/submit`,b,master);await waitBlockedCount(pid,2);await gate.query('COMMIT');assert.equal((await edit).status,200);assert.equal((await submit).status,409);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});const final=await ok(pathOf(t));assert.equal(final.planRevision,2);assert.equal(final.status,'draft');
  }finally{await gate.query('ROLLBACK');gate.release();await edit;await submit;}
  // The opposite valid ordering: publisher already holds employee, a qualification writer must wait.
  const pending=await pendingTask({workDate:'2027-01-18',plannedStart:'2027-01-18T09:00:00+03:00',plannedEnd:'2027-01-18T10:00:00+03:00'}),mg=await admin.connect();let pub:Promise<any>|undefined,qualification:Promise<any>|undefined;
  const q=(await ok(`/employees/${employee.id}/qualifications`)).items.find((q:any)=>q.code==='license');
  try{
    await mg.query('BEGIN');await mg.query(`SELECT user_id FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR NO KEY UPDATE`,[tenant,director]);const pid=(await mg.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pub=req(`${pathOf(pending)}/publish`,command({expectedVersion:pending.version}));await waitBlocked(pid);
    const publisher=(await admin.query(`SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))`,[pid])).rows[0].pid;
    qualification=req(`/employees/${employee.id}/qualifications/${q.id}`,command({expectedVersion:q.version,title:q.title,validUntil:q.validUntil,documentReference:q.documentReference,status:'revoked'}),director,'PUT');await waitBlocked(publisher);await mg.query('COMMIT');const published=await pub;assert.equal(published.status,200);assert.equal((await qualification).status,200);
    const snapshot=(await admin.query(`SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,pending.id])).rows[0].snapshot;assert.equal(snapshot.admissionCheck.qualificationEvidence[0].version,q.version);assert.equal(snapshot.admissionCheck.qualificationEvidence[0].status,'active');
  }finally{await mg.query('ROLLBACK');mg.release();await pub;await qualification;await admin.query(`UPDATE employee_qualifications SET status='active',version=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,q.id,q.version]);}
});
test('legacy create is retired at HTTP and service boundaries',async()=>{
  for(const user of [director,master,pto,worker]){const before=(await admin.query(`SELECT count(*)::int n FROM daily_tasks WHERE tenant_id=$1`,[tenant])).rows[0].n;const r=await req('/tasks',{title:'Legacy bypass',employeeId:employee.id,plannedQuantity:'1',unit:'m',workDate:'2027-01-16'},user,'POST',true);assert.equal(r.status,410,JSON.stringify(r));assert.equal(r.body.error,'task_creation_retired');assert.equal((await admin.query(`SELECT count(*)::int n FROM daily_tasks WHERE tenant_id=$1`,[tenant])).rows[0].n,before);}
});
test('all managed states reject legacy execution before effects and before stored event replay',async()=>{
  const tasks=[await freshTask(),await pendingTask()];let published=await pendingTask({workDate:'2027-01-19',plannedStart:'2027-01-19T09:00:00+03:00',plannedEnd:'2027-01-19T10:00:00+03:00'});published=await actionOk(published,'publish');tasks.push(published,await actionOk(await freshTask(),'cancel',master,{reason:'Fence cancellation'}));
  const actor:Actor={tenantId:tenant,userId:director,role:'director',name:'Fixture',email:'fixture@tasks.test'},service=app!.get(WorkforceService);
  assert.throws(()=>service.createTask(actor,{}),(e:any)=>e.getStatus()===410);
  const totals=async()=>({rows:(await admin.query(`SELECT (SELECT count(*)::int FROM shifts WHERE tenant_id=$1) shifts,(SELECT count(*)::int FROM work_reports WHERE tenant_id=$1) reports,(SELECT count(*)::int FROM client_events WHERE tenant_id=$1) events,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1) audits,(SELECT count(*)::int FROM pgboss.job WHERE data->>'tenantId'=$1::text) jobs`,[tenant])).rows[0]});
  for(const t of tasks){
    const shift=id(),report=id(),oldEvent=id(),occurredAt=new Date().toISOString();
    await admin.query(`INSERT INTO shifts(tenant_id,id,task_id,employee_id,status,started_at,occurred_started_at) VALUES($1,$2,$3,$4,'open',now(),now())`,[tenant,shift,t.id,employee.id]);
    await admin.query(`INSERT INTO work_reports(tenant_id,id,task_id,submitted_quantity) VALUES($1,$2,$3,1)`,[tenant,report,t.id]);
    const replay={eventId:oldEvent,tenantId:tenant,userId:director,kind:'submit_volume',occurredAt,payload:{taskId:t.id,quantity:'1'}};
    const hash=createHash('sha256').update(stableEventBody({kind:replay.kind,occurredAt,payload:replay.payload})).digest('hex');await admin.query(`INSERT INTO client_events(tenant_id,user_id,event_id,payload_hash,result) VALUES($1,$2,$3,$4,$5)`,[tenant,director,oldEvent,hash,JSON.stringify({eventId:oldEvent,reportId:report})]);
    const before=await totals(),taskBefore=await state(t),shiftBefore=(await admin.query(`SELECT * FROM shifts WHERE id=$1`,[shift])).rows[0],reportBefore=(await admin.query(`SELECT * FROM work_reports WHERE id=$1`,[report])).rows[0];
    try{
      for(const kind of ['shift_start','shift_end','submit_volume'])for(const employeeId of [employee.id,id()]){const event={eventId:id(),tenantId:tenant,userId:director,kind,occurredAt,payload:{taskId:t.id,employeeId,quantity:'1'}};const r=await req('/sync/events',{events:[event]},director,'POST',true);assert.equal(r.status,409,JSON.stringify({state:t.status,r}));assert.equal(r.body.error,'workflow_not_supported');assert.deepEqual(await totals(),before);assert.deepEqual(await state(t),taskBefore);}
      const prior=await req('/sync/events',{events:[replay]},director,'POST',true);assert.equal(prior.status,409);assert.equal(prior.body.error,'workflow_not_supported');
      const accept=await req(`/reports/${report}/accept`,{acceptedQuantity:'1'},director,'POST',true);assert.equal(accept.status,409);assert.equal(accept.body.error,'workflow_not_supported');
      await assert.rejects(service.recordAndMaybeRollback(actor,'1',false,t.id),(e:any)=>e.getStatus()===409 && e.message==='workflow_not_supported');
      assert.deepEqual(await totals(),before);assert.deepEqual(await state(t),taskBefore);assert.deepEqual((await admin.query(`SELECT * FROM shifts WHERE id=$1`,[shift])).rows[0],shiftBefore);assert.deepEqual((await admin.query(`SELECT * FROM work_reports WHERE id=$1`,[report])).rows[0],reportBefore);
    }finally{await admin.query(`DELETE FROM client_events WHERE tenant_id=$1 AND event_id=$2`,[tenant,oldEvent]);await admin.query(`DELETE FROM shifts WHERE tenant_id=$1 AND id=$2`,[tenant,shift]);await admin.query(`DELETE FROM work_reports WHERE tenant_id=$1 AND id=$2`,[tenant,report]);}
  }
  for(const taskId of [id(),(await admin.query(`SELECT id FROM daily_tasks WHERE tenant_id<>$1 LIMIT 1`,[tenant])).rows[0]?.id].filter(Boolean)){
    const r=await req('/sync/events',{events:[{eventId:id(),tenantId:tenant,userId:director,kind:'submit_volume',occurredAt:new Date().toISOString(),payload:{taskId,quantity:'1'}}]},director,'POST',true);assert.equal(r.status,404);
  }
});
test('additive87-operation OpenAPI covers exact task forms responses immutable evidence and pagination',async()=>{
  const spec=await (await fetch(`${base}/api/v1/openapi.json`)).json();assert.equal(Object.values(spec.paths).reduce((n:number,v:any)=>n+Object.keys(v).length,0),123);
  for(const [method,path] of [['get','/api/v1/projects/{id}/tasks/{task}/route'],['get','/api/v1/responsibility-orders'],['post','/api/v1/responsibility-orders'],['get','/api/v1/responsibility-orders/applicability'],['get','/api/v1/responsibility-orders/{id}'],['post','/api/v1/responsibility-orders/{id}'],['post','/api/v1/responsibility-orders/{id}/revoke'],['post','/api/v1/staff-imports/checks'],['get','/api/v1/staff-imports'],['post','/api/v1/staff-imports'],['get','/api/v1/projects/{projectId}/tasks/{taskId}/checklist-runs'],['post','/api/v1/projects/{projectId}/tasks/{taskId}/checklist-runs'],['post','/api/v1/projects/{projectId}/tasks/{taskId}/checklist-files'],['get','/api/v1/projects/{projectId}/tasks/{taskId}/checklist-files/{fileId}'],['get','/api/v1/projects/{p}/time/primary-days/{day}'],['post','/api/v1/projects/{p}/time/primary-days/{day}/close'],['post','/api/v1/projects/{p}/time/primary-days/{day}/corrections'],['get','/api/v1/projects/{p}/time/consolidated/{day}'],['post','/api/v1/projects/{p}/time/consolidated/{day}/revisions']])assert.ok(spec.paths[path]?.[method],`${method} ${path}`);

  const inventory=[['get','/projects/{p}/zones'],['post','/projects/{p}/zones'],['put','/projects/{p}/zones/{catalog}'],['get','/projects/{p}/work-types'],['post','/projects/{p}/work-types'],['put','/projects/{p}/work-types/{catalog}'],['post','/projects/{id}/tasks'],['get','/projects/{id}/tasks/{task}'],['put','/projects/{id}/tasks/{task}'],['get','/projects/{p}/front-template'],['post','/projects/{p}/front-template'],['put','/projects/{p}/front-template'],['get','/projects/{p}/front-template/versions'],['get','/projects/{id}/tasks/{task}/front-checks'],['post','/projects/{id}/tasks/{task}/front-checks'],['get','/projects/{id}/tasks/{task}/front-checks/{check}'],['get','/projects/{id}/tasks/{task}/readiness'],...['submit','reject','reopen','cancel','publish'].map(a=>['post',`/projects/{id}/tasks/{task}/${a}`])];assert.equal(inventory.length,22);
  for(const [method,path] of inventory){const operation=spec.paths[`/api/v1${path}`]?.[method!];assert.ok(operation,`${method} ${path}`);for(const code of ['400','401','403','404',...(method==='get'?[]:['409','422'])])assert.ok(operation.responses[code]);if(method!=='get')assert.equal(operation.requestBody.required,true);}
  assert.equal(spec.paths['/api/tasks'].post.deprecated,true);assert.ok(spec.paths['/api/tasks'].post.responses['410']);
  function matches(value:any,schema:any,at:string):void {
    if(value===null && schema.nullable)return;
    if(schema.$ref)return matches(value,spec.components.schemas[schema.$ref.split('/').pop()],at);
    if(schema.enum)assert.ok(schema.enum.includes(value),`${at} enum`);
    if(schema.type==='object'){
      assert.ok(value && typeof value==='object' && !Array.isArray(value),at);for(const k of schema.required??[])assert.ok(k in value,`${at}.${k} required`);
      for(const [k,v] of Object.entries(value)){if(schema.additionalProperties===false)assert.ok(k in schema.properties,`${at}.${k} unexpected`);if(schema.properties[k])matches(v,schema.properties[k],`${at}.${k}`);}
    }else if(schema.type==='array'){assert.ok(Array.isArray(value),at);if(schema.minItems!==undefined)assert.ok(value.length>=schema.minItems,at);if(schema.maxItems!==undefined)assert.ok(value.length<=schema.maxItems,at);value.forEach((v:any,i:number)=>matches(v,schema.items,`${at}[${i}]`));}
    else if(schema.type==='integer'){assert.ok(Number.isSafeInteger(value),at);if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,at);if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,at);}
    else{assert.equal(typeof value,schema.type,at);if(schema.pattern)assert.match(value,new RegExp(schema.pattern),at);}
  }
  const fixture=await freshTask(),sample=command(plan());matches(sample,spec.components.schemas.CreateTaskInput,'CreateTaskInput');assert.equal(spec.components.schemas.CreateTaskInput.additionalProperties,false);assert.equal(spec.components.schemas.CreateFrontCheckInput.additionalProperties,false);assert.equal(spec.components.schemas.TaskReasonInput.additionalProperties,false);
  matches(fixture,spec.components.schemas.ManagedTask,'ManagedTask');
  for(const [path,schema] of [[`${zonePath}?limit=1&offset=0`,'ZoneList'],[`${typePath}?limit=1`,'WorkTypeList'],[`${taskPath}?limit=2`,'TaskList'],[`/projects/${p}/front-template`,'FrontTemplate'],[`/projects/${p}/front-template/versions?limit=1`,'FrontTemplateList']] as any[]){matches(await ok(path),spec.components.schemas[schema],schema);}
  const checkTask=await passing(fixture);matches(await ok(`${pathOf(checkTask)}/front-checks?limit=1`),spec.components.schemas.FrontCheckList,'FrontCheckList');matches(await ok(`${pathOf(checkTask)}/readiness`),spec.components.schemas.TaskReadiness,'TaskReadiness');
  const t=await pendingTask({workDate:'2027-01-20',plannedStart:'2027-01-20T09:00:00+03:00',plannedEnd:'2027-01-20T10:00:00+03:00'}),published=await actionOk(t,'publish');matches(published,spec.components.schemas.PublicationResult,'PublicationResult');
  const persisted=(await admin.query(`SELECT snapshot FROM task_publication_snapshots WHERE tenant_id=$1 AND task_id=$2`,[tenant,t.id])).rows[0].snapshot;matches(persisted,spec.components.schemas.TaskPublicationSnapshot,'TaskPublicationSnapshot');
  for(const query of ['?limit=101','?limit=0','?offset=-1','?unknown=x'])assert.equal((await req(`${pathOf(t)}/front-checks${query}`)).status,400);
  const operationIds=Object.values(spec.paths).flatMap((path:any)=>Object.values(path).map((o:any)=>o.operationId));assert.equal(new Set(operationIds).size,operationIds.length);
  // Every local schema/response reference resolves; neither existing operation inventory nor old schema assertions is removed.
  const scan=(value:any):void=>{if(value && typeof value==='object'){if(value.$ref?.startsWith('#/'))assert.ok(value.$ref.slice(2).split('/').reduce((v:any,k:string)=>v?.[k],spec),value.$ref);Object.values(value).forEach(scan);}};scan(spec);
});
