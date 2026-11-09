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
test.after(async()=>{try{await app?.close();}finally{const c=await admin.connect();try{await c.query('BEGIN');await c.query('SET CONSTRAINTS ALL DEFERRED');for(const t of ['private_evidence_attachments','private_evidence_files','managed_execution_reports','managed_execution_events','managed_segments','managed_shifts','managed_execution_streams','daily_tasks','employee_project_assignments','project_memberships','people_command_receipts','employees','memberships','projects','organizations','audit_log'])if((await c.query(`SELECT to_regclass($1) name`,[t])).rows[0].name)await c.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);await c.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await c.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);await c.query('COMMIT');}finally{await c.query('ROLLBACK');c.release();await Promise.all([admin.end(),restricted.end()]);await rm(root,{recursive:true,force:true});delete process.env.HELIOS_EVIDENCE_ROOT;}}});
test('tracer: reserve raw binary upload download and immutable existing event attachment over HTTP and PG',async()=>{
 const b=await reserve();const uploaded=await put(b.fileId);assert.equal(uploaded.status,200,JSON.stringify(uploaded));assert.equal(uploaded.body.state,'ready');
 const r=await fetch(`${base}/api/v1${path(b.fileId)}/content`,{headers:headers()});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
 const attach={requestId:id(),target:{kind:'execution_event',actorUserId:worker,requestId:eventRequest}};const a=await req(`${path(b.fileId)}/attachment`,attach);assert.equal(a.status,201,JSON.stringify(a));assert.equal(a.body.attachment.target.requestId,eventRequest);assert.deepEqual(await req(`${path(b.fileId)}/attachment`,attach),a);
 assert.equal((await admin.query(`SELECT count(*)::int n FROM private_evidence_attachments WHERE tenant_id=$1 AND file_id=$2`,[tenant,b.fileId])).rows[0].n,1);
});
const jpeg=Buffer.from('ffd8ffe000104a4649460001','hex'),pdf=Buffer.from('%PDF-1.7\nprivate evidence\n%%EOF');
async function download(file:string,user:string=worker){const r=await fetch(`${base}/api/v1${path(file)}/content`,{headers:headers(user)});const result={status:r.status,headers:r.headers,bytes:Buffer.from(await r.arrayBuffer())};checkHttpContract('/api/v1'+path(file)+'/content','GET',r.status,r.status===200?result.bytes:JSON.parse(result.bytes.toString()),r.headers);return result;}
async function ready(b=reservation(),user:string=worker,bytes:Buffer=png){await reserve(b,user);assert.equal((await put(b.fileId,bytes,user)).status,200);return b;}
async function effects(file:string){return (await admin.query(`SELECT (SELECT count(*)::int FROM private_evidence_files WHERE tenant_id=$1 AND id=$2 AND state='ready') ready,(SELECT count(*)::int FROM audit_log WHERE tenant_id=$1 AND object_id=$2 AND action='evidence_ready') audits,(SELECT count(*)::int FROM private_evidence_attachments WHERE tenant_id=$1 AND file_id=$2) attachments`,[tenant,file])).rows[0];}
async function temps(){return (await readdir(join(root,tenant)).catch(()=>[])).filter(f=>f.startsWith('.upload-'));}
function eventAttachment(actor:string=worker,request:string=eventRequest){return {requestId:id(),target:{kind:'execution_event',actorUserId:actor,requestId:request}};}
test('JPEG PNG PDF actual binary roundtrips, private modes, safe headers and paged metadata contain no storage keys',async()=>{
 for(const [type,bytes,name]of [['image/jpeg',jpeg,'../../hello.jpg'],['image/png',png,'файл "q".png'],['application/pdf',pdf,'evidence.pdf']] as const){
  const b=await ready(reservation(bytes,{filename:name,contentType:type}),worker,bytes),d=await download(b.fileId);assert.equal(d.status,200);assert.deepEqual(d.bytes,bytes);assert.equal(d.headers.get('content-type'),type);assert.equal(d.headers.get('x-content-type-options'),'nosniff');assert.match(d.headers.get('content-disposition')!,/^attachment; filename="[a-zA-Z0-9. _-]+"; filename\*=UTF-8''/);assert.match(d.headers.get('cache-control')!,/private, no-store/);assert.match(d.headers.get('content-security-policy')!,/sandbox/);
  const metadata=await req(path(b.fileId));assert.equal(metadata.status,200);assert.equal(metadata.body.filename,name);assert.equal(metadata.body.sizeBytes,bytes.length);assert.equal(metadata.body.sha256,sha(bytes));assert.equal(metadata.body.readyBy,worker);assert.ok(metadata.body.readyAt);assert.equal(metadata.body.reservedBy,worker);assert.ok(!JSON.stringify(metadata).includes(root));for(const key of ['path','key','root','storageKey'])assert.ok(!(key in metadata.body));
  assert.equal((await stat(join(root,tenant,b.fileId))).mode&0o777,0o600);
 }
 assert.equal((await stat(root)).mode&0o777,0o700);assert.equal((await stat(join(root,tenant))).mode&0o777,0o700);
 const all=await req(`${path()}?employeeId=${employee}`),paged=await req(`${path()}?limit=1&offset=1`);assert.equal(all.status,200);assert.equal(paged.body.total,all.body.total);assert.equal(paged.body.items.length,1);assert.deepEqual(paged.body.items,[all.body.items[1]]);
});
test('strict reservation and query forms, normalized UUIDs, immutable tenant-unique file identity and shared receipt collisions',async()=>{
 const b=reservation();for(const extra of [{sizeBytes:0},{sizeBytes:8388609},{sizeBytes:1.5},{sizeBytes:'8'},{sha256:'A'.repeat(64)},{sha256:'a'.repeat(63)},{contentType:'image/svg+xml'},{filename:''},{filename:'x'.repeat(256)},{filename:'x\r\nHeader: bad'},{employeeId:'bad'},{tenantId:tenant},{actorUserId:worker},{onBehalfReason:'  '}])assert.equal((await req(path(),{...b,...extra})).status,400,JSON.stringify(extra));
 await reserve({...b,fileId:b.fileId.toUpperCase(),employeeId:employee.toUpperCase()});const original=await req(path(),b);assert.equal(original.status,201);assert.equal(original.body.id,b.fileId);assert.deepEqual(await req(path(),b),original);
 assert.equal((await req(path(),{...b,filename:'changed'})).status,409);
 assert.equal((await req(path(),{...b,requestId:id(),filename:'different'})).status,409);
 assert.equal((await req(`/projects/${p2}/evidence`,{...b,requestId:id()},director)).status,409);
 assert.equal((await req('/employees',{requestId:b.requestId,fullName:'collision',organizationId:org},worker)).status,403);
 const manager=await reserve(reservation(),director);assert.equal((await req('/employees',{requestId:manager.requestId,fullName:'collision',organizationId:org},director)).status,409);
 for(const suffix of ['?unknown=x','?limit=101','?limit=1&limit=2','?employeeId=no'])assert.equal((await req(path()+suffix)).status,400);
 for(const suffix of ['?limit=1','?tenantId=x'])assert.equal((await req(path(b.fileId)+suffix)).status,400);
 assert.equal((await req(path(),{...b,requestId:id(),projectId:p})).status,400);
 assert.equal((await req(path(b.fileId)+'/attachment',{...eventAttachment(),target:{kind:'execution_event',actorUserId:worker,requestId:eventRequest,reportId:id()}})).status,400);
 assert.equal((await req(path(b.fileId)+'/attachment',{requestId:id(),target:{kind:'final_report',reportId:'bad'}})).status,400);
});
test('upload rejects empty wrong size hash magic or MIME without ready effect, and preserves pending retry',async()=>{
 for(const [bytes,extra]of [[png,{sha256:'a'.repeat(64)}],[Buffer.alloc(png.length),{}],[png,{contentType:'image/jpeg'}]] as [Buffer,any][]){const b=await reserve(reservation(bytes,extra));assert.equal((await put(b.fileId,bytes)).status,422);assert.deepEqual(await effects(b.fileId),{ready:0,audits:0,attachments:0});}
 const b=await reserve();assert.equal((await put(b.fileId,Buffer.alloc(0))).status,422);assert.equal((await put(b.fileId,Buffer.concat([png,Buffer.from('x')]))).status,422);
 const wrongType=await fetch(`${base}/api/v1${path(b.fileId)}/content`,{method:'PUT',headers:{...headers(),'content-type':'text/plain'},body:png});assert.equal(wrongType.status,415);
 assert.equal((await download(b.fileId)).status,409);assert.equal((await req(path(b.fileId)+'/attachment',eventAttachment())).status,409);assert.equal((await put(b.fileId)).status,200);
});
function raw(file:string,opts:{chunks?:Buffer[];length?:string;abort?:boolean;user?:string}={}){return new Promise<{status:number;body:any}>((resolve,reject)=>{
 const h:any={...headers(opts.user),'content-type':'application/octet-stream',connection:'close',...(opts.length===undefined?{}:{'content-length':opts.length})};
 const r=httpRequest(`${base}/api/v1${path(file)}/content`,{method:'PUT',headers:h,agent:false},res=>{const chunks:Buffer[]=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{try{resolve({status:res.statusCode!,body:Buffer.concat(chunks).length?JSON.parse(Buffer.concat(chunks).toString()):null});}catch(e){reject(e);}});});r.setTimeout(5000,()=>r.destroy(new Error('bounded raw HTTP test timeout')));r.on('error',e=>opts.abort?resolve({status:0,body:null}):reject(e));for(const c of opts.chunks??[])r.write(c);if(opts.abort)setTimeout(()=>r.destroy(),50);else r.end();
 });}
test('real chunked bound, Content-Length early limit/mismatch, malformed HTTP framing and client abort stay retryable',async()=>{
 const b=await reserve();assert.equal((await raw(b.fileId,{chunks:[png.subarray(0,2),png.subarray(2)]})).status,200);
 for(const [length,status]of [['8388609',413],['0',422],['1',422],['broken',400]] as const){const f=await reserve();assert.equal((await raw(f.fileId,{length})).status,status);assert.equal((await effects(f.fileId)).ready,0);}
 const maximum=Buffer.alloc(8*1024*1024);png.copy(maximum);const full=await reserve(reservation(maximum));assert.equal((await put(full.fileId,maximum)).status,200);assert.deepEqual((await download(full.fileId)).bytes,maximum);const overflow=await reserve(reservation(maximum));assert.equal((await raw(overflow.fileId,{chunks:[Buffer.alloc(4*1024*1024),Buffer.alloc(4*1024*1024),Buffer.from('x')]})).status,413);assert.equal((await effects(overflow.fileId)).ready,0);
 const abort=await reserve();await raw(abort.fileId,{chunks:[png.subarray(0,3)],abort:true});await new Promise(r=>setTimeout(r,100));assert.equal((await effects(abort.fileId)).ready,0);assert.deepEqual(await temps(),[]);assert.equal((await put(abort.fileId)).status,200);
});
test('concurrent identical and conflicting PUTs never overwrite and produce one ready audit, verified ready retry',async()=>{
 const b=await reserve();assert.deepEqual((await Promise.all([put(b.fileId),put(b.fileId),put(b.fileId)])).map(r=>r.status),[200,200,200]);assert.deepEqual(await effects(b.fileId),{ready:1,audits:1,attachments:0});
 const changed=Buffer.from(png);changed[changed.length-1]^=1;const r=await Promise.all([put(b.fileId),put(b.fileId,changed)]);assert.deepEqual(r.map(x=>x.status),[200,422]);assert.deepEqual((await download(b.fileId)).bytes,png);assert.equal((await effects(b.fileId)).audits,1);assert.deepEqual(await temps(),[]);
});
test('real filesystem write, file/directory fsync and promotion failures clean temps; promoted orphans are retried, never deleted',async()=>{
 const storage=app!.get(EvidenceStorage);
 for(const stage of ['write','sync','promote','directorySync'] as const){
  const b=await reserve(),key=stage==='directorySync'?'sync':stage,original=(storage as any)[key];let calls=0;
  (storage as any)[key]=async(...args:any[])=>{calls++;if(stage!=='directorySync'||calls===2)throw Object.assign(new Error('injected '+root),{code:'EIO'});return original.apply(storage,args);};
  try{const r=await put(b.fileId);assert.equal(r.status,503);assert.ok(!JSON.stringify(r).includes(root));assert.equal((await effects(b.fileId)).ready,0);assert.deepEqual(await temps(),[]);}finally{(storage as any)[key]=original;}
  if(stage==='directorySync')assert.deepEqual(await readFile(join(root,tenant,b.fileId)),png);else await assert.rejects(stat(join(root,tenant,b.fileId)));
  assert.equal((await put(b.fileId)).status,200);assert.deepEqual((await download(b.fileId)).bytes,png);assert.equal((await effects(b.fileId)).audits,1);
 }
});
test('post-storage audit rollback leaves verified private orphan pending, retry shares destination and commits once',async()=>{
 const b=await reserve(),fn=`evidence_fail_${id().replaceAll('-','')}`;
 await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id='${b.fileId}' AND NEW.action='evidence_ready' THEN RAISE EXCEPTION 'injected evidence audit failure'; END IF; RETURN NEW; END $$`);
 try{await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);assert.equal((await put(b.fileId)).status,500);assert.deepEqual(await effects(b.fileId),{ready:0,audits:0,attachments:0});assert.deepEqual(await readFile(join(root,tenant,b.fileId)),png);assert.deepEqual(await temps(),[]);}finally{await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_log`);await admin.query(`DROP FUNCTION ${fn}()`);}
 const before=(await stat(join(root,tenant,b.fileId))).ino;assert.equal((await put(b.fileId)).status,200);assert.equal((await stat(join(root,tenant,b.fileId))).ino,before);assert.deepEqual(await effects(b.fileId),{ready:1,audits:1,attachments:0});
});
test('missing/corrupt ready storage fails download attachment and retry closed, paths and arbitrary traversal never leak',async()=>{
 for(const missing of [false,true]){const b=await ready(),destination=join(root,tenant,b.fileId);if(missing)await unlink(destination);else await writeFile(destination,Buffer.alloc(png.length));
  const d=await download(b.fileId);assert.equal(d.status,503);assert.ok(!d.bytes.toString().includes(root));assert.equal((await req(path(b.fileId)+'/attachment',eventAttachment())).status,503);
  if(missing){assert.equal((await put(b.fileId)).status,200);}else{assert.equal((await put(b.fileId)).status,503);assert.deepEqual(await readFile(destination),Buffer.alloc(png.length));await writeFile(destination,png);}
  assert.equal((await effects(b.fileId)).audits,1);assert.deepEqual((await download(b.fileId)).bytes,png);
 }
 for(const f of ['bad','..%2F..%2Fetc%2Fpasswd','%2Ftmp%2Fsecret']){const r=await req(path(f));assert.ok([400,404].includes(r.status));assert.ok(!JSON.stringify(r).includes(root));}
});
let reportId:string;
async function ledgerEvent(actor:string,request:string,emp:string,project=p,kind='shift_start',version=1,shiftId=shift){
 await admin.query(`INSERT INTO people_command_receipts(tenant_id,actor_user_id,request_id,operation,command_hash,status,result) VALUES($1,$2,$3,'fixture',repeat('b',64),201,'{}')`,[tenant,actor,request]);
 await admin.query(`INSERT INTO managed_execution_events(tenant_id,actor_user_id,request_id,employee_id,project_id,shift_id,kind,version,occurred_at,received_at,original_payload,command_hash,review_flags) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'2026-11-02',now(),'{}',repeat('b',64),'{}')`,[tenant,actor,request,emp,project,shiftId,kind,version]);
}
test('both exact composite event identities and final report bind once; wrong tenant/project/employee or actor cannot alias',async()=>{
 const otherShift=id();await admin.query(`INSERT INTO managed_execution_streams(tenant_id,employee_id) VALUES($1,$2)`,[tenant,otherEmployee]);await admin.query(`INSERT INTO managed_shifts(tenant_id,project_id,employee_id,id,started_at,ended_at) VALUES($1,$2,$3,$4,'2026-11-01','2026-11-02')`,[tenant,p,otherEmployee,otherShift]);
 await ledgerEvent(director,eventRequest,otherEmployee,p,'shift_start',1,otherShift);await ledgerEvent(master,eventRequest,employee,p,'segment_change',2);
 const b=await ready();assert.equal((await req(path(b.fileId)+'/attachment',eventAttachment(director))).status,404);const attached=await req(path(b.fileId)+'/attachment',eventAttachment(master));assert.equal(attached.status,201);assert.equal(attached.body.attachment.target.actorUserId,master);assert.equal((await req(path(b.fileId)+'/attachment',eventAttachment(worker))).status,409);
 const other=await ready(reservation(png,{employeeId:otherEmployee}),director);assert.equal((await req(path(other.fileId)+'/attachment',eventAttachment(worker),director)).status,404);assert.equal((await req(path(other.fileId)+'/attachment',eventAttachment(director),director)).status,201);
 const task=id(),reportEvent=id();reportId=id();await admin.query(`INSERT INTO daily_tasks(tenant_id,id,project_id,title,work_date,planned_quantity,unit,assignee_employee_id) VALUES($1,$2,$3,'Evidence report','2026-11-01',1,'m3',$4)`,[tenant,task,p,employee]);await ledgerEvent(worker,reportEvent,employee,p,'submit_volume',3);
 await admin.query(`INSERT INTO managed_execution_reports(tenant_id,project_id,employee_id,shift_id,report_id,task_id,actor_user_id,request_id,submitted_quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1)`,[tenant,p,employee,shift,reportId,task,worker,reportEvent]);
 const f=await ready(),command={requestId:id(),target:{kind:'final_report',reportId}};const r=await req(path(f.fileId)+'/attachment',command);assert.equal(r.status,201);assert.deepEqual(r.body.attachment.target,command.target);assert.deepEqual(await req(path(f.fileId)+'/attachment',command),r);
 assert.equal((await req(path(f.fileId)+'/attachment',{...command,target:{kind:'final_report',reportId:id()}})).status,409);
 const bad=await ready(reservation(png,{employeeId:otherEmployee}),director);assert.equal((await req(path(bad.fileId)+'/attachment',command,director)).status,404);
 const pending=await reserve(reservation(png,{employeeId:employee}),director);assert.equal((await req(`/projects/${foreignProject}/evidence/${pending.fileId}/attachment`,eventAttachment(),director)).status,404);
 // Managed history survives cancellation: no task admission/publication/active-assignment gate is consulted.
 await admin.query(`UPDATE daily_tasks SET status='cancelled' WHERE tenant_id=$1 AND id=$2`,[tenant,task]);assert.equal((await download(f.fileId)).status,200);
});
test('authority matrix tenant/project/own link assignment and archive fences; granted managers retain historical access',async()=>{
 const b=await ready(),routes=[path(b.fileId),path(b.fileId)+'/content',path()];
 for(const u of [director,master,pto])for(const route of routes)assert.equal((await req(route,undefined,u)).status,200);
 assert.equal((await req(path(),reservation(),pto)).status,403);assert.equal((await put(b.fileId,png,pto)).status,403);assert.equal((await req(path(b.fileId)+'/attachment',eventAttachment(),pto)).status,403);
 assert.equal((await req(path(),reservation(),master)).status,403);const m=await ready(reservation(png,{onBehalfReason:'Help worker'}),master);assert.equal((await req(path(m.fileId)+'/attachment',eventAttachment(),master)).status,403);assert.equal((await req(path(m.fileId)+'/attachment',{...eventAttachment(),onBehalfReason:'Document event'},master)).status,201);
 const other=await ready(reservation(png,{employeeId:otherEmployee}),director);for(const route of [path(other.fileId),path(other.fileId)+'/content',`${path()}?employeeId=${otherEmployee}`])assert.equal((await req(route)).status,404);assert.equal((await req(path(),reservation(png,{employeeId:otherEmployee}))).status,404);const list=await req(path());assert.ok(list.body.items.every((f:any)=>f.employeeId===employee));
 assert.equal((await req(path(b.fileId),undefined,outsider)).status,403);for(const u of [worker,master,pto])assert.equal((await req(`/projects/${p2}/evidence`,undefined,u)).status,404);assert.equal((await req(`/projects/${foreignProject}/evidence`,undefined,director)).status,404);
 const updates=[
  {sql:`UPDATE employees SET user_id=NULL WHERE tenant_id=$1 AND id=$2`,restore:`UPDATE employees SET user_id='${worker}' WHERE tenant_id=$1 AND id=$2`,values:[tenant,employee]},
  {sql:`UPDATE employees SET status='archived' WHERE tenant_id=$1 AND id=$2`,restore:`UPDATE employees SET status='active' WHERE tenant_id=$1 AND id=$2`,values:[tenant,employee]},
  {sql:`UPDATE employee_project_assignments SET status='revoked' WHERE tenant_id=$1 AND employee_id=$2 AND project_id='${p}'`,restore:`UPDATE employee_project_assignments SET status='active' WHERE tenant_id=$1 AND employee_id=$2 AND project_id='${p}'`,values:[tenant,employee]},
  {sql:`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2 AND project_id='${p}'`,restore:`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2 AND project_id='${p}'`,values:[tenant,worker]}
 ];
 for(const change of updates){await admin.query(change.sql,change.values);try{for(const route of routes)assert.equal((await req(route)).status,404);assert.equal((await put(b.fileId)).status,404);assert.equal((await req(path(),b)).status,404);for(const u of [director,master,pto])assert.equal((await req(path(b.fileId),undefined,u)).status,200);}finally{await admin.query(change.restore,change.values);}}
 for(const u of [master,pto]){await admin.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,u]);try{assert.equal((await req(path(b.fileId),undefined,u)).status,404);}finally{await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,u]);}}
});
test('SQL FORCE RLS narrow immutable grants and both target composite FKs; repeat migration preserves ledger and exact data',async()=>{
 const tables=['private_evidence_files','private_evidence_attachments'];
 for(const table of tables){const r=(await admin.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass`,[table])).rows[0];assert.deepEqual(r,{relrowsecurity:true,relforcerowsecurity:true});assert.equal((await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM ${table}`))).rows.length,0);await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`DELETE FROM ${table} WHERE tenant_id=$1`,[tenant])),(e:any)=>e.code==='42501');}
 const b=await ready();await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`UPDATE private_evidence_files SET sha256=repeat('c',64) WHERE tenant_id=$1 AND id=$2`,[tenant,b.fileId])),(e:any)=>e.code==='42501');await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`UPDATE private_evidence_files SET state='pending',ready_by=NULL,ready_at=NULL WHERE tenant_id=$1 AND id=$2`,[tenant,b.fileId])),(e:any)=>e.code==='23514');
 await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`UPDATE private_evidence_attachments SET attached_by=$2 WHERE tenant_id=$1`,[tenant,director])),(e:any)=>e.code==='42501');
 const other=await ready(reservation(png,{employeeId:otherEmployee}),director);
 const invalidAttachment=(sql:string,values:any[])=>assert.rejects(withTenant(restricted,tenant,director,c=>c.query(sql,values)),(e:any)=>e.code==='23503');
 const eventSql=`INSERT INTO private_evidence_attachments(tenant_id,file_id,project_id,employee_id,target_kind,shift_id,event_actor_user_id,event_request_id,attached_by) VALUES($1,$2,$3,$4,'execution_event',$5,$6,$7,$8)`;
 await invalidAttachment(eventSql,[tenant,other.fileId,p,otherEmployee,shift,worker,eventRequest,director]);await invalidAttachment(eventSql,[tenant,b.fileId,p2,employee,shift,worker,eventRequest,director]);
 await invalidAttachment(`INSERT INTO private_evidence_attachments(tenant_id,file_id,project_id,employee_id,target_kind,report_id,attached_by) VALUES($1,$2,$3,$4,'final_report',$5,$6)`,[tenant,other.fileId,p,otherEmployee,reportId,director]);
 await assert.rejects(withTenant(restricted,tenant,worker,c=>c.query(`INSERT INTO private_evidence_attachments(tenant_id,file_id,project_id,employee_id,target_kind,attached_by) VALUES($1,$2,$3,$4,'execution_event',$5)`,[tenant,b.fileId,p,employee,worker])),(e:any)=>e.code==='23514');
 const snapshot=async()=>({ledger:(await admin.query(`SELECT * FROM schema_migrations ORDER BY filename`)).rows,data:await Promise.all(tables.map(async t=>(await admin.query(`SELECT * FROM ${t} ORDER BY to_jsonb(${t})::text`)).rows))});const before=await snapshot();
 const env={...process.env,DATABASE_URL:'postgres://helios_app:helios_app@127.0.0.1:54339/helios',ADMIN_DATABASE_URL:'postgres://helios:helios@127.0.0.1:54339/helios',HELIOS_DB_PORT:'54339',API_PORT:'4327'};
 for(let n=0;n<2;n++)execFileSync('corepack',['pnpm','db:migrate'],{cwd:new URL('../../../',import.meta.url),env,stdio:'pipe'});assert.deepEqual(await snapshot(),before);
});
async function waiters(pid:number,count=1){const until=Date.now()+8000;while(Date.now()<until){const n=(await admin.query(`WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) UNION SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid=ANY(pg_blocking_pids(a.pid))) SELECT count(*)::int n FROM waiting`,[pid])).rows[0].n;if(n>=count)return;await new Promise(r=>setTimeout(r,10));}assert.fail('Expected actual PostgreSQL waiters');}
const authorityChanges=[
 {name:'role',table:'memberships',column:'user_id',id:worker,set:`role='pto'`,reset:`role='worker'`,status:403},
 {name:'tenant status',table:'memberships',column:'user_id',id:worker,set:`status='revoked'`,reset:`status='active'`,status:403},
 {name:'link',table:'employees',column:'id',id:employee,set:`user_id='${master}'`,reset:`user_id='${worker}'`,status:404},
 {name:'archive',table:'employees',column:'id',id:employee,set:`status='archived'`,reset:`status='active'`,status:404},
 {name:'grant',table:'project_memberships',column:'user_id',id:worker,set:`status='revoked'`,reset:`status='active'`,status:404},
 {name:'assignment',table:'employee_project_assignments',column:'employee_id',id:employee,set:`status='revoked'`,reset:`status='active'`,status:404}
];
test('real PostgreSQL gates: reservation and attachment initial/replay reread current role link grant archive and assignment after waits',async()=>{
 const file=await ready(),attached=eventAttachment();assert.equal((await req(path(file.fileId)+'/attachment',attached)).status,201);
 for(const change of authorityChanges){
  for(const operation of ['reserve','reserveReplay','attach','attachReplay'] as const){
   const b=reservation(),target=operation==='attach'?await ready():file;
   if(operation==='reserveReplay')await reserve(b);
   const body=operation==='reserve'||operation==='reserveReplay'?b:operation==='attachReplay'?attached:eventAttachment();
   const url=operation==='reserve'||operation==='reserveReplay'?path():path(target.fileId)+'/attachment';
   const c=await admin.connect(),projectClause=['project_memberships','employee_project_assignments'].includes(change.table)?` AND project_id='${p}'`:'';let pending:Promise<any>|undefined;
   const where=`tenant_id=$1 AND ${change.column}=$2${projectClause}`;
   try{
    await c.query('BEGIN');await c.query(`SELECT 1 FROM ${change.table} WHERE ${where} FOR NO KEY UPDATE`,[tenant,change.id]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
    pending=req(url,body);await waiters(pid);await c.query(`UPDATE ${change.table} SET ${change.set} WHERE ${where}`,[tenant,change.id]);await c.query('COMMIT');const r=await pending;assert.equal(r.status,change.status,change.name+' '+operation+JSON.stringify(r));
    if(operation==='reserve')assert.equal((await admin.query(`SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND request_id=$2`,[tenant,b.requestId])).rows[0].n,0);
    if(operation==='attach')assert.equal((await effects(target.fileId)).attachments,0);
   }finally{await c.query('ROLLBACK');c.release();await pending;await admin.query(`UPDATE ${change.table} SET ${change.reset} WHERE ${where}`,[tenant,change.id]);}
  }
 }
});
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
async function limit<T>(promise:Promise<T>){let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('paused I/O authority operation blocked')),4000);})]);}finally{clearTimeout(timer!);}}
test('fresh post-I/O authority: paused real upload/download/attachment allow ACL changes, then deny bytes or effects after role grant/link revocation',async()=>{
 const storage=app!.get(EvidenceStorage);
 for(const operation of ['upload','readyRetry','download','attach'] as const){for(const change of ['role','grant','link'] as const){
  const actor=change==='role'?director:change==='grant'?master:worker,b=reservation(png,actor===master?{onBehalfReason:'Help worker'}:{});
  if(operation==='upload')await reserve(b,actor);else await ready(b,actor);
  const method=operation==='upload'||operation==='readyRetry'?'put':'get',original=(storage as any)[method],entered=deferred(),release=deferred();let pending:Promise<any>|undefined;
  (storage as any)[method]=async(...args:any[])=>{const result=await original.apply(storage,args);entered.resolve();await release.promise;return result;};
  const mutate=change==='role'?`UPDATE memberships SET role='worker' WHERE tenant_id=$1 AND user_id='${director}'`:change==='grant'?`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id='${p}' AND user_id='${master}'`:`UPDATE employees SET user_id=NULL WHERE tenant_id=$1 AND id='${employee}'`;
  const reset=change==='role'?`UPDATE memberships SET role='director' WHERE tenant_id=$1 AND user_id='${director}'`:change==='grant'?`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id='${p}' AND user_id='${master}'`:`UPDATE employees SET user_id='${worker}' WHERE tenant_id=$1 AND id='${employee}'`;
  try{
   pending=operation==='upload'||operation==='readyRetry'?put(b.fileId,png,actor):operation==='download'?download(b.fileId,actor):req(path(b.fileId)+'/attachment',{...eventAttachment(),...(actor===master?{onBehalfReason:'Help worker'}:{})},actor);
   await limit(entered.promise);await limit(admin.query(mutate,[tenant]));release.resolve();const r=await limit(pending);assert.equal(r.status,404,operation+' '+change+JSON.stringify(r));
   if(operation==='download')assert.ok(!r.bytes.equals(png));
   assert.equal((await effects(b.fileId)).attachments,0);if(operation==='upload'){assert.equal((await effects(b.fileId)).ready,0);assert.deepEqual(await readFile(join(root,tenant,b.fileId)),png);}
  }finally{release.resolve();await pending;(storage as any)[method]=original;await admin.query(reset,[tenant]);}
  if(operation==='upload')assert.equal((await put(b.fileId,png,actor)).status,200);
 }}
});
test('metadata/list/download current ACL after PostgreSQL waits and manager grant replay wait fail closed',async()=>{
 const b=await ready(),saved=await reserve(reservation(png,{onBehalfReason:'Assist'}),master);
 for(const [url,method]of [[path(b.fileId),'get'],[path(),'get'],[path(b.fileId)+'/content','get'],[path(),'replay']] as const){
  const c=await admin.connect();let pending:Promise<any>|undefined;try{await c.query('BEGIN');await c.query(`SELECT 1 FROM projects WHERE tenant_id=$1 AND id=$2 FOR NO KEY UPDATE`,[tenant,p]);const pid=(await c.query(`SELECT pg_backend_pid() pid`)).rows[0].pid;
   pending=req(url,method==='replay'?saved:undefined,master);await waiters(pid);await c.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]);await c.query('COMMIT');assert.equal((await pending).status,404);
  }finally{await c.query('ROLLBACK');c.release();await pending;await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3`,[tenant,p,master]);}
 }
});
test('concurrent metadata receipts and immutable binding converge once, exact original reservation replay survives ready and attached states',async()=>{
 const b=reservation(),reservations=await Promise.all([req(path(),b),req(path(),b)]);assert.deepEqual(reservations[0],reservations[1]);assert.equal(reservations[0].status,201);assert.equal(reservations[0].body.state,'pending');
 assert.equal((await req(path(),{...b,requestId:id()})).status,201);assert.equal((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND object_id=$2 AND action='evidence_reserved'`,[tenant,b.fileId])).rows[0].n,1);
 assert.equal((await put(b.fileId)).status,200);const command=eventAttachment(),duplicates=await Promise.all([req(path(b.fileId)+'/attachment',command),req(path(b.fileId)+'/attachment',command)]);assert.deepEqual(duplicates[0],duplicates[1]);assert.equal(duplicates[0].status,201);assert.deepEqual(await req(path(),b),reservations[0]);
 const f=await ready(),conflict=await Promise.all([req(path(f.fileId)+'/attachment',eventAttachment()),req(path(f.fileId)+'/attachment',{requestId:id(),target:{kind:'final_report',reportId}})]);assert.deepEqual(conflict.map(r=>r.status).sort(),[201,409]);
 for(const file of [f.fileId,b.fileId]){assert.equal((await effects(file)).attachments,1);assert.equal((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND object_id=$2 AND action='evidence_attached'`,[tenant,file])).rows[0].n,1);}
 assert.equal((await req(path(),reservation(png,{requestId:eventRequest}))).status,409);
 const g=await ready();assert.equal((await req(path(g.fileId)+'/attachment',{...eventAttachment(),requestId:g.requestId})).status,409);assert.equal((await effects(g.fileId)).attachments,0);
});
test('attachment audit failure rolls back binding audit and receipt together; exact retry commits once without changing bytes',async()=>{
 const b=await ready(),command=eventAttachment(),fn=`evidence_attach_fail_${id().replaceAll('-','')}`,before=(await stat(join(root,tenant,b.fileId))).ino;
 await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.object_id='${b.fileId}' AND NEW.action='evidence_attached' THEN RAISE EXCEPTION 'injected attachment audit failure'; END IF; RETURN NEW; END $$`);
 try{await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);assert.equal((await req(path(b.fileId)+'/attachment',command)).status,500);assert.equal((await effects(b.fileId)).attachments,0);assert.equal((await admin.query(`SELECT count(*)::int n FROM people_command_receipts WHERE tenant_id=$1 AND actor_user_id=$2 AND request_id=$3`,[tenant,worker,command.requestId])).rows[0].n,0);}finally{await admin.query(`DROP TRIGGER IF EXISTS ${fn} ON audit_log`);await admin.query(`DROP FUNCTION ${fn}()`);}
 assert.equal((await req(path(b.fileId)+'/attachment',command)).status,201);assert.equal((await stat(join(root,tenant,b.fileId))).ino,before);assert.deepEqual((await download(b.fileId)).bytes,png);assert.equal((await effects(b.fileId)).attachments,1);
});

test('strict evidence contract covers reservation, both target forms, binary media and actual errors',async()=>{
 const schemas=publicContract.components.schemas,contractRoot='/api/v1/projects/{p}/evidence';
 const sample=reservation(png,{onBehalfReason:'Record evidence'});matchesContract(sample,schemas.EvidenceReservationInput);
 for(const extra of [{actorUserId:worker},{sizeBytes:0},{sizeBytes:8388609},{sha256:'A'.repeat(64)},{contentType:'text/html'},{filename:'\u0001bad'},{filename:''}])assert.throws(()=>matchesContract({...sample,...extra},schemas.EvidenceReservationInput));
 for(const key of ['requestId','fileId','employeeId','filename','contentType','sizeBytes','sha256']){const missing={...sample};delete missing[key];assert.throws(()=>matchesContract(missing,schemas.EvidenceReservationInput),key);}
 const event=eventAttachment(),report={requestId:id(),target:{kind:'final_report',reportId:id()}};
 for(const form of [event,report]){matchesContract(form,schemas.EvidenceAttachmentInput);assert.throws(()=>matchesContract({...form,target:{...form.target,forged:true}},schemas.EvidenceAttachmentInput));}
 assert.throws(()=>matchesContract({...event,target:{...event.target,reportId:id()}},schemas.EvidenceAttachmentInput));
 assert.equal(schemas.EvidenceTarget.oneOf.length,2);
 const put=publicContract.paths[contractRoot+'/{file}/content'].put,get=publicContract.paths[contractRoot+'/{file}/content'].get;
 assert.deepEqual(Object.keys(put.requestBody.content),['application/octet-stream']);assert.equal(put.requestBody.required,true);assert.equal(put.requestBody.content['application/octet-stream'].schema.maxLength,8388608);
 assert.deepEqual(Object.keys(get.responses['200'].content).sort(),['application/pdf','image/jpeg','image/png']);
 for(const op of [publicContract.paths[contractRoot].post,publicContract.paths[contractRoot].get,publicContract.paths[contractRoot+'/{file}'].get,put,get,publicContract.paths[contractRoot+'/{file}/attachment'].post])for(const code of ['400','401','403','404','500'])assert.ok(op.responses[code]);
 for(const code of ['413','415','422','503'])assert.ok(put.responses[code]);
 const response=await fetch(`${base}/api/v1/projects/${p}/evidence`);const body=await response.json();assert.equal(response.status,401);checkHttpContract('/api/v1/projects/'+p+'/evidence','GET',401,body,response.headers);
});
