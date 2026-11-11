import assert from 'node:assert/strict';
import {publicContract,matchesContract,checkHttpContract} from './contract-check.js';
import {randomUUID as id,createHash} from 'node:crypto';
import test from 'node:test';
import {mkdtemp,rm,readdir,readFile,writeFile,unlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request as httpRequest} from 'node:http';
import {execFileSync} from 'node:child_process';
import {EvidenceStorage} from '../src/evidence-storage.js';
import {withTenant} from '../src/db.js';
import {TimeXlsx} from '../src/time-xlsx.js';
import {timeSource,canonicalSource} from '../src/time-source.js';
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
 const r=await fetch(`${base}/api/v1${url}`,{method,headers:{...headers(user),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const result={status:r.status,body:r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};checkHttpContract('/api/v1'+url,method,r.status,result.body,r.headers);return result;
}
async function put(file:string,bytes:Buffer=png,user:string=worker){const r=await fetch(`${base}/api/v1${path(file)}/content`,{method:'PUT',headers:{...headers(user),'content-type':'application/octet-stream'},body:Uint8Array.from(bytes)});const result={status:r.status,body:await r.json()};checkHttpContract('/api/v1'+path(file)+'/content','PUT',r.status,result.body,r.headers);return result;}
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
 const listed=await req(`/projects/${p}/time/days?from=2026-11-01&to=2026-11-01&limit=10`,undefined,director);assert.equal(listed.status,200,JSON.stringify(listed));assert.ok(listed.body.items.some((item:any)=>item.employeeId===employee&&item.day==='2026-11-01'&&item.status==='current'));
 const filtered=await req(`/projects/${p}/time/days?from=2026-11-01&to=2026-11-01&status=current`,undefined,director);assert.equal(filtered.status,200);assert.ok(filtered.body.items.every((item:any)=>item.status==='current'));
 const own=await req(`/projects/${p}/time/days?from=2026-11-01&to=2026-11-01`,undefined,worker);assert.equal(own.status,200);assert.ok(own.body.items.every((item:any)=>item.employeeId===employee));
 assert.equal((await req(`/projects/${p}/time/days?from=2026-11-01&to=2026-11-01&status=nope`,undefined,director)).status,400);
 assert.equal((await req(`/projects/${foreignProject}/time/days?from=2026-11-01&to=2026-11-01`,undefined,worker)).status,404);
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

test('XLSX tracer: actual HTTP empty snapshot is a downloadable workbook',async()=>{
 const r=await req(`/projects/${p}/time/export.xlsx?from=2026-01-01&to=2026-01-01`,undefined,director);assert.equal(r.status,200,JSON.stringify(r));assert.ok(Buffer.isBuffer(r.body));assert.equal(r.body.subarray(0,2).toString(),'PK');
});

const exportPath=(from:string,to=from,project=p)=>`/projects/${project}/time/export.xlsx?from=${from}&to=${to}`;
async function workbook(bytes:Buffer){
 const file=join(root,`time-${id()}.xlsx`);await writeFile(file,bytes);
 try{const sheets=JSON.parse(execFileSync('python3',[new URL('./inspect-time-xlsx.py',import.meta.url).pathname,file],{encoding:'utf8',maxBuffer:64*1024*1024}));
  const [head,...rows]=sheets.Time,records=rows.map((r:any[])=>Object.fromEntries(head.map((c:any,i:number)=>[c.value,r[i].value]))),meta=Object.fromEntries(sheets.Snapshot.slice(1).map((r:any[])=>r.map(c=>c.value)));return {sheets,records,meta};
 }finally{await unlink(file);}
}
test('XLSX independently parsed header-only snapshot, HTTP headers and strict civil range',async()=>{
 const r=await fetch(`${base}/api/v1${exportPath('2026-01-01','2026-01-31')}`,{headers:headers(director)});assert.equal(r.status,200);
 assert.equal(r.headers.get('content-type'),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.match(r.headers.get('content-disposition')!,/^attachment; filename="time-2026-01-01-2026-01-31.xlsx"$/);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 const x=await workbook(Buffer.from(await r.arrayBuffer()));assert.equal(x.records.length,0);assert.equal(x.meta.empty,'true');assert.equal(x.meta.recordedRows,'0');assert.match(x.meta.explanation,/No recorded/);assert.ok(!JSON.stringify(x).includes('provisional'));
 for(const q of ['', '?from=2026-01-01','?from=2026-01-01&to=2026-02-01','?from=2026-02-02&to=2026-02-01','?from=2026-02-30&to=2026-03-01','?from=0000-01-01&to=2026-01-01','?from=2026-01-01&to=2026-01-01&asOf=2026-01-01','?from=2026-01-01&from=2026-01-02&to=2026-01-02'])assert.equal((await req(`/projects/${p}/time/export.xlsx${q}`,undefined,director)).status,400,q);
});
test('XLSX complete current approved snapshot keeps zero, exact source vs override, identity and safe typed labels',async()=>{
 await lifecycle('2026-02-01T12:00:00Z',[{at:'2026-02-01T12:00:00Z'}]);await lifecycle('2026-02-02T12:00:00Z',[{at:'2026-02-02T12:00:00.001Z'}]);
 const reason='=SUM(A1:A2)\u0001<&> + - @';assert.equal((await approval('2026-02-01',{reason})).status,201);assert.equal((await approval('2026-02-02',{reason,confirmedTotals:{...zeroTotals,presenceMs:'3600003',workMs:'3600001',breakMs:'2'}})).status,201);
 const sources=await Promise.all(['2026-02-01','2026-02-02'].map(d=>source(d)));
 try{for(const prefix of ['=','+','-','@']){
  await admin.query(`UPDATE projects SET name=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,p,prefix+'Project\u0002<&>']);await admin.query(`UPDATE employees SET full_name=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee,prefix+'Worker\u0003<&>']);
  for(const u of [director,master,pto]){const r=await req(exportPath('2026-02-01','2026-02-02'),undefined,u);assert.equal(r.status,200,JSON.stringify(r));const x=await workbook(r.body);assert.equal(x.records.length,2);assert.equal(x.meta.empty,'false');assert.equal(x.meta.recordedRows,'2');assert.match(x.meta.hoursRounding,/half up.*six/);
   for(const [i,row] of x.records.entries()){assert.equal(row.projectId,p);assert.equal(row.projectName,prefix+'Project<&>');assert.equal(row.employeeId,employee);assert.equal(row.employeeName,prefix+'Worker<&>');assert.equal(row.day,sources[i].day);assert.equal(row.sourceHash,sources[i].sourceHash);assert.equal(row.approvalVersion,String(sources[i].approvalVersion));assert.equal(row.actorUserId,director);assert.equal(row.requestId,sources[i].latest.requestId);assert.equal(row.approvedAt,sources[i].latest.recordedAt);assert.equal(row.reason,'=SUM(A1:A2)<&> + - @');assert.equal(row.capturedAt,x.meta.capturedAt);assert.equal(row.timezone,'UTC');
    for(const k of Object.keys(zeroTotals)){assert.equal(row['source.'+k],sources[i].source.totals[k]);assert.equal(row['confirmed.'+k],sources[i].latest.confirmedTotals[k]);}assert.ok(!JSON.stringify(row).includes('provisional'));
   }assert.equal(x.records[0]['source.presenceMs'],'0');assert.equal(x.records[1]['source.presenceMs'],'1');assert.equal(x.records[1]['source.presenceHours'],'0');assert.equal(x.records[1]['confirmed.workHours'],'1');assert.equal(x.records[1]['confirmed.presenceHours'],'1.000001');assert.equal(x.records[1]['confirmed.breakHours'],'0.000001');assert.equal(x.records[1].overridden,'1');
  }
 }}finally{await admin.query(`UPDATE projects SET name='P1' WHERE tenant_id=$1 AND id=$2`,[tenant,p]);await admin.query(`UPDATE employees SET full_name='Worker' WHERE tenant_id=$1 AND id=$2`,[tenant,employee]);}
});
test('XLSX refuses every missing, stale, revoked and relevant open row without filtering',async()=>{
 const day='2026-02-03';await lifecycle(day+'T10:00:00Z',[{at:day+'T11:00:00Z'}]);
 async function denied(status:string){const r=await req(exportPath('2026-02-01',day),undefined,director);assert.equal(r.status,409,JSON.stringify(r));assert.match(r.body.error,/time_export_incomplete/);assert.ok(r.body.error.includes(employee));assert.ok(r.body.error.includes(day));assert.ok(r.body.error.includes(status));}
 await denied('unapproved');assert.equal((await approval(day)).status,201);assert.equal((await req(exportPath('2026-02-01',day),undefined,director)).status,200);
 const l=await lifecycle(day+'T12:00:00Z',[{at:day+'T13:00:00Z'}]);await denied('stale');assert.equal((await approval(day)).status,201);
 const s=await source(day);assert.equal((await req(timePath(day)+'/revoke',{requestId:id(),expectedApprovalVersion:s.approvalVersion,reason:'Withdraw'},director)).status,201);await denied('revoked');assert.equal((await approval(day)).status,201);
 await admin.query(`UPDATE managed_execution_events SET review_flags='{"delayed":true}' WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,l.events[0].actor,l.events[0].requestId]);await denied('stale');assert.equal((await approval(day)).status,201);
 const opened=await lifecycle(day+'T14:00:00Z',[],{open:true});await denied('stale');
 const requestId=id(),version=Number((await admin.query(`SELECT version FROM managed_execution_streams WHERE tenant_id=$1 AND employee_id=$2`,[tenant,employee])).rows[0].version)+1;
 await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`,[tenant,worker,requestId]);
 await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,'shift_end',$7,$8,now(),'{}',repeat('a',64),'{}')`,[tenant,worker,requestId,employee,p,opened.shift,version,day+'T15:00:00Z']);
 await admin.query(`UPDATE managed_segments SET ended_at=$3 WHERE tenant_id=$1 AND shift_id=$2`,[tenant,opened.shift,day+'T15:00:00Z']);await admin.query(`UPDATE managed_shifts SET ended_at=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,opened.shift,day+'T15:00:00Z']);await admin.query(`UPDATE managed_execution_streams SET version=$3 WHERE tenant_id=$1 AND employee_id=$2`,[tenant,employee,version]);
});
test('XLSX historical director and granted master/PTO authority survives archived employee and assignment; workers and foreign scopes denied',async()=>{
 try{await admin.query(`UPDATE employees SET status='archived',user_id=NULL WHERE tenant_id=$1 AND id=$2`,[tenant,employee]);await admin.query(`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee]);
  for(const u of [director,master,pto])assert.equal((await req(exportPath('2026-02-01','2026-02-02'),undefined,u)).status,200);
  assert.equal((await req(exportPath('2026-02-01'),undefined,worker)).status,403);assert.equal((await req(exportPath('2026-01-01'),undefined,worker)).status,403);assert.equal((await req(exportPath('2026-01-01'),undefined,outsider)).status,403);assert.equal((await req(exportPath('2026-01-01','2026-01-01',foreignProject),undefined,director)).status,404);assert.equal((await req(exportPath('2026-01-01','2026-01-01',p2),undefined,master)).status,404);
 }finally{await admin.query(`UPDATE employees SET status='active',user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,employee,worker]);await admin.query(`UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND employee_id=$3`,[tenant,p,employee]);}
});
test('XLSX fresh authority after actual PostgreSQL waits rejects role/status/grant revocation',async()=>{
 const cases=[{table:'memberships',user:director,set:"role='worker'",reset:"role='director'",status:403},{table:'memberships',user:director,set:"status='revoked'",reset:"status='active'",status:403},{table:'project_memberships',user:master,set:"status='revoked'",reset:"status='active'",status:404}];
 for(const v of cases){const c=await admin.connect();let pending:Promise<any>|undefined;const where=`tenant_id=$1 AND user_id=$2${v.table==='project_memberships'?' AND project_id=$3':''}`,values=v.table==='project_memberships'?[tenant,v.user,p]:[tenant,v.user];
  try{await c.query('BEGIN');await c.query(`SELECT 1 FROM ${v.table} WHERE ${where} FOR NO KEY UPDATE`,values);const pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;pending=req(exportPath('2026-02-01','2026-02-02'),undefined,v.user);await waiters(pid);await c.query(`UPDATE ${v.table} SET ${v.set} WHERE ${where}`,values);await c.query('COMMIT');assert.equal((await pending).status,v.status);
  }finally{await c.query('ROLLBACK');c.release();await pending;await admin.query(`UPDATE ${v.table} SET ${v.reset} WHERE ${where}`,values);}
 }
});
test('XLSX rendering holds no database scope locks; post-render current ACL fails closed for role/status/grant changes',async()=>{
 const cases=[{table:'memberships',user:director,set:"role='worker'",reset:"role='director'",status:403},{table:'memberships',user:director,set:"status='revoked'",reset:"status='active'",status:403},{table:'project_memberships',user:master,set:"status='revoked'",reset:"status='active'",status:404},{table:'memberships',user:pto,set:"role='worker'",reset:"role='pto'",status:403}];
 for(const v of cases){const original=TimeXlsx.prototype.render;let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>entered=r);let pending:Promise<any>|undefined;
  TimeXlsx.prototype.render=async function(s){entered();await gate;return original.call(this,s);};const where=`tenant_id=$1 AND user_id=$2${v.table==='project_memberships'?' AND project_id=$3':''}`,values=v.table==='project_memberships'?[tenant,v.user,p]:[tenant,v.user];
  try{pending=req(exportPath('2026-02-02'),undefined,v.user);await Promise.race([seen,pending.then(r=>{throw new Error('Export ended before render: '+JSON.stringify(r));})]);const c=await admin.connect();try{await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='1s'");await c.query(`UPDATE ${v.table} SET ${v.set} WHERE ${where}`,values);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();}release();const r=await pending;assert.equal(r.status,v.status,JSON.stringify(r));assert.ok(!Buffer.isBuffer(r.body));
  }finally{release();TimeXlsx.prototype.render=original;await pending;await admin.query(`UPDATE ${v.table} SET ${v.reset} WHERE ${where}`,values);}
 }
});
test('XLSX captured snapshot remains attributable after valid03a event arrives during unlocked rendering',async()=>{
 // This race must also run under --test-name-pattern, without earlier lifecycle/admission tests.
 await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[tenant,otherEmployee]);
 const person=(await admin.query(`SELECT user_id,status FROM employees WHERE tenant_id=$1 AND id=$2`,[tenant,otherEmployee])).rows[0];assert.equal(person.status,'active');
 if(person.user_id===null)await admin.query(`UPDATE employees SET user_id=$3 WHERE tenant_id=$1 AND id=$2`,[tenant,otherEmployee,master]);else assert.equal(person.user_id,master);
 const assignment=(await must(`/projects/${p}/assignments?limit=100`,undefined,'GET')).items.find((a:any)=>a.employeeId===otherEmployee);
 if(assignment?.status!=='active'||!assignment.currentAdmission.eligible){
  const existing=await req(`/projects/${p}/admission-template`,undefined,director);assert.ok([200,404].includes(existing.status),JSON.stringify(existing));
  const template=existing.status===200?existing.body:await must(`/projects/${p}/admission-template`,{requestId:id(),code:'time',title:'Safe',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]});
  const check=await must(`/employees/${otherEmployee}/admission-checks`,{requestId:id(),projectId:p,templateVersion:template.version,answers:template.items.map((item:any)=>({itemId:item.id,value:true}))});
  await must(`/projects/${p}/assignments/${otherEmployee}`,{requestId:id(),expectedVersion:assignment?.version??0,status:'active',admissionCheckId:check.id},'PUT');
 }
 const day='2026-11-08',sh=id();await accept(await interval('shift_start',sh,day+'T09:00:00Z'));await accept(await interval('shift_end',sh,day+'T10:00:00Z'));assert.equal((await approval(day,{},otherEmployee)).status,201);const s=await source(day,otherEmployee);
 const original=TimeXlsx.prototype.render;let release!:()=>void,entered!:(s:any)=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<any>(r=>entered=r);let pending:Promise<any>|undefined;
 TimeXlsx.prototype.render=async function(s){entered(s);await gate;return original.call(this,s);};
 try{pending=req(exportPath(day),undefined,director);const captured=await Promise.race([seen,pending.then(r=>{throw new Error('Export ended before render: '+JSON.stringify(r));})]);assert.equal(captured.rows.length,1);assert.equal(captured.rows[0].revision.sourceHash,s.sourceHash);
  const late=id();await accept(await interval('shift_start',late,day+'T11:00:00Z'));await accept(await interval('shift_end',late,day+'T12:00:00Z'));assert.equal((await source(day,otherEmployee)).status,'stale');release();const r=await pending;assert.equal(r.status,200,JSON.stringify(r));const x=await workbook(r.body);assert.equal(x.records[0].sourceHash,s.sourceHash);assert.equal(x.records[0]['source.presenceMs'],'3600000');assert.equal(x.records[0].approvalVersion,String(s.approvalVersion));assert.equal(x.meta.capturedAt,captured.capturedAt);assert.equal((await req(exportPath(day),undefined,director)).status,409);
 }finally{release();TimeXlsx.prototype.render=original;await pending;}
});
test('XLSX actual export/source-event project lock queues serialize both arrival orders',async()=>{
 const day='2026-11-08';assert.equal((await approval(day,{},otherEmployee)).status,201);
 for(const eventFirst of [true,false]){const s=await source(day,otherEmployee),sh=id(),ev=await interval('shift_start',sh,day+(eventFirst?'T13:00:00Z':'T15:00:00Z')),gate=await admin.connect();let ep:Promise<any>|undefined,xp:Promise<any>|undefined;
  try{await gate.query('BEGIN');await gate.query(`SELECT id FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,p]);const pid=(await gate.query('SELECT pg_backend_pid() pid')).rows[0].pid;
   if(eventFirst){ep=ingest(ev);await waiters(pid);xp=req(exportPath(day),undefined,director);}else{xp=req(exportPath(day),undefined,director);await waiters(pid);ep=ingest(ev);}await waiters(pid,2);await gate.query('COMMIT');assert.equal((await ep).outcome,'success');const x=await xp;assert.equal(x.status,eventFirst?409:200,JSON.stringify(x));if(!eventFirst){const book=await workbook(x.body);assert.equal(book.records[0].sourceHash,s.sourceHash);assert.equal(book.records[0].approvalVersion,String(s.approvalVersion));}
  }finally{await gate.query('ROLLBACK');gate.release();await Promise.all([ep,xp]);}
  await accept(await interval('shift_end',sh,day+(eventFirst?'T14:00:00Z':'T16:00:00Z')));assert.equal((await approval(day,{},otherEmployee)).status,201);
 }
});
test('XLSX actual civil DST 23/25-hour exports preserve exact milliseconds and hours',async()=>{
 try{await admin.query(`UPDATE tenants SET timezone='Europe/Berlin' WHERE id=$1`,[tenant]);
  for(const [day,start,end,total,hours] of [['2025-03-30','2025-03-29T23:00:00Z','2025-03-30T22:00:00Z','82800000','23'],['2025-10-26','2025-10-25T22:00:00Z','2025-10-26T23:00:00Z','90000000','25']]){
   await lifecycle(start,[{at:end}]);assert.equal((await approval(day)).status,201);const r=await req(exportPath(day),undefined,director);assert.equal(r.status,200);const x=await workbook(r.body);assert.equal(x.records.length,1);assert.equal(x.records[0]['source.presenceMs'],total);assert.equal(x.records[0]['source.presenceHours'],hours);assert.equal(x.records[0]['confirmed.presenceMs'],total);assert.equal(x.meta.timezone,'Europe/Berlin');
  }
 }finally{await admin.query(`UPDATE tenants SET timezone='UTC' WHERE id=$1`,[tenant]);}
});
test('XLSX exact10000 recorded-day boundary renders all approvals;10001 including zero rejects; incomplete identifiers bounded',async()=>{
 const project=id(),people=Array.from({length:323},(_,i)=>({employee:id(),shift:id(),segment:id(),open:id(),close:id(),days:i===322?18:31}));
 await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Boundary')`,[tenant,project]);
 await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name) SELECT $1,(x->>'employee')::uuid,$2,'Boundary employee' FROM jsonb_array_elements($3::jsonb) x`,[tenant,org,JSON.stringify(people)]);
 const revisions:any[]=[],totals={...zeroTotals,presenceMs:'86400000',idleMs:'86400000'},flags={delayed:false,future:false,geoTimeMismatch:false,suspicious:false};
 for(const person of people){
  const start='2026-03-01T00:00:00.000Z',end=new Date(Date.parse(start)+person.days*86400000).toISOString();
  await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id,version) VALUES($1,$2,2)`,[tenant,person.employee]);
  await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,$5,$6)`,[tenant,project,person.employee,person.shift,start,end]);
  await admin.query(`INSERT INTO managed_segments(tenant_id,project_id,employee_id,shift_id,id,mode,started_at,ended_at) VALUES($1,$2,$3,$4,$5,'idle',$6,$7)`,[tenant,project,person.employee,person.shift,person.segment,start,end]);
  for(const [n,requestId,at,kind] of [[1,person.open,start,'shift_start'],[2,person.close,end,'shift_end']] as const){
   await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('a',64),201,'{}')`,[tenant,director,requestId]);
   await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'{}',repeat('a',64),'{}')`,[tenant,director,requestId,person.employee,project,person.shift,kind,n,at]);
  }
  for(let n=0;n<person.days;n++){
   const lo=new Date(Date.parse(start)+n*86400000).toISOString(),hi=new Date(Date.parse(lo)+86400000).toISOString(),day=lo.slice(0,10);
   const source={schemaVersion:1,tenantId:tenant,projectId:project,employeeId:person.employee,day,timezone:'UTC',civilStart:lo,civilEnd:hi,segments:[{id:person.segment,shiftId:person.shift,taskId:null,mode:'idle',clippedStart:lo,clippedEnd:hi,ms:'86400000',open:false}],zeroMarkers:[],totals,tasks:[],intervalEvents:[{tenantId:tenant,actorUserId:director,requestId:person.open,employeeId:person.employee,version:'1',shiftId:person.shift,kind:'shift_start',clippedOccurredAt:lo,flags},{tenantId:tenant,actorUserId:director,requestId:person.close,employeeId:person.employee,version:'2',shiftId:person.shift,kind:'shift_end',clippedOccurredAt:hi,flags}],hasOpenIntervals:false,suspicious:false};
   revisions.push({employee:person.employee,day,source,hash:createHash('sha256').update(canonicalSource(source)).digest('hex'),request:id()});
  }
 }
 assert.equal(revisions.length,10000);
 const missing=await req(exportPath('2026-03-01','2026-03-31',project),undefined,director);assert.equal(missing.status,409);const issues=JSON.parse(missing.body.error.slice('time_export_incomplete:'.length));assert.equal(issues.length,20);assert.ok(issues.every((x:any)=>x.status==='unapproved'&&x.employeeId&&x.day));
 // Fixture revisions are actual FK-scoped immutable rows; spot-check independently read canonical sources before bulk approvals.
 for(const row of [revisions[0],revisions.at(-1)]){const actual=await source(row.day,row.employee,project);assert.equal(actual.sourceHash,row.hash);assert.deepEqual(actual.source,row.source);}
 const encoded=JSON.stringify(revisions),c=await admin.connect();try{await c.query('BEGIN');
  await c.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) SELECT $1,$2,(x->>'request')::uuid,'fixture',repeat('a',64),201,'{}' FROM jsonb_array_elements($3::jsonb) x`,[tenant,director,encoded]);
  await c.query(`INSERT INTO time_approval_revisions(tenant_id,project_id,employee_id,day,version,state,source,source_hash,source_totals,confirmed_totals,overridden,reason,acknowledged_suspicious,actor_user_id,request_id) SELECT $1,$2,(x->>'employee')::uuid,(x->>'day')::date,1,'approved',x->'source',x->>'hash',x->'source'->'totals',x->'source'->'totals',false,'Boundary fixture',false,$3,(x->>'request')::uuid FROM jsonb_array_elements($4::jsonb) x`,[tenant,project,director,encoded]);
  await c.query(`INSERT INTO time_approval_heads(tenant_id,project_id,employee_id,day,version) SELECT $1,$2,(x->>'employee')::uuid,(x->>'day')::date,1 FROM jsonb_array_elements($3::jsonb) x`,[tenant,project,encoded]);await c.query('COMMIT');
 }finally{await c.query('ROLLBACK');c.release();}
 const exported=await req(exportPath('2026-03-01','2026-03-31',project),undefined,director);assert.equal(exported.status,200,JSON.stringify(exported));const x=await workbook(exported.body);assert.equal(x.records.length,10000);assert.equal(x.meta.recordedRows,'10000');assert.equal(new Set(x.records.map((r:any)=>r.employeeId+'/'+r.day)).size,10000);assert.equal(new Set(x.records.map((r:any)=>r.capturedAt)).size,1);
 const expected=new Map(revisions.map(r=>[r.employee+'/'+r.day,r]));for(const row of x.records){const r=expected.get(row.employeeId+'/'+row.day);assert.ok(r);assert.equal(row.sourceHash,r.hash);assert.equal(row['source.presenceMs'],'86400000');assert.equal(row['confirmed.presenceMs'],'86400000');}
 await lifecycle('2026-03-31T12:00:00Z',[{at:'2026-03-31T12:00:00Z'}],{project,employee:otherEmployee,actor:director});
 const over=await req(exportPath('2026-03-01','2026-03-31',project),undefined,director);assert.equal(over.status,422);assert.equal(over.body.error,'time_export_row_limit');
});

test('strict time contract covers exact snapshots, immutable revisions, inputs and XLSX failures',async()=>{
 const schemas=publicContract.components.schemas,root='/api/v1/projects/{p}/time',daily=root+'/employees/{employee}/days/{day}';
 const form={requestId:id(),expectedApprovalVersion:0,sourceHash:'a'.repeat(64),reason:'Reviewed',acknowledgeSuspicious:true,confirmedTotals:zeroTotals};matchesContract(form,schemas.TimeApprovalInput);
 for(const extra of [{tenantId:tenant},{expectedApprovalVersion:-1},{expectedApprovalVersion:Number.MAX_SAFE_INTEGER},{sourceHash:'A'.repeat(64)},{reason:' '},{reason:'a'.repeat(501)},{confirmedTotals:{...zeroTotals,workMs:'01'}},{confirmedTotals:{...zeroTotals,idleMs:'1.0'}},{confirmedTotals:{...zeroTotals,extra:'0'}},{confirmedTotals:{presenceMs:'0'}}])assert.throws(()=>matchesContract({...form,...extra},schemas.TimeApprovalInput));
 for(const key of ['requestId','expectedApprovalVersion','sourceHash','reason']){const missing:any={...form};delete missing[key];assert.throws(()=>matchesContract(missing,schemas.TimeApprovalInput));}
 const revoke={requestId:id(),expectedApprovalVersion:1,reason:'Withdraw'};matchesContract(revoke,schemas.TimeRevokeInput);assert.throws(()=>matchesContract({...revoke,sourceHash:form.sourceHash},schemas.TimeRevokeInput));
 for(const name of ['TimeTotals','TimeTaskAllocation','TimeSourceSegment','TimeZeroMarker','TimeIntervalFlags','TimeIntervalEvent','TimeSource','TimeApprovalRevision','TimeDay','TimeDaySummary','TimeDayList','TimeApprovalHistory','TimeApprovalInput','TimeRevokeInput'])assert.equal(schemas[name].additionalProperties,false,name);
 const current=await source();matchesContract(current,schemas.TimeDay);const history=await req(timePath()+'/history',undefined,director);matchesContract(history.body,schemas.TimeApprovalHistory);
 assert.throws(()=>matchesContract({...current,latest:{...current.latest,forged:true}},schemas.TimeDay));
 const exportOp=publicContract.paths[root+'/export.xlsx'].get,mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';assert.equal(exportOp.responses['200'].content[mime].schema.format,'binary');assert.deepEqual(exportOp.parameters.filter((p:any)=>p.in==='query').map((p:any)=>[p.name,p.required]),[['from',true],['to',true]]);
 for(const code of ['400','401','403','404','409','422','500'])assert.ok(exportOp.responses[code]);assert.match(exportOp.responses['409'].description,/time_export_incomplete/);assert.match(exportOp.responses['422'].description,/10000/);
 assert.equal(publicContract.paths[daily+'/approvals'].post.requestBody.required,true);assert.equal(publicContract.paths[daily+'/revoke'].post.requestBody.required,true);
 const r=await fetch(`${base}/api/v1${timePath()}`);const b=await r.json();assert.equal(r.status,401);checkHttpContract('/api/v1'+timePath(),'GET',r.status,b,r.headers);
});
