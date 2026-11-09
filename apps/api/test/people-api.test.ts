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
let app:INestApplication|undefined,base:string,employee:any,qualification:any;
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
  try{await app?.close();}finally{
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
