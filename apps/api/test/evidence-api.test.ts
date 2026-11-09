import assert from 'node:assert/strict';
import {randomUUID as id,createHash} from 'node:crypto';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {createPool,adminUrl} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {AllExceptionsFilter} from '../src/http.js';
const admin=createPool(adminUrl),tenant=id(),foreign=id(),org=id(),p=id(),p2=id(),foreignProject=id(),employee=id(),otherEmployee=id(),director=id(),worker=id(),master=id(),pto=id(),outsider=id(),shift=id(),eventRequest=id();
const users=[director,worker,master,pto,outsider],tokens=new Map<string,string>();
let app:INestApplication|undefined,base:string,root:string;
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const path=(file?:string)=>`/projects/${p}/evidence${file?`/${file}`:''}`;
function reservation(bytes=png,extra:any={}){return {requestId:id(),fileId:id(),employeeId:employee,filename:'доказательство.png',contentType:'image/png',sizeBytes:bytes.length,sha256:sha(bytes),...extra};}
function headers(user=worker,t=tenant){return {authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':t};}
async function req(url:string,body?:any,user=worker,method=body===undefined?'GET':'POST'){
 const r=await fetch(`${base}/api/v1${url}`,{method,headers:{...headers(user),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};
}
async function put(file:string,bytes=png,user=worker){const r=await fetch(`${base}/api/v1${path(file)}/content`,{method:'PUT',headers:{...headers(user),'content-type':'application/octet-stream'},body:bytes});return {status:r.status,body:await r.json()};}
async function reserve(b=reservation(),user=worker){const r=await req(path(),b,user);assert.equal(r.status,201,JSON.stringify(r));return b;}
test.before(async()=>{
 const actual=(await admin.query(`SELECT current_database() db,current_user usr,inet_server_port() port,current_setting('data_directory') dir`)).rows[0];assert.equal(actual.db,'helios');assert.equal(actual.usr,'helios');assert.equal(actual.port,54339);assert.ok(actual.dir.endsWith('codex-api/.data/pg-54339'));
 root=await mkdtemp(join(tmpdir(),'helios-evidence-'));process.env.HELIOS_EVIDENCE_ROOT=root;
 await admin.query(`INSERT INTO tenants(id,name) VALUES($1,'Evidence'),($2,'Foreign')`,[tenant,foreign]);
 for(const u of users)await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Evidence user',$3)`,[u,`${u}@evidence.test`,hashPassword('evidence-password')]);
 for(const [u,r] of [[director,'director'],[worker,'worker'],[master,'master'],[pto,'pto']])await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,u,r]);
 await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`,[foreign,outsider]);
 await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'P1'),($1,$3,'P2')`,[tenant,p,p2]);await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Foreign')`,[foreign,foreignProject]);
 await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own')`,[tenant,org]);
 await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,'Worker'),($1,$5,$3,NULL,'Other')`,[tenant,employee,org,worker,otherEmployee]);
 for(const u of [worker,master,pto])await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`,[tenant,p,u]);
 await admin.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id) VALUES($1,$2,$3)`,[tenant,p,employee]);
 await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id,version) VALUES($1,$2,1)`,[tenant,employee]);await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,'2026-11-01','2026-11-02')`,[tenant,p,employee,shift]);
 await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`,[tenant,worker,eventRequest]);
 await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,'shift_start',1,'2026-11-01',now(),'{}',repeat('a',64),'{}')`,[tenant,worker,eventRequest,employee,p,shift]);
 app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${server.address().port}`;
 for(const u of users){const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${u}@evidence.test`,password:'evidence-password'})});assert.equal(r.status,201);tokens.set(u,(await r.json()).token);}
});
test.after(async()=>{try{await app?.close();}finally{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET CONSTRAINTS ALL DEFERRED');for(const t of ['private_evidence_attachments','private_evidence_files','managed_execution_reports','managed_execution_events','managed_segments','managed_shifts','managed_execution_streams','daily_tasks','employee_project_assignments','project_memberships','people_command_receipts','employees','memberships','projects','organizations','audit_log'])if((await c.query(`SELECT to_regclass($1) name`,[t])).rows[0].name)await c.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await c.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();await admin.end();await rm(root,{recursive:true,force:true});delete process.env.HELIOS_EVIDENCE_ROOT;}}});
test('tracer: reserve raw binary upload download and immutable existing event attachment over HTTP and PG',async()=>{
 const b=await reserve();const uploaded=await put(b.fileId);assert.equal(uploaded.status,200,JSON.stringify(uploaded));assert.equal(uploaded.body.state,'ready');
 const r=await fetch(`${base}/api/v1${path(b.fileId)}/content`,{headers:headers()});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
 const attach={requestId:id(),target:{kind:'execution_event',actorUserId:worker,requestId:eventRequest}};const a=await req(`${path(b.fileId)}/attachment`,attach);assert.equal(a.status,201,JSON.stringify(a));assert.equal(a.body.attachment.target.requestId,eventRequest);assert.deepEqual(await req(`${path(b.fileId)}/attachment`,attach),a);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM private_evidence_attachments WHERE tenant_id=$1 AND file_id=$2`,[tenant,b.fileId])).rows[0].n,1);
});
