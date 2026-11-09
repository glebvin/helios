import assert from 'node:assert/strict';
import {randomUUID as id,createHash} from 'node:crypto';
import test from 'node:test';
import {mkdtemp,rm,readdir,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {execFileSync} from 'node:child_process';
import {EvidenceStorage} from '../src/evidence-storage.js';
import {withTenant} from '../src/db.js';
import {timeSource} from '../src/time-source.js';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {createPool,adminUrl} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {AllExceptionsFilter} from '../src/http.js';
const restricted=createPool(),admin=createPool(adminUrl),tenant=id(),foreign=id(),org=id(),p=id(),p2=id(),foreignProject=id(),employee=id(),otherEmployee=id(),director=id(),worker=id(),master=id(),pto=id(),outsider=id(),shift=id(),eventRequest=id();
const users=[director,worker,master,pto,outsider],tokens=new Map<string,string>();
let app:INestApplication|undefined,base:string,root:string;
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex'),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const path=(file?:string)=>`/projects/${p}/evidence${file?`/${file}`:''}`;
function reservation(bytes:Buffer=png,extra:any={}){return {requestId:id(),fileId:id(),employeeId:employee,filename:'доказательство.png',contentType:'image/png',sizeBytes:bytes.length,sha256:sha(bytes),...extra};}
function headers(user:string=worker,t:string=tenant){return {authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':t};}
async function req(url:string,body?:any,user:string=worker,method=body===undefined?'GET':'POST'){
 const r=await fetch(`${base}/api/v1${url}`,{method,headers:{...headers(user),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};
}
async function put(file:string,bytes:Buffer=png,user:string=worker){const r=await fetch(`${base}/api/v1${path(file)}/content`,{method:'PUT',headers:{...headers(user),'content-type':'application/octet-stream'},body:Uint8Array.from(bytes)});return {status:r.status,body:await r.json()};}
async function reserve(b=reservation(),user:string=worker){const r=await req(path(),b,user);assert.equal(r.status,201,JSON.stringify(r));return b;}
test.before(async()=>{
 const actual=(await admin.query(`SELECT current_database() db,current_user usr,inet_server_port() port,current_setting('data_directory') dir`)).rows[0];assert.equal(actual.db,'helios');assert.equal(actual.usr,'helios');assert.equal(actual.port,54339);assert.ok(actual.dir.endsWith('codex-api/.data/pg-54339'));
 root=await mkdtemp(join(tmpdir(),'helios-evidence-'));process.env.HELIOS_EVIDENCE_ROOT=root;
 await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Time','UTC'),($2,'Foreign','UTC')`,[tenant,foreign]);
 for(const u of users)await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Evidence user',$3)`,[u,`${u}@evidence.test`,hashPassword('evidence-password')]);
 for(const [u,r] of [[director,'director'],[worker,'worker'],[master,'master'],[pto,'pto']])await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[tenant,u,r]);
 await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'director')`,[foreign,outsider]);
 await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'P1'),($1,$3,'P2')`,[tenant,p,p2]);await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Foreign')`,[foreign,foreignProject]);
 await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Own')`,[tenant,org]);
 await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name) VALUES($1,$2,$3,$4,'Worker'),($1,$5,$3,NULL,'Other')`,[tenant,employee,org,worker,otherEmployee]);
 for(const u of [worker,master,pto])await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`,[tenant,p,u]);
 await admin.query(`INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id) VALUES($1,$2,$3)`,[tenant,p,employee]);
 await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id,version) VALUES($1,$2,1)`,[tenant,employee]);await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,'2026-11-01T00:00:00Z','2026-11-02T00:00:00Z')`,[tenant,p,employee,shift]);
 await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`,[tenant,worker,eventRequest]);
 await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,'shift_start',1,'2026-11-01T00:00:00Z',now(),'{}',repeat('a',64),'{}')`,[tenant,worker,eventRequest,employee,p,shift]);
 await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`,[tenant,worker,closeRequest]);
 await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,'shift_end',2,'2026-11-02T00:00:00Z',now(),'{}',repeat('a',64),'{}')`,[tenant,worker,closeRequest,employee,p,shift]);
 app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${server.address().port}`;
 for(const u of users){const r=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${u}@evidence.test`,password:'evidence-password'})});assert.equal(r.status,201);tokens.set(u,(await r.json()).token);}
});
test.after(async()=>{try{await app?.close();}finally{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET CONSTRAINTS ALL DEFERRED');for(const t of ['time_approval_heads','time_approval_revisions','private_evidence_attachments','private_evidence_files','managed_execution_reports','managed_execution_events','managed_segments','managed_shifts','managed_execution_streams','task_publication_snapshots','task_front_checks','front_template_versions','front_templates','daily_tasks','project_work_zones','project_work_types','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','project_memberships','people_command_receipts','employees','memberships','projects','organizations','audit_log'])if((await c.query(`SELECT to_regclass($1) name`,[t])).rows[0].name)await c.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await c.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();await Promise.all([admin.end(),restricted.end()]);await rm(root,{recursive:true,force:true});delete process.env.HELIOS_EVIDENCE_ROOT;}}});

const closeRequest=id();
const timePath=(day='2026-11-01',emp=employee,project=p)=>`/projects/${project}/time/employees/${emp}/days/${day}`;
test('approval tracer: exact recorded source -> immutable director approval -> history',async()=>{
 await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at,ended_at) VALUES($1,$2,$3,$4,$5,'idle','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z')`,[tenant,p,employee,shift,id()]);
 const source=await req(timePath(),undefined,director);assert.equal(source.status,200,JSON.stringify(source));assert.equal(source.body.source.totals.presenceMs,'86400000');
 const b={requestId:id(),expectedApprovalVersion:0,sourceHash:source.body.sourceHash,reason:'Checked',acknowledgeSuspicious:true};const approved=await req(timePath()+'/approvals',b,director);assert.equal(approved.status,201,JSON.stringify(approved));assert.equal(approved.body.approvalVersion,1);assert.equal(approved.body.status,'current');
 assert.deepEqual(await req(timePath()+'/approvals',b,director),approved);
 const history=await req(timePath()+'/history',undefined,director);assert.equal(history.status,200);assert.equal(history.body.total,1);
});

async function source(day='2026-11-01',emp=employee,project=p,user=director){const r=await req(timePath(day,emp,project),undefined,user);assert.equal(r.status,200,JSON.stringify(r));return r.body;}
async function approval(day='2026-11-01',extra:any={},emp=employee,project=p,user=director){const s=await source(day,emp,project);return req(timePath(day,emp,project)+'/approvals',{requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'Review',acknowledgeSuspicious:true,...extra},user);}
async function effects(requestId:string){return (await admin.query(`SELECT (SELECT count(*)::int FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2) receipts,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND details->>'requestId'=$2::text) audits,(SELECT count(*)::int FROM time_approval_revisions WHERE tenant_id=$1 AND request_id=$2) revisions`,[tenant,requestId])).rows[0];}
const zeroTotals={presenceMs:'0',idleMs:'0',workMs:'0',breakMs:'0',downtimeMs:'0'};
async function lifecycle(start:string,transitions:{at:string;mode?:string;actor?:string;requestId?:string;flags?:any}[]=[],options:any={}){
 const emp=options.employee??employee,project=options.project??p,sh=id();
 await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[tenant,emp]);
 let version=Number((await admin.query(`SELECT coalesce(max(version),0)::text v FROM managed_execution_events WHERE tenant_id=$1 AND employee_id=$2`,[tenant,emp])).rows[0].v);
 const end=options.open?null:transitions.at(-1)?.at??start;
 await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6)`,[tenant,project,emp,sh,start,end]);
 const changes:{at:string;mode?:string;actor?:string;requestId?:string;flags?:any}[]=[{at:start,mode:'idle',actor:options.actor??worker,flags:options.flags??{}},...transitions];const segments:string[]=[],events:any[]=[];
 for(let n=0;n<changes.length;n++){
  const ch=changes[n],requestId=ch.requestId??id(),actor=ch.actor??worker,kind=n===0?'shift_start':n===changes.length-1&&!options.open?'shift_end':'segment_change';
  await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`,[tenant,actor,requestId]);
  const payload={mode:ch.mode??'idle'};
  await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),$10,repeat('a',64),$11)`,[tenant,actor,requestId,emp,project,sh,kind,++version,ch.at,JSON.stringify(payload),JSON.stringify(ch.flags??{})]);
  events.push({actor,requestId,version,at:ch.at});
  if(kind!=='shift_end'){
   const seg=id();segments.push(seg);await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tenant,project,emp,sh,seg,ch.mode??'idle',ch.at,changes[n+1]?.at??null]);
  }
 }
 await admin.query(`UPDATE managed_execution_streams SET version=$3 WHERE tenant_id=$1 AND employee_id=$2`,[tenant,emp,version]);return {shift:sh,segments,events};
}
test('manual correction preserves exact source, immutable revoke/reapprove chain and replay attribution',async()=>{
 const reported=await source(),totals={presenceMs:'1000',idleMs:'100',workMs:'200',breakMs:'300',downtimeMs:'400'};
 const b={requestId:id(),expectedApprovalVersion:reported.approvalVersion,sourceHash:reported.sourceHash,reason:'  Clock correction  ',confirmedTotals:totals};
 const corrected=await req(timePath()+'/approvals',b,director);assert.equal(corrected.status,201,JSON.stringify(corrected));assert.equal(corrected.body.latest.overridden,true);assert.equal(corrected.body.latest.reason,'Clock correction');assert.deepEqual(corrected.body.latest.confirmedTotals,totals);assert.deepEqual(corrected.body.source,reported.source);assert.equal(corrected.body.latest.confirmedTaskAllocation,null);
 const revoke={requestId:id(),expectedApprovalVersion:corrected.body.approvalVersion,reason:'Withdraw for review'};const revoked=await req(timePath()+'/revoke',revoke,director);assert.equal(revoked.status,201,JSON.stringify(revoked));assert.equal(revoked.body.status,'revoked');assert.equal(revoked.body.isCurrent,false);assert.deepEqual(revoked.body.latest.confirmedTotals,totals);assert.equal(revoked.body.latest.previousVersion,corrected.body.approvalVersion);
 assert.deepEqual(await req(timePath()+'/approvals',b,director),corrected);assert.deepEqual(await req(timePath()+'/revoke',revoke,director),revoked);
 assert.equal((await req(timePath()+'/revoke',{...revoke,requestId:id(),expectedApprovalVersion:revoked.body.approvalVersion},director)).status,409);
 const reapproved=await approval();assert.equal(reapproved.status,201);assert.equal(reapproved.body.latest.overridden,false);assert.deepEqual(reapproved.body.latest.confirmedTotals,reported.source.totals);
 const history=await req(timePath()+'/history?limit=2&offset=1',undefined,pto);assert.equal(history.status,200);assert.equal(history.body.total,4);assert.equal(history.body.items[0].version,3);assert.equal(history.body.items[1].version,2);
 assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1,revisions:1});
});
test('strict input and optimistic source/version checks reject without receipts or revision effects',async()=>{
 const s=await source(),body={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'checked'};
 const bad=[{requestId:'bad'},{expectedApprovalVersion:-1},{expectedApprovalVersion:1.5},{expectedApprovalVersion:Number.MAX_SAFE_INTEGER},{sourceHash:'A'.repeat(64)},{reason:'  '},{reason:'a'.repeat(501)},{tenantId:tenant},{acknowledgeSuspicious:'true'},{confirmedTotals:{}},{confirmedTotals:{...zeroTotals,idleMs:'01'}},{confirmedTotals:{...zeroTotals,idleMs:'1.0'}},{confirmedTotals:{...zeroTotals,idleMs:'1e3'}},{confirmedTotals:{...zeroTotals,idleMs:-1}},{confirmedTotals:{...zeroTotals,foo:'0'}}];
 for(const extra of bad){const b={...body,requestId:id(),...extra};assert.equal((await req(timePath()+'/approvals',b,director)).status,400,JSON.stringify(extra));if(b.requestId!=='bad')assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0,revisions:0});}
 for(const extra of [{expectedApprovalVersion:s.approvalVersion-1},{sourceHash:'0'.repeat(64)}]){const b={...body,requestId:id(),...extra};assert.equal((await req(timePath()+'/approvals',b,director)).status,409);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0,revisions:0});}
 for(const totals of [{...zeroTotals,presenceMs:'1'},{...zeroTotals,presenceMs:'86400001',idleMs:'86400001'},{...zeroTotals,presenceMs:'9'.repeat(40),idleMs:'9'.repeat(40)}])assert.equal((await approval(undefined,{confirmedTotals:totals})).status,422);
 for(const suffix of ['?unknown=x','?asOf=2026-11-01','/history?limit=101','/history?limit=1&limit=2'])assert.equal((await req(timePath()+suffix,undefined,director)).status,400);
 for(const d of ['2026-02-30','0000-01-01'])assert.equal((await req(timePath(d),undefined,director)).status,400);
 const collision=await approval();assert.equal(collision.status,201);const b={...body,requestId:collision.body.latest.requestId};assert.equal((await req(timePath()+'/revoke',b,director)).status,400);assert.equal((await req(timePath()+'/revoke',{requestId:b.requestId,expectedApprovalVersion:collision.body.approvalVersion,reason:'collision'},director)).status,409);
});
test('closed zero-duration records are approvable, no-source and open/future records remain distinct',async()=>{
 await lifecycle('2026-10-01T12:00:00Z',[{at:'2026-10-01T12:00:00Z'}]);const s=await source('2026-10-01');assert.equal(s.recorded,true);assert.deepEqual(s.source.totals,zeroTotals);assert.equal(s.source.zeroMarkers.length,1);assert.equal((await approval('2026-10-01')).status,201);
 const empty=await source('2026-10-02');assert.equal(empty.recorded,false);assert.equal((await approval('2026-10-02')).status,422);
 const open=await lifecycle('2026-10-03T12:00:00Z',[],{open:true});try{assert.equal((await source('2026-10-03')).source.hasOpenIntervals,true);assert.equal((await approval('2026-10-03')).status,422);}finally{await admin.query(`UPDATE managed_segments SET ended_at=started_at WHERE tenant_id=$1 AND shift_id=$2`,[tenant,open.shift]);await admin.query(`UPDATE managed_shifts SET ended_at=started_at WHERE tenant_id=$1 AND id=$2`,[tenant,open.shift]);}
 await lifecycle('2099-10-01T12:00:00Z',[{at:'2099-10-01T13:00:00Z'}]);const future=await source('2099-10-01');assert.equal(future.future,true);assert.equal((await approval('2099-10-01')).status,422);
});
test('equal timestamp lifecycle order, composite actor identity, carry-in flags and stable relevant hashes',async()=>{
 const same=id();const l=await lifecycle('2026-09-29T23:00:00Z',[{at:'2026-09-30T01:00:00Z',mode:'break',actor:worker,requestId:same,flags:{delayed:true,suspicious:true}},{at:'2026-09-30T01:00:00Z',mode:'idle',actor:master,requestId:same},{at:'2026-10-01T01:00:00Z'}],{flags:{geoTimeMismatch:true,suspicious:true}});
 const a=await source('2026-09-30');assert.equal(a.source.totals.presenceMs,'86400000');assert.equal(a.source.zeroMarkers.length,1);assert.ok(a.source.intervalEvents.some((ev:any)=>ev.requestId===same&&ev.actorUserId===master));assert.ok(a.source.intervalEvents.some((ev:any)=>ev.requestId===same&&ev.actorUserId===worker));assert.deepEqual(a.source.intervalEvents.map((ev:any)=>Number(ev.version)),l.events.map(ev=>ev.version));assert.equal(a.source.suspicious,true);
 assert.equal((await approval('2026-09-30',{acknowledgeSuspicious:false})).status,422);assert.equal((await approval('2026-09-30')).status,201);
 await new Promise(r=>setTimeout(r,15));assert.equal((await source('2026-09-30')).sourceHash,a.sourceHash);
 // An admin can expose relevant flag corrections, but report-only flags are irrelevant.
 await admin.query(`UPDATE managed_execution_events SET review_flags=review_flags||'{"abovePlannedQuantity":true}' WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,l.events[0].actor,l.events[0].requestId]);assert.equal((await source('2026-09-30')).sourceHash,a.sourceHash);
 await admin.query(`UPDATE managed_execution_events SET review_flags=review_flags||'{"delayed":true}' WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,l.events[0].actor,l.events[0].requestId]);const changed=await source('2026-09-30');assert.notEqual(changed.sourceHash,a.sourceHash);assert.equal(changed.status,'stale');
 // Out-of-day raw endpoints and clock do not affect clipped, attributed source.
 await admin.query(`UPDATE managed_segments SET ended_at='2026-10-01T02:00:00Z' WHERE tenant_id=$1 AND id=$2`,[tenant,l.segments.at(-1)]);await admin.query(`UPDATE managed_execution_events SET occurred_at='2026-10-01T02:00:00Z' WHERE tenant_id=$1 AND request_id=$2`,[tenant,l.events.at(-1)!.requestId]);assert.equal((await source('2026-09-30')).sourceHash,changed.sourceHash);
});
test('exact 23/25 hour civil bounds and one-millisecond over limit; shared 03a totals stay exact',async()=>{
 await admin.query(`UPDATE tenants SET timezone='America/New_York' WHERE id=$1`,[tenant]);
 try{for(const [d,start,end,ms]of [['2026-03-08','2026-03-08T05:00:00Z','2026-03-09T04:00:00Z','82800000'],['2026-11-01','2026-11-01T04:00:00Z','2026-11-02T05:00:00Z','90000000']]){
  await lifecycle(start,[{at:end}],{employee:otherEmployee});const s=await source(d,otherEmployee);assert.equal(s.source.totals.presenceMs,ms);assert.equal(s.dayLengthMs,ms);
  const exact={...zeroTotals,presenceMs:ms,idleMs:ms};assert.equal((await approval(d,{confirmedTotals:exact},otherEmployee)).status,201);assert.equal((await approval(d,{confirmedTotals:{...exact,presenceMs:String(BigInt(ms)+1n),idleMs:String(BigInt(ms)+1n)}},otherEmployee)).status,422);
  const previous=await req(`/projects/${p}/execution/employees/${otherEmployee}/day?day=${d}`,undefined,director);assert.equal(previous.status,200,JSON.stringify(previous));assert.equal(previous.body.presenceMs,ms);
 }}finally{await admin.query(`UPDATE tenants SET timezone='UTC' WHERE id=$1`,[tenant]);}
});
async function waiters(pid:number,count=1){const until=Date.now()+8000;while(Date.now()<until){const n=(await admin.query(`WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM waiting`,[pid])).rows[0].n;if(n>=count)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Expected PostgreSQL waiters');}
test('two optimistic directors serialize to one winner with one immutable revision and no loser effects',async()=>{
 const s=await source('2026-10-01'),a={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'review'},b={...a,requestId:id()};
 const result=await Promise.all([req(timePath('2026-10-01')+'/approvals',a,director),req(timePath('2026-10-01')+'/approvals',b,director)]);assert.deepEqual(result.map(r=>r.status).sort(),[201,409]);
 for(let i=0;i<2;i++)assert.deepEqual(await effects([a,b][i].requestId),result[i].status===201?{receipts:1,audits:1,revisions:1}:{receipts:0,audits:0,revisions:0});
});
test('historical granted managers and current own workers; all mutation/replay checks use current director',async()=>{
 const own=await source(),body={requestId:id(),expectedApprovalVersion:own.approvalVersion,sourceHash:own.sourceHash,reason:'review'};
 for(const u of [worker,master,pto]){assert.equal((await req(timePath(),undefined,u)).status,200);assert.equal((await req(timePath()+'/history',undefined,u)).status,200);assert.equal((await req(timePath()+'/approvals',body,u)).status,403);assert.equal((await req(timePath()+'/revoke',{requestId:id(),expectedApprovalVersion:own.approvalVersion,reason:'no'},u)).status,403);}
 assert.equal((await req(timePath('2026-11-01',otherEmployee))).status,404);assert.equal((await req(timePath('2026-11-01',employee,p2))).status,404);assert.equal((await req(timePath('2026-11-01',employee,foreignProject),undefined,director)).status,404);assert.equal((await req(timePath(),undefined,outsider)).status,403);
 const changes=[{table:'employees',where:`id='${employee}'`,set:`user_id=NULL`,reset:`user_id='${worker}'`},{table:'employees',where:`id='${employee}'`,set:`status='archived'`,reset:`status='active'`},{table:'employee_project_assignments',where:`employee_id='${employee}' AND project_id='${p}'`,set:`status='revoked'`,reset:`status='active'`},{table:'project_memberships',where:`user_id='${worker}' AND project_id='${p}'`,set:`status='revoked'`,reset:`status='active'`}];
 for(const change of changes){await admin.query(`UPDATE ${change.table} SET ${change.set} WHERE tenant_id=$1 AND ${change.where}`,[tenant]);try{for(const u of [master,pto,director])assert.equal((await req(timePath(),undefined,u)).status,200);assert.equal((await req(timePath())).status,404);assert.equal((await req(timePath()+'/history')).status,404);}finally{await admin.query(`UPDATE ${change.table} SET ${change.reset} WHERE tenant_id=$1 AND ${change.where}`,[tenant]);}}
 const approved=await req(timePath()+'/approvals',body,director);assert.equal(approved.status,201);
 await admin.query(`UPDATE memberships SET role='pto' WHERE tenant_id=$1 AND user_id=$2`,[tenant,director]);try{assert.equal((await req(timePath()+'/approvals',body,director)).status,404);}finally{await admin.query(`UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2`,[tenant,director]);}assert.deepEqual(await req(timePath()+'/approvals',body,director),approved);
});
test('actual PostgreSQL role/status/grant/link/archive/assignment gates reread initial, replay and history authority',async()=>{
 const s=await source('2026-10-01'),b={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'gate'};assert.equal((await req(timePath('2026-10-01')+'/approvals',b,director)).status,201);
 const changes=[
 {table:'memberships',where:`user_id='${director}'`,set:`role='master'`,reset:`role='director'`,user:director,status:404,command:true},
 {table:'memberships',where:`user_id='${director}'`,set:`status='revoked'`,reset:`status='active'`,user:director,status:403,command:true},
 {table:'project_memberships',where:`user_id='${master}' AND project_id='${p}'`,set:`status='revoked'`,reset:`status='active'`,user:master,status:404},
 {table:'employees',where:`id='${employee}'`,set:`user_id='${master}'`,reset:`user_id='${worker}'`,user:worker,status:404},
 {table:'employees',where:`id='${employee}'`,set:`status='archived'`,reset:`status='active'`,user:worker,status:404},
 {table:'employee_project_assignments',where:`employee_id='${employee}' AND project_id='${p}'`,set:`status='revoked'`,reset:`status='active'`,user:worker,status:404}
 ];
 for(const change of changes){for(const operation of change.command?['initial','replay','revoke','read','history']:['read','history']){
  const c=await admin.connect();let pending:Promise<any>|undefined;const command={...b,requestId:operation==='replay'?b.requestId:id(),expectedApprovalVersion:(await source('2026-10-01')).approvalVersion};
  try{await c.query('BEGIN');await c.query(`SELECT 1 FROM ${change.table} WHERE tenant_id=$1 AND ${change.where} FOR NO KEY UPDATE`,[tenant]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
   const url=timePath('2026-10-01')+(operation==='history'?'/history':operation==='read'?'':operation==='revoke'?'/revoke':'/approvals');const body=operation==='read'||operation==='history'?undefined:operation==='replay'?b:operation==='revoke'?{requestId:command.requestId,expectedApprovalVersion:command.expectedApprovalVersion,reason:'gate'}:command;
   pending=req(url,body,change.user);await waiters(pid);await c.query(`UPDATE ${change.table} SET ${change.set} WHERE tenant_id=$1 AND ${change.where}`,[tenant]);await c.query('COMMIT');assert.equal((await pending).status,change.status,change.table+' '+operation);
   if(operation==='initial'||operation==='revoke')assert.deepEqual(await effects(command.requestId),{receipts:0,audits:0,revisions:0});
  }finally{await c.query('ROLLBACK');c.release();await pending;await admin.query(`UPDATE ${change.table} SET ${change.reset} WHERE tenant_id=$1 AND ${change.where}`,[tenant]);}
 }}
});
test('post-revision audit failure rolls back revision/head/receipt together; exact retry commits once',async()=>{
 const s=await source('2026-10-01'),b={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'rollback'},fn=`time_fail_${id().replaceAll('-','')}`;
 const snapshot=async()=>({head:(await admin.query(`SELECT * FROM time_approval_heads WHERE tenant_id=$1 ORDER BY project_id,employee_id,day`,[tenant])).rows,revisions:(await admin.query(`SELECT * FROM time_approval_revisions WHERE tenant_id=$1 ORDER BY project_id,employee_id,day,version`,[tenant])).rows});const before=await snapshot();
 await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.details->>'requestId'='${b.requestId}' THEN RAISE EXCEPTION 'injected time audit failure'; END IF; RETURN NEW; END $$`);
 try{await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);assert.equal((await req(timePath('2026-10-01')+'/approvals',b,director)).status,500);assert.deepEqual(await snapshot(),before);assert.deepEqual(await effects(b.requestId),{receipts:0,audits:0,revisions:0});}finally{await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_log`);await admin.query(`DROP FUNCTION ${fn}()`);}
 const result=await req(timePath('2026-10-01')+'/approvals',b,director);assert.equal(result.status,201);assert.deepEqual(await req(timePath('2026-10-01')+'/approvals',b,director),result);assert.deepEqual(await effects(b.requestId),{receipts:1,audits:1,revisions:1});
});
test('migration009 FORCE RLS immutable revision grants and scoped head FK; repeat preserves exact ledger and rows',async()=>{
 const tables=['time_approval_heads','time_approval_revisions'];for(const t of tables){assert.deepEqual((await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass`,[t])).rows[0],{relrowsecurity:true,relforcerowsecurity:true});assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM ${t}`))).rows.length,0);await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`DELETE FROM ${t} WHERE tenant_id=$1`,[tenant])),(e:any)=>e.code==='42501');}
 await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE time_approval_revisions SET reason='tamper' WHERE tenant_id=$1`,[tenant])),(e:any)=>e.code==='42501');await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE time_approval_heads SET employee_id=$2 WHERE tenant_id=$1`,[tenant,otherEmployee])),(e:any)=>e.code==='42501');await assert.rejects(withTenant(restricted,tenant,director,c=>c.query(`UPDATE time_approval_heads SET version=9007199254740991 WHERE tenant_id=$1`,[tenant])),(e:any)=>e.code==='23503');
 const snapshot=async()=>({ledger:(await admin.query(`SELECT * FROM schema_migrations ORDER BY filename`)).rows,data:await Promise.all(tables.map(async t=>(await admin.query(`SELECT * FROM ${t} ORDER BY to_jsonb(${t})::text`)).rows))});const before=await snapshot();
 const env={...process.env,DATABASE_URL:'postgres://helios_app:helios_app@127.0.0.1:54339/helios',ADMIN_DATABASE_URL:'postgres://helios:helios@127.0.0.1:54339/helios',HELIOS_DB_PORT:'54339',API_PORT:'4327'};for(let n=0;n<2;n++)execFileSync('corepack',['pnpm','db:migrate'],{cwd:new URL('../../../',import.meta.url),env,stdio:'pipe'});assert.deepEqual(await snapshot(),before);
});
async function must(url:string,body:any,method='POST'){const r=await req(url,body,director,method);assert.ok([200,201].includes(r.status),JSON.stringify(r));return r.body;}
async function streamVersion(){return Number((await admin.query(`SELECT version FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2`,[tenant,otherEmployee])).rows[0].version);}
async function interval(kind:string,sh:string,at:string,extra:any={}){return {kind,requestId:id(),employeeId:otherEmployee,projectId:p,shiftId:sh,expectedVersion:await streamVersion(),occurredAt:at,onBehalfReason:'Historical time review',...extra};}
async function ingest(event:any){const r=await req('/execution/events',{events:[event]},director);assert.equal(r.status,200);return r.body.results[0];}
async function accept(event:any){const r=await ingest(event);assert.equal(r.outcome,'success',JSON.stringify(r));return r;}
test('valid late03a events remain accepted: relevant source stales while later day, other project and final volume do not',async()=>{
 await admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,otherEmployee,master]);
 const template=await must(`/projects/${p}/admission-template`,{requestId:id(),code:'time',title:'Safe',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]});
 const check=await must(`/employees/${otherEmployee}/admission-checks`,{requestId:id(),projectId:p,templateVersion:template.version,answers:[{itemId:'safe',value:true}]});
 await must(`/projects/${p}/assignments/${otherEmployee}`,{requestId:id(),expectedVersion:0,status:'active',admissionCheckId:check.id},'PUT');
 const zone=await must(`/projects/${p}/zones`,{requestId:id(),name:'Time zone'}),type=await must(`/projects/${p}/work-types`,{requestId:id(),name:'Work',unit:'m3',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false});
 const front=await must(`/projects/${p}/front-template`,{requestId:id(),code:'ready',title:'Ready',items:[{id:'safe',label:'Ready',critical:true}]});
 let task=await must(`/projects/${p}/tasks`,{requestId:id(),zoneId:zone.id,workTypeId:type.id,title:'Recorded work',workDate:'2026-11-04',plannedQuantity:'1',assigneeEmployeeId:otherEmployee,responsibleUserId:master,plannedStart:'2026-11-04T09:00:00Z',plannedEnd:'2026-11-04T10:00:00Z',rdReference:null});
 await must(`/projects/${p}/tasks/${task.id}/front-checks`,{requestId:id(),expectedVersion:task.version,templateVersion:front.version,answers:[{itemId:'safe',value:true}]});task=(await req(`/projects/${p}/tasks/${task.id}`,undefined,director)).body;
 const readiness=await req(`/projects/${p}/tasks/${task.id}/readiness`,undefined,director);assert.equal(readiness.body.ready,true,JSON.stringify(readiness));
 for(const action of ['submit','publish'])task=await must(`/projects/${p}/tasks/${task.id}/${action}`,{requestId:id(),expectedVersion:task.version});
 const sh=id();await accept(await interval('shift_start',sh,'2026-11-04T09:00:00Z'));await accept(await interval('segment_change',sh,'2026-11-04T09:00:00Z',{mode:'work',taskId:task.id.toUpperCase()}));await accept(await interval('shift_end',sh,'2026-11-04T10:00:00Z'));
 const s=await source('2026-11-04',otherEmployee);assert.equal(s.source.totals.workMs,'3600000');assert.equal(s.source.suspicious,true);assert.equal((await approval('2026-11-04',{},otherEmployee)).status,201);
 const report=await accept(await interval('submit_volume',sh,'2026-11-05T10:00:00Z',{taskId:task.id,reportId:id(),submittedQuantity:'2'}));assert.equal(report.result.reviewFlags.abovePlannedQuantity,true);assert.equal((await source('2026-11-04',otherEmployee)).sourceHash,s.sourceHash);assert.equal((await source('2026-11-04',otherEmployee)).status,'current');
 const late=id();await accept(await interval('shift_start',late,'2026-11-04T11:00:00Z'));await accept(await interval('shift_end',late,'2026-11-04T12:00:00Z'));const changed=await source('2026-11-04',otherEmployee);assert.notEqual(changed.sourceHash,s.sourceHash);assert.equal(changed.status,'stale');assert.equal(changed.latest.sourceHash,s.sourceHash);assert.equal(changed.latest.sourceTotals.presenceMs,'3600000');assert.equal(changed.source.totals.presenceMs,'7200000');
 assert.equal((await approval('2026-11-04',{},otherEmployee)).status,201);const newHash=(await source('2026-11-04',otherEmployee)).sourceHash;
 const tomorrow=id();await accept(await interval('shift_start',tomorrow,'2026-11-05T09:00:00Z'));await accept(await interval('shift_end',tomorrow,'2026-11-05T10:00:00Z'));await lifecycle('2026-11-04T13:00:00Z',[{at:'2026-11-04T14:00:00Z'}],{project:p2,employee:otherEmployee,actor:director});
 const unchanged=await source('2026-11-04',otherEmployee);assert.equal(unchanged.sourceHash,newHash);assert.equal(unchanged.status,'current');
});
test('actual source-event and approval PG waits serialize in both arrival orders, with fresh hashes and no deadlock',async()=>{
 const day='2026-11-06',first=id();await accept(await interval('shift_start',first,day+'T09:00:00Z'));await accept(await interval('shift_end',first,day+'T10:00:00Z'));
 for(const eventFirst of [true,false]){
  const s=await source(day,otherEmployee),body={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'Race review',acknowledgeSuspicious:true},sh=id(),ev=await interval('shift_start',sh,day+(eventFirst?'T11:00:00Z':'T13:00:00Z'));
  const c=await admin.connect();let ep:Promise<any>|undefined,ap:Promise<any>|undefined;
  try{await c.query('BEGIN');await c.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,p]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
   if(eventFirst){ep=ingest(ev);await waiters(pid);ap=req(timePath(day,otherEmployee)+'/approvals',body,director);}else{ap=req(timePath(day,otherEmployee)+'/approvals',body,director);await waiters(pid);ep=ingest(ev);}await waiters(pid,2);await c.query('COMMIT');
   assert.equal((await ep).outcome,'success');const ar=await ap;assert.equal(ar.status,eventFirst?409:201,JSON.stringify(ar));if(eventFirst){assert.equal(ar.body.error,'stale_source');assert.deepEqual(await effects(body.requestId),{receipts:0,audits:0,revisions:0});}else{assert.equal((await source(day,otherEmployee)).status,'stale');assert.equal(ar.body.status,'current');assert.equal(ar.body.latest.sourceHash,s.sourceHash);}
  }finally{await c.query('ROLLBACK');c.release();await Promise.all([ep,ap]);}
  await accept(await interval('shift_end',sh,day+(eventFirst?'T12:00:00Z':'T14:00:00Z')));
 }
});
test('director revocation arriving after approval scope locks waits, then original approved attribution survives; replay denies current role',async()=>{
 const day='2026-10-01',s=await source(day),body={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'Authorised before revocation'},gate=await admin.connect(),change=await admin.connect();let pending:Promise<any>|undefined,mutation:Promise<any>|undefined;
 try{
  await gate.query('BEGIN');await gate.query(`SELECT 1 FROM time_approval_heads WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND day=$4 FOR NO KEY UPDATE`,[tenant,p,employee,day]);const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
  pending=req(timePath(day)+'/approvals',body,director);await waiters(pid);
  // Approval has already locked and checked the current membership before waiting on its head.
  mutation=change.query(`UPDATE memberships SET role='pto' WHERE tenant_id=$1 AND user_id=$2`,[tenant,director]);await waiters(pid,2);await gate.query('COMMIT');const result=await pending;assert.equal(result.status,201,JSON.stringify(result));await mutation;assert.equal(result.body.latest.actorUserId,director);assert.equal(result.body.status,'current');assert.equal((await req(timePath(day)+'/approvals',body,director)).status,404);
 }finally{await gate.query('ROLLBACK');gate.release();await pending;await mutation;change.release();await admin.query(`UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id=$2`,[tenant,director]);}
 assert.deepEqual(await effects(body.requestId),{receipts:1,audits:1,revisions:1});
});
test('employee archive/link waits behind approval; assignment revocation preserves historical manager snapshots',async()=>{
 const day='2026-10-01',changes=[{table:'employees',where:`id='${employee}'`,set:`status='archived',user_id=NULL`,reset:`status='active',user_id='${worker}'`},{table:'employee_project_assignments',where:`employee_id='${employee}' AND project_id='${p}'`,set:`status='revoked'`,reset:`status='active'`}];
 for(const change of changes){const s=await source(day),body={requestId:id(),expectedApprovalVersion:s.approvalVersion,sourceHash:s.sourceHash,reason:'Historical approval'},gate=await admin.connect(),other=await admin.connect();let pending:Promise<any>|undefined,mutation:Promise<any>|undefined;
  try{await gate.query('BEGIN');await gate.query(`SELECT 1 FROM time_approval_heads WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3 AND day=$4 FOR NO KEY UPDATE`,[tenant,p,employee,day]);const pid=(await gate.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
   pending=req(timePath(day)+'/approvals',body,director);await waiters(pid);mutation=other.query(`UPDATE ${change.table} SET ${change.set} WHERE tenant_id=$1 AND ${change.where}`,[tenant]);
   if(change.table==='employees')await waiters(pid,2); // Employee is locked by all manager approvals; assignment is only required for workers.
   await gate.query('COMMIT');const r=await pending;assert.equal(r.status,201,JSON.stringify(r));await mutation;
   for(const u of [director,master,pto])assert.equal((await req(timePath(day)+'/history',undefined,u)).status,200);assert.equal((await req(timePath(day)+'/history')).status,404);
   assert.equal((await approval(day,{},employee)).status,201);
  }finally{await gate.query('ROLLBACK');gate.release();await pending;await mutation;other.release();await admin.query(`UPDATE ${change.table} SET ${change.reset} WHERE tenant_id=$1 AND ${change.where}`,[tenant]);}
 }
});

test('one captured clock records a just-opened zero interval and half-open midnight markers exactly',async()=>{
 const at='2026-11-07T00:00:00.000Z',l=await lifecycle(at,[],{open:true,employee:otherEmployee,actor:director});
 const result=await withTenant(restricted,tenant,director,c=>timeSource(c,{tenantId:tenant,userId:director,role:'director',name:'Director',email:'test@time.test'},p,otherEmployee,'2026-11-07',{day:'2026-11-07',timezone:'UTC',asOf:at,source:'server_as_of',provisional:true}));
 assert.equal(result.recorded,true);assert.equal(result.source.hasOpenIntervals,true);assert.deepEqual(result.source.totals,zeroTotals);assert.equal(result.source.zeroMarkers.length,1);assert.equal(result.source.segments[0].clippedStart,at);assert.equal(result.source.segments[0].clippedEnd,at);
 // Complete through03a instead of fabricating a close, preserving lifecycle attribution.
 await admin.query(`UPDATE managed_execution_streams SET last_interval_at=$3 WHERE tenant_id=$1 AND employee_id=$2`,[tenant,otherEmployee,at]);await accept(await interval('shift_end',l.shift,at));
 const previous=await source('2026-11-06',otherEmployee),today=await source('2026-11-07',otherEmployee);assert.ok(!previous.source.segments.some((s:any)=>s.shiftId===l.shift));assert.ok(today.source.segments.some((s:any)=>s.shiftId===l.shift&&s.ms==='0'));assert.equal(today.source.hasOpenIntervals,false);assert.equal((await approval('2026-11-07',{},otherEmployee)).status,201);
});
