// Owned real Nest/PostgreSQL fixture. Controls are private IPC, never HTTP routes.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID as id} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const apiRequire=createRequire(join(root,'apps/api/package.json'));
apiRequire('reflect-metadata');
const {Pool}=apiRequire('pg');
const {NestFactory}=apiRequire('@nestjs/core');
const appUrl='postgres://helios_app:helios_app@127.0.0.1:54339/helios';
const adminUrl='postgres://helios:helios@127.0.0.1:54339/helios';
assert.equal(process.env.DATABASE_URL,appUrl);
assert.equal(process.env.ADMIN_DATABASE_URL,adminUrl);
assert.equal(process.env.HELIOS_DB_PORT,'54339');
assert.equal(process.env.API_PORT,'4327');
assert.ok(process.send,'Fixture requires private IPC');
const admin=new Pool({connectionString:adminUrl}),restricted=new Pool({connectionString:appUrl});
const owned:any[]=[];
let app:any,storage:string|undefined,base:string,preflight=false,closing=false;
const {hashPassword}=await import('../../../apps/api/src/password.js');

async function identity(){
  const actual=(await admin.query(`SELECT current_database() db,current_user usr,inet_server_port() port,current_setting('data_directory') dir`)).rows[0];
  assert.deepEqual(actual,{db:'helios',usr:'helios',port:54339,dir:join(root,'.data/pg-54339')});
  const appIdentity=(await restricted.query(`SELECT current_database() db,current_user usr,inet_server_port() port,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(appIdentity,{db:'helios',usr:'helios_app',port:54339,rolsuper:false,rolbypassrls:false});
  preflight=true;
}
async function request(f:any,path:string,body?:any,user=f.director,method=body===undefined?'GET':'POST'){
  const r=await fetch(base+'/api/v1'+path,{method,headers:{authorization:`Bearer ${f.tokens[user]}`,'x-tenant-id':f.tenantId,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const expected=method==='POST'&&path!=='/execution/events'&&!/\/(submit|publish)$/.test(path)?201:200;
  const answer=await r.json();assert.equal(r.status,expected,JSON.stringify(answer));return answer;
}
async function create(){
  assert.ok(preflight);
  const f:any={tenantId:id(),actorUserId:id(),director:id(),master:id(),projectId:id(),org:id(),tokens:{}};
  owned.push(f); // Register ownership before the first write, including partial setup failures.
  const users=[f.actorUserId,f.director,f.master];
  await admin.query(`INSERT INTO tenants(id,name,timezone) VALUES($1,'Offline browser fixture','Europe/Moscow')`,[f.tenantId]);
  for(const u of users)await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Offline fixture',$3)`,[u,`${u}@offline.test`,hashPassword('offline-fixture-password')]);
  for(const [u,role]of [[f.actorUserId,'worker'],[f.director,'director'],[f.master,'master']])await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[f.tenantId,u,role]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Offline fixture')`,[f.tenantId,f.org]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Offline fixture')`,[f.tenantId,f.projectId]);
  for(const u of users){
    const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${u}@offline.test`,password:'offline-fixture-password'})});
    assert.equal(r.status,201);f.tokens[u]=(await r.json()).token;
  }
  const command=(b:any)=>({requestId:id(),...b}),p=`/projects/${f.projectId}`;
  await request(f,`${p}/memberships/${f.master}`,command({expectedVersion:0,status:'active'}),f.director,'PUT');
  f.employeeId=(await request(f,'/employees',command({fullName:'Offline browser worker',organizationId:f.org,userId:f.actorUserId}))).id;
  const template=await request(f,`${p}/admission-template`,command({code:'safe',title:'Admission',items:[{id:'safe',label:'Safe',critical:true}],requiredQualificationCodes:[]}));
  const check=await request(f,`/employees/${f.employeeId}/admission-checks`,command({projectId:f.projectId,templateVersion:template.version,answers:[{itemId:'safe',value:true}]}));
  await request(f,`${p}/assignments/${f.employeeId}`,command({expectedVersion:0,status:'active',admissionCheckId:check.id}),f.director,'PUT');
  const zone=await request(f,`${p}/zones`,command({name:'Offline zone'}));
  const type=await request(f,`${p}/work-types`,command({name:'Concrete',unit:'m3',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
  const front=await request(f,`${p}/front-template`,command({code:'front',title:'Front',items:[{id:'ready',label:'Ready',critical:true}]}));
  let task=await request(f,`${p}/tasks`,command({zoneId:zone.id,workTypeId:type.id,title:'Offline published task',workDate:'2027-01-15',plannedQuantity:'12.340',assigneeEmployeeId:f.employeeId,responsibleUserId:f.master,plannedStart:'2027-01-15T09:00:00+03:00',plannedEnd:'2027-01-15T10:00:00+03:00',rdReference:null}));
  await request(f,`${p}/tasks/${task.id}/front-checks`,command({expectedVersion:task.version,templateVersion:front.version,answers:[{itemId:'ready',value:true}]}));
  task=await request(f,`${p}/tasks/${task.id}`);
  for(const action of ['submit','publish'])task=await request(f,`${p}/tasks/${task.id}/${action}`,command({expectedVersion:task.version}));
  f.taskId=task.id;
  return {tenantId:f.tenantId,actorUserId:f.actorUserId,employeeId:f.employeeId,projectId:f.projectId,taskId:f.taskId,token:f.tokens[f.actorUserId]};
}
function fixture(tenant:string){const f=owned.find(f=>f.tenantId===tenant);assert.ok(f,'IPC can only address owned fixtures');return f;}
async function handle(method:string,args:any){
  if(method==='create')return create();
  const f=fixture(args.tenantId);
  if(method==='revoke'){await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[f.tenantId,f.actorUserId]);return true;}
  if(method==='expire'){await admin.query(`UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1`,[f.actorUserId]);return true;}
  if(method==='advance'){
    const command={kind:'shift_start',requestId:id(),employeeId:f.employeeId,projectId:f.projectId,shiftId:id(),expectedVersion:0,occurredAt:'2027-01-15T08:00:00+03:00'};
    const r=await request(f,'/execution/events',{events:[command]},f.actorUserId,'POST');assert.equal(r.results[0].outcome,'success');return command;
  }
  if(method==='snapshot'){
    const events=(await admin.query(`SELECT request_id,original_payload,version::int FROM managed_execution_events WHERE tenant_id=$1 ORDER BY version`,[f.tenantId])).rows;
    const receipts=(await admin.query(`SELECT request_id,operation,result FROM people_command_receipts WHERE tenant_id=$1`,[f.tenantId])).rows;
    const audits=(await admin.query(`SELECT action,object_id,details FROM audit_log WHERE tenant_id=$1`,[f.tenantId])).rows;
    const files=(await admin.query(`SELECT id,state,sha256 FROM private_evidence_files WHERE tenant_id=$1`,[f.tenantId])).rows;
    const attachments=(await admin.query(`SELECT * FROM private_evidence_attachments WHERE tenant_id=$1`,[f.tenantId])).rows;
    const reports=(await admin.query(`SELECT report_id AS id,submitted_quantity::text quantity FROM managed_execution_reports WHERE tenant_id=$1`,[f.tenantId])).rows;
    const segments=(await admin.query(`SELECT mode,extract(epoch FROM ended_at-started_at)*1000 AS ms FROM managed_segments WHERE tenant_id=$1 ORDER BY started_at`,[f.tenantId])).rows;
    return {events,receipts,audits,files,attachments,reports,segments};
  }
  throw new Error('Unsupported private fixture command');
}
async function cleanup(){
  if(closing)return;closing=true;
  try{await app?.close();}finally{
    try{if(preflight&&owned.length){
      const tenants=owned.map(f=>f.tenantId),users=owned.flatMap(f=>[f.actorUserId,f.director,f.master]);
      const c=await admin.connect();try{
        await c.query('BEGIN');await c.query('SET CONSTRAINTS ALL DEFERRED');
        for(const table of ['private_evidence_attachments','private_evidence_files','managed_execution_reports','managed_execution_events','managed_segments','managed_shifts','managed_execution_streams','task_publication_snapshots','task_front_checks','front_template_versions','front_templates','daily_tasks','project_work_zones','project_work_types','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','project_memberships','employee_qualifications','people_command_receipts','employees','memberships','projects','organizations','audit_log'])await c.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[tenants]);
        await c.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[tenants]);await c.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await c.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);await c.query('COMMIT');
        assert.equal((await c.query(`SELECT count(*)::int n FROM tenants WHERE id=ANY($1::uuid[])`,[tenants])).rows[0].n,0);
        assert.equal((await c.query(`SELECT count(*)::int n FROM users WHERE id=ANY($1::uuid[])`,[users])).rows[0].n,0);
      }finally{await c.query('ROLLBACK');c.release();}
    }}finally{await Promise.all([admin.end(),restricted.end()]);if(storage)await rm(storage,{recursive:true,force:true});}
  }
}
try{
  await identity();storage=await mkdtemp(join(tmpdir(),'helios-offline-real-'));process.env.HELIOS_EVIDENCE_ROOT=storage;
  const {AppModule}=await import('../../../apps/api/src/app.module.js');
  const {AllExceptionsFilter}=await import('../../../apps/api/src/http.js');
  app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());
  const listener=await app.listen(0,'127.0.0.1');base=`http://127.0.0.1:${listener.address().port}`;
  process.send!({ready:true,base,pid:process.pid});
  let tail=Promise.resolve();
  process.on('message',(message:any)=>{tail=tail.then(async()=>{
    try{if(message.method==='close'){await cleanup();process.send!({id:message.id,result:{cleaned:true,fixtures:owned.length}},()=>process.disconnect());return;}
      process.send!({id:message.id,result:await handle(message.method,message.args)});
    }catch(error){process.send!({id:message.id,error:error instanceof Error?error.message:String(error)});}
  });});
  process.on('disconnect',()=>{void tail.then(cleanup).catch(error=>{console.error(error);process.exitCode=1;});});
}catch(error){try{await cleanup();}finally{console.error(error);process.exitCode=1;process.disconnect?.();}}
