import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import test from 'node:test';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {createPool,adminUrl,withTenant} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {AllExceptionsFilter} from '../src/http.js';
const admin=createPool(adminUrl),restricted=createPool();
const tenant=id(),foreign=id(),org=id(),foreignOrg=id(),p=id(),p2=id(),fp=id();
const director=id(),master=id(),worker=id(),pto=id(),outsider=id(),worker2=id();
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
  try{await app?.close();}finally{try{
    for(const t of ['work_reports','shifts','task_publication_snapshots','task_front_checks','front_template_versions','front_templates','daily_tasks','project_work_zones','project_work_types','crew_members','crews','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','project_memberships','employee_qualifications','people_command_receipts','employees','memberships','projects','organizations','audit_log']){
      if((await admin.query(`SELECT to_regclass($1) name`,[t])).rows[0].name)await admin.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
    }
    await admin.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);
    await admin.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await admin.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);
  }finally{await Promise.all([admin.end(),restricted.end()]);}}
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
  const overview=await ok(`/overview?projectId=${p}&day=2027-01-15`,undefined,worker);assert.equal(JSON.stringify(overview).includes(draft.id),false);
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
  for(const extra of [{zoneId:otherZone.id},{workTypeId:id()},{assigneeEmployeeId:id()},{responsibleUserId:outsider}]){const b=command(plan(extra));assert.equal((await req(taskPath,b,master)).status,404);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0});}
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
