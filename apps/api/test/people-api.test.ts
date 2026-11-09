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
const tenant=id(),foreign=id(),org=id(),foreignOrg=id(),p1=id(),p2=id(),fp=id();
const director=id(),worker=id(),master=id(),pto=id(),outsider=id(),worker2=id();
const users=[director,worker,master,pto,outsider,worker2], tokens=new Map<string,string>();
const gates=new Set<()=>Promise<void>>();
let app:INestApplication|undefined,base:string,employee:any,qualification:any,template:any,passed:any,assignment:any,crew:any,crew2:any;
const items=[{id:'safe',label:'Safety briefing',critical:true},{id:'note',label:'Optional observation',critical:false}];
const answers=[{itemId:'safe',value:true},{itemId:'note',value:true}];
async function req(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST') {
  const r=await fetch(`${base}/api/v1${path}`,{method,headers:{authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':tenant,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json()};
}
async function ok(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST') {
  const r=await req(path,body,user,method);assert.equal(r.status,method==='POST'?201:200,JSON.stringify(r));return r.body;
}
const command=(fields:any)=>({requestId:id(),...fields});
test.before(async()=>{
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'People fixture','Pacific/Kiritimati'),($2,'Foreign','UTC')`,[tenant,foreign]);
  for(const u of users) await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Fixture',$3)`,[u,`${u}@people.test`,hashPassword('people-password')]);
  for(const [u,role] of [[director,'director'],[worker,'worker'],[worker2,'worker'],[master,'master'],[pto,'pto']]) await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,u,role]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`,[foreign,outsider]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own'),($3,$4,'own','Foreign')`,[tenant,org,foreign,foreignOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'P1'),($1,$3,'P2'),($4,$5,'Foreign')`,[tenant,p1,p2,foreign,fp]);
  app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());
  const server=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${server.address().port}`;
  for(const u of users) {
    const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${u}@people.test`,password:'people-password'})});assert.equal(r.status,201);tokens.set(u,(await r.json()).token);
  }
});
test.after(async()=>{
  try{for(const release of gates)await release();await app?.close();}finally{
    try{
      for(const t of ['crew_members','crews','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','project_memberships','employee_qualifications','people_command_receipts','employees','memberships','projects','organizations','audit_log']) {
        if((await admin.query(`SELECT to_regclass($1) AS name`,[t])).rows[0].name) await admin.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
      }
      await admin.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);
      await admin.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await admin.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);
    }finally{await Promise.all([admin.end(),restricted.end()]);}
  }
});
test('tracer: authenticated employee/qualification create, read and versioned edit with durable single-effect replay',async()=>{
  const b=command({fullName:'  People worker  ',organizationId:org,userId:worker});
  const results=await Promise.all(Array.from({length:8},()=>req('/employees',b)));
  results.forEach(r=>assert.equal(r.status,201,JSON.stringify(r)));results.forEach(r=>assert.deepEqual(r,results[0]));
  employee=results[0].body;assert.equal(employee.fullName,'People worker');assert.equal(employee.version,1);
  assert.deepEqual(await ok(`/employees/${employee.id}`,undefined,worker),employee);
  assert.equal('documentNumber' in employee,false);assert.equal('document_number' in employee,false);
  for(const [table,where] of [['employees','id=$2'],['audit_log',`details->>'requestId'=$2`],['people_command_receipts','request_id=$2']]) {
    const value=table==='employees'?employee.id:b.requestId;
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1 AND ${where}`,[tenant,value])).rows[0].n,1);
  }
  assert.equal((await req('/employees',{...b,fullName:'Changed'})).status,409);
  employee=await ok(`/employees/${employee.id}`,command({expectedVersion:1,fullName:'Edited',organizationId:org,phone:null,userId:worker,status:'active'}),director,'PUT');assert.equal(employee.version,2);
  assert.equal((await req(`/employees/${employee.id}`,command({expectedVersion:1,fullName:'Stale',organizationId:org,phone:null,userId:worker,status:'active'}),director,'PUT')).status,409);
  qualification=await ok(`/employees/${employee.id}/qualifications`,command({code:'safety',title:'Safety',documentReference:'metadata-only'}));
  assert.equal(qualification.version,1);assert.equal((await ok(`/employees/${employee.id}/qualifications`,undefined,worker)).items[0].id,qualification.id);
  qualification=await ok(`/employees/${employee.id}/qualifications/${qualification.id}`,command({expectedVersion:1,title:'Safety revised',documentReference:null,validUntil:null,status:'active'}),director,'PUT');assert.equal(qualification.version,2);
});
test('tracer: role/scope, strict inputs, rollback and terminal employee archive',async()=>{
  for(const u of [worker,master,pto]) assert.equal((await req('/employees',command({fullName:'Denied',organizationId:org}),u)).status,403);
  assert.equal((await req(`/employees/${employee.id}/qualifications`,undefined,master)).status,404);
  for(const extra of [{organizationId:foreignOrg},{userId:outsider}]) {
    const b=command({fullName:'Denied reference',organizationId:org,...extra});assert.equal((await req('/employees',b)).status,422);
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2`,[tenant,b.requestId])).rows[0].n,0);
  }
  for(const b of [null,[],{},command({fullName:'',organizationId:org}),command({fullName:'x',organizationId:org,role:'director'})]) assert.equal((await req('/employees',b)).status,400);
  assert.equal((await req(`/employees/${employee.id}/qualifications`,command({code:'bad',title:'Bad',validUntil:'2026-02-30'}))).status,400);
  const archived=await ok('/employees',command({fullName:'Archive',organizationId:org}));
  const edit=command({expectedVersion:1,fullName:'Archive',organizationId:org,phone:null,userId:null,status:'archived'});
  assert.equal((await ok(`/employees/${archived.id}`,edit,director,'PUT')).status,'archived');
  assert.equal((await req(`/employees/${archived.id}`,command({...edit,requestId:id(),expectedVersion:2,status:'active'}),director,'PUT')).status,422);
  assert.equal((await req(`/employees/${archived.id}/qualifications`,command({code:'x',title:'x'}))).status,422);
  assert.equal((await restricted.query(`SELECT * FROM employee_qualifications`)).rowCount,0);
  assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM people_command_receipts`))).rowCount,0);
});
test('complete people flow: immutable template/check, assignment grants worker project, crew and scoped histories',async()=>{
  template=await ok(`/projects/${p1}/admission-template`,command({code:'project-safety',title:'Admission',items,requiredQualificationCodes:['safety']}));
  passed=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers:[answers[0],{itemId:'note',value:false}]}));
  assert.equal(passed.passed,true);assert.deepEqual(passed.warnings,['noncritical_failed:note']);assert.equal(passed.qualificationEvidence[0].version,2);
  assert.equal((await ok('/projects',undefined,worker)).total,0);
  const b=command({expectedVersion:0,status:'active',admissionCheckId:passed.id});
  assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,b,director,'PUT');assert.equal(assignment.currentAdmission.eligible,true);
  assert.equal((await ok('/projects',undefined,worker)).items[0].id,p1);
  assert.equal((await ok(`/projects/${p1}/assignments`,undefined,worker)).items[0].currentAdmission.eligible,true);
  const membership=(await ok(`/projects/${p1}/memberships`)).items.find((m:any)=>m.userId===worker);assert.equal(membership.role,'worker');assert.equal(membership.version,1);
  assert.deepEqual(await ok(`/projects/${p1}/assignments/${employee.id}`,b,director,'PUT'),assignment);
  assert.equal((await req(`/projects/${p1}/memberships`,undefined,worker)).status,403);
  crew=await ok(`/projects/${p1}/crews`,command({name:'Crew A'}));crew2=await ok(`/projects/${p1}/crews`,command({name:'Crew B'}));
  const member=await ok(`/projects/${p1}/crews/${crew.id}/members/${employee.id}`,command({expectedVersion:0,status:'active'}),director,'PUT');assert.equal(member.currentAdmission.eligible,true);
  assert.equal((await ok(`/projects/${p1}/crews/${crew.id}`,undefined,worker)).members[0].employeeId,employee.id);
  assert.equal((await req(`/projects/${p2}/crews/${crew.id}`)).status,404);
  assert.deepEqual(await ok(`/employees/${employee.id}/admission-checks/${passed.id}`,undefined,worker),passed);
  assert.equal((await req(`/employees/${employee.id}/admission-checks/${passed.id}`,undefined,master)).status,404);
  await ok(`/projects/${p1}/memberships/${master}`,command({expectedVersion:0,status:'active'}),director,'PUT');
  await ok(`/projects/${p1}/memberships/${pto}`,command({expectedVersion:0,status:'active'}),director,'PUT');
  assert.equal((await ok(`/employees/${employee.id}/admission-checks`,undefined,master)).total,1);
  assert.equal((await req(`/employees/${employee.id}/admission-checks?projectId=${p2}`,undefined,pto)).status,404);
  for(const table of ['admission_templates','admission_template_versions','employee_admission_checks','crews','crew_members']){
    assert.equal((await restricted.query(`SELECT * FROM ${table}`)).rowCount,0);
    assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM ${table}`))).rowCount,0);
  }
  await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE employee_admission_checks SET snapshot='{}' WHERE id=$1`,[passed.id])),(e:any)=>e.code==='42501');
  await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE admission_template_versions SET snapshot='{}' WHERE project_id=$1`,[p1])),(e:any)=>e.code==='42501');
});
test('latest failed check defeats earlier pass; snapshots, replay and equal-time deterministic sequence survive',async()=>{
  const failed=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers:[{itemId:'safe',value:false},answers[1]]}));
  assert.equal(failed.passed,false);assert.ok(failed.reasons.includes('critical_failed:safe'));assert.equal(failed.sequence,passed.sequence+1);
  const current=(await ok(`/projects/${p1}/assignments`)).items[0].currentAdmission;assert.equal(current.eligible,false);assert.ok(current.reasons.includes('not_latest_check'));
  assert.equal((await req(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:1,status:'active',admissionCheckId:passed.id}),director,'PUT')).status,422);
  assert.equal((await req(`/projects/${p1}/crews/${crew2.id}/members/${employee.id}`,command({expectedVersion:0,status:'active'}),director,'PUT')).status,422);
  assert.deepEqual(await ok(`/employees/${employee.id}/admission-checks/${passed.id}`),passed);
  const b=command({projectId:p1,templateVersion:1,answers});
  const checks=await Promise.all([req(`/employees/${employee.id}/admission-checks`,b),req(`/employees/${employee.id}/admission-checks`,b)]);assert.deepEqual(checks[0],checks[1]);assert.equal(checks[0].status,201);passed=checks[0].body;
  // Snapshot timestamp does not determine latest: force equal timestamps as fixture data.
  await admin.query(`UPDATE employee_admission_checks SET snapshot=jsonb_set(snapshot,'{checkedAt}',to_jsonb('2026-01-01T00:00:00Z'::text)) WHERE tenant_id=$1`,[tenant]);
  assert.equal((await ok(`/employees/${employee.id}/admission-checks`)).items[0].id,passed.id);
  assert.deepEqual(await ok(`/employees/${employee.id}/admission-checks`,b),passed);
  assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:1,status:'active',admissionCheckId:passed.id}),director,'PUT');assert.equal(assignment.currentAdmission.eligible,true);
});
test('qualification exact versions, inclusive tenant expiry, revoke and renewal require fresh evidence',async()=>{
  const dates=(await admin.query(`SELECT to_char(now() AT TIME ZONE 'Pacific/Kiritimati','YYYY-MM-DD') AS today,to_char((now() AT TIME ZONE 'Pacific/Kiritimati')-interval '1 day','YYYY-MM-DD') AS yesterday`)).rows[0];
  qualification=await ok(`/employees/${employee.id}/qualifications/${qualification.id}`,command({expectedVersion:2,title:'Safety changed',documentReference:'renewal metadata',validUntil:dates.today,status:'active'}),director,'PUT');
  assert.equal((await ok(`/projects/${p1}/assignments`)).items[0].currentAdmission.eligible,false);
  const unrelated=await ok(`/employees/${employee.id}/qualifications`,command({code:'unrelated',title:'Other'}));
  passed=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers}));assert.equal(passed.civilDate,dates.today);assert.equal(passed.passed,true);
  assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:2,status:'active',admissionCheckId:passed.id}),director,'PUT');
  await ok(`/employees/${employee.id}/qualifications/${unrelated.id}`,command({expectedVersion:1,title:'Other changed',documentReference:null,validUntil:null,status:'active'}),director,'PUT');
  assert.equal((await ok(`/projects/${p1}/assignments`)).items[0].currentAdmission.eligible,true);
  qualification=await ok(`/employees/${employee.id}/qualifications/${qualification.id}`,command({expectedVersion:3,title:'Expired',documentReference:null,validUntil:dates.yesterday,status:'active'}),director,'PUT');
  const expired=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers}));assert.equal(expired.passed,false);assert.ok(expired.reasons.includes('qualification_expired:safety'));
  assert.equal((await req(`/employees/${employee.id}/qualifications`,command({code:'safety',title:'Duplicate active'}))).status,409);
  qualification=await ok(`/employees/${employee.id}/qualifications/${qualification.id}`,command({expectedVersion:4,title:'Revoked',documentReference:null,validUntil:null,status:'revoked'}),director,'PUT');
  const missing=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers}));assert.equal(missing.passed,false);assert.ok(missing.reasons.includes('qualification_missing:safety'));
  assert.equal((await req(`/employees/${employee.id}/qualifications/${qualification.id}`,command({expectedVersion:5,title:'Unrevoke',documentReference:null,validUntil:null,status:'active'}),director,'PUT')).status,422);
  const old=qualification.id;qualification=await ok(`/employees/${employee.id}/qualifications`,command({code:'safety',title:'Renewed'}));assert.notEqual(qualification.id,old);
  assert.equal((await ok(`/projects/${p1}/assignments`)).items[0].currentAdmission.eligible,false);
  passed=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers}));assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:3,status:'active',admissionCheckId:passed.id}),director,'PUT');
});
test('template update concurrency invalidates prior pass and serializes fresh checks/crew conflicts',async()=>{
  const edits=await Promise.all([1,2].map(n=>req(`/projects/${p1}/admission-template`,command({expectedVersion:1,title:`Admission ${n}`,items,requiredQualificationCodes:['safety']}),director,'PUT')));
  assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);template=edits.find(r=>r.status===200)!.body;assert.equal(template.version,2);
  assert.equal((await ok(`/projects/${p1}/assignments`)).items[0].currentAdmission.eligible,false);
  assert.equal((await req(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:1,answers}))).status,409);
  const history=await ok(`/projects/${p1}/admission-template/versions`);assert.equal(history.total,2);assert.equal(history.items[1].title,'Admission');
  passed=await ok(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:2,answers}));
  assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:4,status:'active',admissionCheckId:passed.id}),director,'PUT');
  await ok(`/projects/${p1}/crews/${crew.id}/members/${employee.id}`,command({expectedVersion:1,status:'revoked'}),director,'PUT');
  const bids=await Promise.all([crew,crew2].map(c=>req(`/projects/${p1}/crews/${c.id}/members/${employee.id}`,command({expectedVersion:c.id===crew.id?2:0,status:'active'}),director,'PUT')));
  assert.deepEqual(bids.map(r=>r.status).sort(),[200,409]);assert.equal(bids.find(r=>r.status===409)!.body.error,'crew_conflict');
  assert.equal((await admin.query(`SELECT count(*)::int n FROM crew_members WHERE tenant_id=$1 AND employee_id=$2 AND status='active'`,[tenant,employee.id])).rows[0].n,1);
});
test('assignment revoke cascades crew versions; archive is terminal, preserves histories and blocks activation',async()=>{
  const before=(await admin.query(`SELECT * FROM crew_members WHERE tenant_id=$1 AND employee_id=$2 AND status='active'`,[tenant,employee.id])).rows[0];
  assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:5,status:'revoked'}),director,'PUT');
  const after=(await admin.query(`SELECT * FROM crew_members WHERE tenant_id=$1 AND crew_id=$2 AND employee_id=$3`,[tenant,before.crew_id,employee.id])).rows[0];assert.equal(after.status,'revoked');assert.equal(after.version,before.version+1);
  assert.equal((await ok('/projects',undefined,worker)).total,0);
  assignment=await ok(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:6,status:'active',admissionCheckId:passed.id}),director,'PUT');
  const b=command({expectedVersion:employee.version,fullName:employee.fullName,organizationId:org,phone:null,userId:worker,status:'archived'});
  employee=await ok(`/employees/${employee.id}`,b,director,'PUT');assert.equal(employee.status,'archived');
  const state=(await ok(`/projects/${p1}/assignments`)).items[0];assert.equal(state.status,'revoked');assert.equal(state.version,8);assert.equal(state.currentAdmission.eligible,false);
  assert.equal((await req(`/projects/${p1}/assignments/${employee.id}`,command({expectedVersion:8,status:'active',admissionCheckId:passed.id}),director,'PUT')).status,422);
  assert.equal((await req(`/employees/${employee.id}/admission-checks`,command({projectId:p1,templateVersion:2,answers}))).status,422);
  assert.equal((await ok(`/employees/${employee.id}/admission-checks`)).total,8);
});
async function waitBlocked(pid:number,count=1) {
  const end=Date.now()+5000;
  while(Date.now()<end) {
    const n=(await admin.query(`WITH RECURSIVE blocked(pid) AS (SELECT $1::int UNION SELECT a.pid FROM pg_stat_activity a JOIN blocked b ON b.pid=ANY(pg_blocking_pids(a.pid))) SELECT (count(*)-1)::int n FROM blocked`,[pid])).rows[0].n;
    if(n>=count)return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.fail(`Expected ${count} blocked transactions behind gate ${pid}`);
}
async function gate(table:'employees'|'projects',entity:string) {
  const c=await admin.connect();await c.query('BEGIN');
  await c.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,entity]);
  const pid=(await c.query(`SELECT pg_backend_pid() AS pid`)).rows[0].pid;
  const release=async()=>{if(gates.delete(release)){await c.query('COMMIT');c.release();}};gates.add(release);return {pid,release};
}
test('real lock races: link-edit precedes assignment without stale user grant; explicit/implicit membership and archive serialize',async()=>{
  await ok(`/projects/${p2}/admission-template`,command({code:'simple',title:'Simple',items,requiredQualificationCodes:[]}));
  const e=await ok('/employees',command({fullName:'Link race',organizationId:org,userId:worker2}));
  const ch=await ok(`/employees/${e.id}/admission-checks`,command({projectId:p2,templateVersion:1,answers}));
  const g=await gate('employees',e.id);
  const edit=req(`/employees/${e.id}`,command({expectedVersion:1,fullName:e.fullName,organizationId:org,phone:null,userId:null,status:'active'}),director,'PUT');
  await waitBlocked(g.pid);
  const activate=req(`/projects/${p2}/assignments/${e.id}`,command({expectedVersion:0,status:'active',admissionCheckId:ch.id}),director,'PUT');
  await waitBlocked(g.pid,2);await g.release();
  const done=await Promise.all([edit,activate]);done.forEach(r=>assert.equal(r.status,200,JSON.stringify(r)));
  assert.equal((await admin.query(`SELECT count(*)::int n FROM project_memberships WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p2,worker2])).rows[0].n,0);
  // Explicit revocation commits first; implicit worker activation must observe and version it.
  const linked=await ok('/employees',command({fullName:'Grant race',organizationId:org,userId:worker2}));
  const check=await ok(`/employees/${linked.id}/admission-checks`,command({projectId:p2,templateVersion:1,answers}));
  const gp=await gate('projects',p2);
  const explicit=req(`/projects/${p2}/memberships/${worker2}`,command({expectedVersion:0,status:'revoked'}),director,'PUT');await waitBlocked(gp.pid);
  const implicit=req(`/projects/${p2}/assignments/${linked.id}`,command({expectedVersion:0,status:'active',admissionCheckId:check.id}),director,'PUT');await waitBlocked(gp.pid,2);await gp.release();
  const grants=await Promise.all([explicit,implicit]);grants.forEach(r=>assert.equal(r.status,200,JSON.stringify(r)));
  const pm=(await ok(`/projects/${p2}/memberships`)).items.find((m:any)=>m.userId===worker2);assert.equal(pm.version,2);assert.equal(pm.status,'active');
  const ga=await gate('employees',linked.id);
  const archive=req(`/employees/${linked.id}`,command({expectedVersion:1,fullName:linked.fullName,organizationId:org,phone:null,userId:worker2,status:'archived'}),director,'PUT');await waitBlocked(ga.pid);
  const activationBody=command({expectedVersion:1,status:'active',admissionCheckId:check.id});
  const activation=req(`/projects/${p2}/assignments/${linked.id}`,activationBody,director,'PUT');await waitBlocked(ga.pid,2);await ga.release();
  const result=await Promise.all([archive,activation]);assert.equal(result[0].status,200);assert.equal(result[1].status,409);
  const ar=(await ok(`/projects/${p2}/assignments`)).items.find((a:any)=>a.employeeId===linked.id);assert.equal(ar.status,'revoked');assert.equal(ar.currentAdmission.eligible,false);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2`,[tenant,activationBody.requestId])).rows[0].n,0);
});
test('real qualification/publication races reject stale activation and preserve all-or-nothing commands',async()=>{
  const e=await ok('/employees',command({fullName:'Evidence race',organizationId:org}));
  const q=await ok(`/employees/${e.id}/qualifications`,command({code:'safety',title:'Safety'}));
  const check=await ok(`/employees/${e.id}/admission-checks`,command({projectId:p1,templateVersion:2,answers}));
  const g=await gate('employees',e.id);
  const revoke=req(`/employees/${e.id}/qualifications/${q.id}`,command({expectedVersion:1,title:'Revoked',documentReference:null,validUntil:null,status:'revoked'}),director,'PUT');await waitBlocked(g.pid);
  const b=command({expectedVersion:0,status:'active',admissionCheckId:check.id});
  const activation=req(`/projects/${p1}/assignments/${e.id}`,b,director,'PUT');await waitBlocked(g.pid,2);await g.release();
  const results=await Promise.all([revoke,activation]);assert.deepEqual(results.map(r=>r.status),[200,422]);
  for(const [table,where] of [['people_command_receipts','request_id=$2'],['audit_log',`details->>'requestId'=$2`],['employee_project_assignments','employee_id=$2']]) {
    assert.equal((await admin.query(`SELECT count(*)::int n FROM ${table} WHERE tenant_id=$1 AND ${where}`,[tenant,table==='employee_project_assignments'?e.id:b.requestId])).rows[0].n,0);
  }
  const simple=await ok(`/employees/${e.id}/admission-checks`,command({projectId:p2,templateVersion:1,answers}));
  const gp=await gate('projects',p2);
  const publish=req(`/projects/${p2}/admission-template`,command({expectedVersion:1,title:'Published v2',items,requiredQualificationCodes:[]}),director,'PUT');await waitBlocked(gp.pid);
  const stale=req(`/projects/${p2}/assignments/${e.id}`,command({expectedVersion:0,status:'active',admissionCheckId:simple.id}),director,'PUT');await waitBlocked(gp.pid,2);await gp.release();
  assert.deepEqual((await Promise.all([publish,stale])).map(r=>r.status),[200,422]);
});
