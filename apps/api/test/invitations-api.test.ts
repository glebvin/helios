import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import test from 'node:test';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module.js';
import {createPool,adminUrl,withTenant} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {AllExceptionsFilter} from '../src/http.js';
import {checkHttpContract} from './contract-check.js';
import {authProtection} from '../src/auth-protection.js';
const admin=createPool(adminUrl), restricted=createPool();
const tenant=id(),foreign=id(),org=id(),foreignOrg=id(),project=id(),otherProject=id(),foreignProject=id();
const director=id(),master=id(),worker=id(),pto=id(),outsider=id();
const users=[director,master,worker,pto,outsider];const tokens=new Map<string,string>();
let app:any,base:string;
async function req(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST',scope=tenant){
  const r=await fetch(base+'/api/v1'+path,{method,headers:{'content-type':'application/json',authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':scope},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();checkHttpContract('/api/v1'+path,method,r.status,value,r.headers);return {status:r.status,body:value};
}
async function issue(role='worker',user=director,extras:any={}){const r=await req('/invitations',{role,projectId:project,organizationId:org,requestId:id(),...extras},user);assert.equal(r.status,201,JSON.stringify(r));return r.body;}
const person=(extras:any={})=>({name:'QA Новый человек',email:`${id()}@invite.test`,password:'test-password-2026',...extras});
test.before(async()=>{
  await admin.query(`INSERT INTO tenants(id,name) VALUES($1,'Invitation QA'),($2,'Foreign')`,[tenant,foreign]);
  await admin.query(`INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','QA'),($3,$4,'own','Foreign')`,[tenant,org,foreign,foreignOrg]);
  await admin.query(`INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'QA project'),($1,$3,'No master access'),($4,$5,'Foreign')`,[tenant,project,otherProject,foreign,foreignProject]);
  for(const [u,role] of [[director,'director'],[master,'master'],[worker,'worker'],[pto,'pto'],[outsider,'director']]){
    await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'QA',$3)`,[u,`${u}@invite.test`,hashPassword('fixture-password')]);
    await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)`,[u===outsider?foreign:tenant,u,role]);
  }
  await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`,[tenant,project,master]);
  app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());await app.listen(0,'127.0.0.1');base=await app.getUrl();
  for(const u of users){const r=await req('/auth/login',{email:`${u}@invite.test`,password:'fixture-password'});assert.equal(r.status,201);tokens.set(u,r.body.token);}
});
test.after(async()=>{
  await app?.close();
  try{
    const created=(await admin.query(`SELECT consumed_by FROM invitations WHERE tenant_id=$1 AND consumed_by IS NOT NULL`,[tenant])).rows.map(r=>r.consumed_by);users.push(...created);
    await admin.query(`DELETE FROM invitation_locator WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
    for(const t of ['invitations','project_memberships','employees','memberships','projects','organizations','audit_log'])await admin.query(`DELETE FROM ${t} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
    await admin.query(`DELETE FROM tenants WHERE id=ANY($1::uuid[])`,[[tenant,foreign]]);
    await admin.query(`DELETE FROM sessions WHERE user_id=ANY($1::uuid[])`,[users]);await admin.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`,[users]);
  }finally{await admin.end();await restricted.end();}
});

test('worker invitation: atomic user, membership, employee, session; inspect consumes nothing',async()=>{
  const i=await issue();assert.match(i.code,/^[A-HJ-NP-Z2-9]{12}$/);
  const info=await req(`/join/${i.code}`);assert.equal(info.status,200);assert.equal(info.body.role,'worker');assert.deepEqual(Object.keys(info.body).sort(),['expiresAt','projectName','role']);
  assert.equal((await req(`/join/${i.code}`)).status,200);
  const b=person({email:`UPPER-${id()}@invite.test`});const r=await req(`/join/${i.code}`,b);assert.equal(r.status,201,JSON.stringify(r));
  assert.equal(r.body.user.email,b.email.toLowerCase());assert.equal(r.body.memberships[0].role,'worker');
  const u=r.body.user.id;const e=await admin.query(`SELECT * FROM employees WHERE user_id=$1`,[u]);assert.equal(e.rowCount,1);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM employee_project_assignments WHERE employee_id=$1`,[e.rows[0].id])).rows[0].n,0,'registration must not bypass admission');
  tokens.set(u,r.body.token);const me=await req('/me',undefined,u);assert.equal(me.body.role,'worker');
  assert.equal((await req('/invitations',{role:'master',projectId:project,organizationId:org,requestId:id()},u)).status,403);
  assert.equal((await req(`/join/${i.code}`)).status,410);
  assert.equal((await req(`/join/${i.code}`,person())).body.error,'invitation_used');
  const logged=await req('/auth/login',{email:b.email,password:b.password});assert.equal(logged.status,201);assert.equal(logged.body.user.id,u);
  assert.equal((await req('/auth/logout',{},u)).status,201);assert.equal((await req('/me',undefined,u)).status,401);
  const roster=await req(`/projects/${project}/invitations`);assert.equal(roster.body.members.filter((m:any)=>m.id===e.rows[0].id).length,1);assert.equal(roster.body.items.find((x:any)=>x.id===i.id).code,null);
});
test('director creates master; new master may invite workers, never masters',async()=>{
  const i=await issue('master');const r=await req(`/join/${i.code}`,person());assert.equal(r.status,201);const u=r.body.user.id;tokens.set(u,r.body.token);
  await issue('worker',u);assert.equal((await req('/invitations',{role:'master',projectId:project,organizationId:org,requestId:id()},u)).status,403);
});
test('8 concurrent accepts consume exactly once and leave no orphan users',async()=>{
  const i=await issue();const people=Array.from({length:8},()=>person());const r=await Promise.all(people.map(b=>req(`/join/${i.code}`,b)));
  assert.equal(r.filter(x=>x.status===201).length,1);assert.equal(r.filter(x=>x.status===410).length,7);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM users WHERE email=ANY($1::text[])`,[people.map(p=>p.email)])).rows[0].n,1);
});
test('creation retries are idempotent; altered payload is rejected',async()=>{
  const b={role:'worker',projectId:project,organizationId:org,requestId:id()};const r=await Promise.all(Array.from({length:6},()=>req('/invitations',b)));
  r.forEach(x=>{assert.equal(x.status,201);assert.deepEqual(x.body,r[0].body);});assert.equal((await req('/invitations',{...b,role:'master'})).status,409);
});
test('rotation revokes previous code, repeats safely; consumed code cannot rotate',async()=>{
  const i=await issue();const b={requestId:id()};const r=await req(`/invitations/${i.id}/refresh`,b);assert.equal(r.status,201);assert.notEqual(i.code,r.body.code);
  assert.deepEqual((await req(`/invitations/${i.id}/refresh`,b)).body,r.body);assert.equal((await req(`/join/${i.code}`,person())).body.error,'invitation_revoked');
  assert.equal((await req(`/join/${r.body.code}`,person())).status,201);assert.equal((await req(`/invitations/${r.body.id}/refresh`,{requestId:id()})).body.error,'invitation_used');
});
test('parallel refresh and redemption cannot both use old code',async()=>{
  const i=await issue();const r=await Promise.all([req(`/invitations/${i.id}/refresh`,{requestId:id()}),req(`/join/${i.code}`,person())]);assert.equal(r.filter(x=>x.status===201).length,1);assert.equal(r.filter(x=>x.status===410).length,1);
});
test('existing email and case variant never change an account or consume code',async()=>{
  const i=await issue();assert.equal((await req(`/join/${i.code}`,person({email:`${director}@INVITE.TEST`}))).status,409);
  assert.equal((await req(`/join/${i.code}`)).status,200);assert.equal((await req('/auth/login',{email:`${director}@invite.test`,password:'fixture-password'})).status,201);
});
test('two distinct codes racing for same normalized email create only one account',async()=>{
  const a=await issue(),b=await issue();const p=person();const r=await Promise.all([req(`/join/${a.code}`,p),req(`/join/${b.code}`,{...p,email:p.email.toUpperCase()})]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM users WHERE lower(email)=$1`,[p.email])).rows[0].n,1);
});
test('expiry is enforced at inspect and redemption, and can be refreshed',async()=>{
  const i=await issue();await admin.query(`UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1`,[i.id]);
  for(const b of [undefined,person()])assert.equal((await req(`/join/${i.code}`,b)).body.error,'invitation_expired');
  assert.equal((await req(`/invitations/${i.id}/refresh`,{requestId:id()})).status,201);
});
test('revoked issuer membership invalidates unused codes',async()=>{
  const i=await issue('worker',master);await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);
  try{assert.equal((await req(`/join/${i.code}`,person())).status,403);}finally{await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);}
});
test('revoked project membership invalidates master invitation',async()=>{
  const i=await issue('worker',master);await admin.query(`UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);
  try{assert.equal((await req(`/join/${i.code}`,person())).status,403);}finally{await admin.query(`UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);}
});
test('role, tenant, project, organization boundaries and public listing protection',async()=>{
  for(const u of [worker,pto]){assert.equal((await req('/invitations',{role:'worker',projectId:project,organizationId:org,requestId:id()},u)).status,403);assert.equal((await req(`/projects/${project}/invitations`,undefined,u)).status,403);}
  assert.equal((await req('/invitations',{role:'master',projectId:project,organizationId:org,requestId:id()},master)).status,403);
  assert.equal((await req('/invitations',{role:'worker',projectId:otherProject,organizationId:org,requestId:id()},master)).status,403);
  assert.equal((await req('/invitations',{role:'worker',projectId:foreignProject,organizationId:org,requestId:id()})).status,404);
  assert.equal((await req('/invitations',{role:'worker',projectId:project,organizationId:foreignOrg,requestId:id()})).status,422);
  const i=await issue();assert.equal((await req(`/invitations/${i.id}/refresh`,{requestId:id()},outsider,undefined,foreign)).status,404);
  assert.equal((await req(`/projects/${project}/invitations`,undefined,outsider,undefined,foreign)).status,404);
  const anonymous=await fetch(base+`/api/v1/projects/${project}/invitations`);assert.equal(anonymous.status,401);
  const rows=await withTenant(restricted,foreign,outsider,c=>c.query(`SELECT * FROM invitations`));assert.equal(rows.rowCount,0);
});
test('unknown codes, malformed data and role injection fail without consuming invitation',async()=>{
  assert.equal((await req('/join/AAAAAAAAAAAA')).status,404);assert.equal((await req('/join/not-a-code')).status,404);
  const i=await issue();for(const b of [null,[],person({role:'director'}),person({name:''}),person({name:'a\n b'}),person({email:'bad'}),person({password:'short'}),person({password:' '.repeat(10)}),person({password:'x'.repeat(129)})])assert.equal((await req(`/join/${i.code}`,b)).status,400,JSON.stringify(b));
  assert.equal((await req(`/join/${i.code}`)).status,200);
  for(const role of ['director','pto','admin','WORKER',null])assert.equal((await req('/invitations',{role,projectId:project,organizationId:org,requestId:id()})).status,400);
});
test('audit does not contain passwords or bearer codes',async()=>{
  const rows=await admin.query(`SELECT * FROM audit_log WHERE tenant_id=$1 AND object_type='invitation'`,[tenant]);assert.ok(rows.rowCount!>0);const s=JSON.stringify(rows.rows);assert.equal(s.includes('test-password'),false);assert.equal(s.includes('token'),false);
});
test('public auth limiter covers login, invitation lookup and redemption and no-store',()=>{
  const middleware=authProtection();for(const [path,method,limit] of [['/api/v1/auth/login','POST',40],['/api/v1/join/AAAAAAAAAAAA','POST',40],['/api/v1/join/AAAAAAAAAAAA','GET',200]] as const){let calls=0;const headers:any={};let status=0;const res:any={setHeader:(k:string,v:any)=>headers[k]=v,status:(n:number)=>{status=n;return res;},json:()=>{}};for(let n=0;n<limit+1;n++)middleware({path,method},res,()=>calls++);assert.equal(calls,limit);assert.equal(status,429);assert.equal(headers['Cache-Control'],'no-store');assert.ok(headers['Retry-After']>0);}
});

test('failed audit rolls back account, employee, session and consumption together',async()=>{
  const i=await issue(),p=person(),fn='invite_fail_'+id().replaceAll('-','');
  await admin.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tenant_id='${tenant}'::uuid AND NEW.action='invitation.accepted' THEN RAISE EXCEPTION 'injected invitation audit failure'; END IF; RETURN NEW; END $$`);
  await admin.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
  try{const r=await req(`/join/${i.code}`,p);assert.equal(r.status,500);assert.equal((await admin.query(`SELECT count(*)::int n FROM users WHERE email=$1`,[p.email])).rows[0].n,0);assert.equal((await req(`/join/${i.code}`)).status,200);}
  finally{await admin.query(`DROP TRIGGER ${fn} ON audit_log; DROP FUNCTION ${fn}()`);}
  assert.equal((await req(`/join/${i.code}`,p)).status,201);
});

test('legacy desk and object editing respect master project boundary',async()=>{
  const u=id(),e=id();users.push(u);
  await admin.query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Hidden other project',$3)`,[u,`${u}@invite.test`,hashPassword('fixture-password')]);
  await admin.query(`INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'worker')`,[tenant,u]);
  await admin.query(`INSERT INTO employees(tenant_id,id,user_id,organization_id,full_name) VALUES($1,$2,$3,$4,'Hidden other project')`,[tenant,e,u,org]);
  await admin.query(`INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)`,[tenant,otherProject,u]);
  const headers={authorization:`Bearer ${tokens.get(master)}`,'x-tenant-id':tenant,'content-type':'application/json'};
  const desk=await (await fetch(base+'/api/desk',{headers})).json();assert.equal(desk.projects.some((p:any)=>p.id===otherProject),false);assert.equal(desk.employees.some((x:any)=>x.id===e),false);
  assert.equal((await fetch(base+`/api/employees/${e}`,{headers})).status,404);
  assert.equal((await fetch(base+`/api/projects/${otherProject}/place`,{method:'POST',headers,body:JSON.stringify({address:'Forbidden',latitude:55,longitude:37})})).status,404);
});
