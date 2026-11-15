import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {mkdirSync, readFileSync} from 'node:fs';
import test from 'node:test';
const qaDir=new URL('../../../.data/phone-qa/', import.meta.url).pathname;
mkdirSync(qaDir,{recursive:true});
process.env.HELIOS_PHONE_PROVIDER='synthetic';
process.env.HELIOS_PHONE_CODE_SECRET='qa-phone-secret-0123456789abcdef';
process.env.HELIOS_PHONE_QA_DIR=qaDir;
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
let app:any,base:string,started:Date;
async function req(path:string,body?:unknown,user=director,method=body===undefined?'GET':'POST',scope=tenant){
  const r=await fetch(base+'/api/v1'+path,{method,headers:{'content-type':'application/json',authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':scope},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await r.json();checkHttpContract('/api/v1'+path,method,r.status,value,r.headers);return {status:r.status,body:value};
}
async function issue(role='worker',user=director,extras:any={}){const r=await req('/invitations',{role,projectId:project,organizationId:org,requestId:id(),...extras},user);assert.equal(r.status,201,JSON.stringify(r));return r.body;}
const person=(extras:any={})=>({name:'QA Новый человек',email:`${id()}@invite.test`,password:'test-password-2026',...extras});
const mobile=()=>`+79${String(Math.floor(Math.random()*1e9)).padStart(9,'0')}`;
function qaCode(phone:string){const code=JSON.parse(readFileSync(`${qaDir}/codes.json`,'utf8'))[phone];assert.equal(/^\d{6}$/.test(code),true);return code as string;}
function hides(value:unknown,secret:string){assert.equal(JSON.stringify(value).includes(secret),false);}
async function age(phone:string){await admin.query(`UPDATE phone_challenges SET created_at=now()-interval '2 minutes' WHERE phone=$1`,[phone]);}
test.before(async()=>{
  started=(await admin.query(`SELECT now() AS t`)).rows[0].t;
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
    await admin.query(`DELETE FROM phone_challenges WHERE created_at >= $1`,[started]);
    await admin.query(`DELETE FROM phone_identities WHERE user_id=ANY($1::uuid[])`,[users]);
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
test('public auth limiter covers invitation lookup and redemption and no-store',()=>{
  const middleware=authProtection({install:false});for(const [path,method,limit] of [['/api/v1/join/AAAAAAAAAAAA','POST',40],['/api/v1/join/AAAAAAAAAAAA','GET',200]] as const){let calls=0;const headers:any={};let status=0;const res:any={setHeader:(k:string,v:any)=>headers[k]=v,status:(n:number)=>{status=n;return res;},json:()=>{}};for(let n=0;n<limit+1;n++)middleware({path,method},res,()=>calls++);assert.equal(calls,limit);assert.equal(status,429);assert.equal(headers['Cache-Control'],'no-store');assert.ok(headers['Retry-After']>0);}
  let loginCalls=0;for(let n=0;n<41;n++)middleware({path:'/api/v1/auth/login',method:'POST',headers:{'x-forwarded-for':'203.0.113.8'}},{setHeader:()=>undefined,status:()=>({json:()=>undefined})},()=>{loginCalls+=1;});assert.equal(loginCalls,41);
  for(const path of ['/api/v1/auth/phone/challenge','/api/v1/auth/phone/login','/api/v1/join/AAAAAAAAAAAA/challenge']){const gate=authProtection({install:false});let calls=0,status=0;const headers:any={};const res:any={setHeader:(k:string,v:any)=>headers[k]=v,status:(n:number)=>{status=n;return res;},json:()=>{}};for(let n=0;n<41;n++)gate({path,method:'POST'},res,()=>calls++);assert.equal(calls,40);assert.equal(status,429);assert.equal(headers['Cache-Control'],'no-store');}
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

test('worker phone invitation opens the existing session and a later phone login',async()=>{
  const phone='8 (900) 111-22-33',normal='+79001112233';
  const created=await issue('worker',director,{phone});
  assert.equal(created.phoneMasked,'+7 ··· 33');assert.equal(JSON.stringify(created).includes(normal),false);
  const info=await req(`/join/${created.code}`);assert.equal(info.body.phoneMasked,'+7 ··· 33');assert.equal(JSON.stringify(info.body).includes(normal),false);
  assert.equal((await req(`/join/${created.code}`,person())).status,400);assert.equal((await req(`/join/${created.code}`)).status,200);
  const requestId=id();const first=await req(`/join/${created.code}/challenge`,{requestId});assert.equal(first.status,201);assert.deepEqual(first.body,{sent:true});
  const code=qaCode(normal);const repeat=await req(`/join/${created.code}/challenge`,{requestId});assert.equal(repeat.body.sent,true);assert.equal(qaCode(normal)===code,true);
  hides(first.body,code);hides(info.body,code);
  const joined=await req(`/join/${created.code}`,{name:'QA Новый человек',code});assert.equal(joined.status,201,joined.body.error);hides(joined.body,code);
  assert.equal(joined.body.user.email,null);assert.equal(joined.body.memberships[0].role,'worker');assert.match(joined.body.token,/^[0-9a-f]{64}$/);
  const user=joined.body.user.id;tokens.set(user,joined.body.token);
  const account=await admin.query(`SELECT email,password_hash FROM users WHERE id=$1`,[user]);assert.equal(account.rows[0].email,null);assert.equal(account.rows[0].password_hash,null);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM employees WHERE user_id=$1`,[user])).rows[0].n,1);
  assert.equal((await req('/me',undefined,user)).body.role,'worker');
  assert.equal((await req('/me',undefined,user,'GET',foreign)).status,403);
  assert.equal((await req('/auth/logout',{},user)).status,201);assert.equal((await req('/me',undefined,user)).status,401);
  await age(normal);const loginRequest=id();assert.equal((await req('/auth/phone/challenge',{phone:normal,requestId:loginRequest})).status,201);
  const again=await req('/auth/phone/login',{phone:normal,code:qaCode(normal)});assert.equal(again.status,201);assert.equal(again.body.user.id,user);hides(again.body,qaCode(normal));
  tokens.set(user,again.body.token);assert.equal((await req('/me',undefined,user)).status,200);
  assert.equal((await req('/auth/login',{email:`${director}@invite.test`,password:'fixture-password'})).status,201);
  const audit=JSON.stringify((await admin.query(`SELECT action,details,result FROM audit_log WHERE object_id=$1`,[created.id])).rows);assert.equal(audit.includes(code),false);
});

test('phone code is one-time, expiring, attempt-limited and not shared by concurrent requests',async()=>{
  const phone=mobile();const invite=await issue('worker',director,{phone});const badRequest=id();
  await req(`/join/${invite.code}/challenge`,{requestId:badRequest});const good=qaCode(phone);const bad=good==='000000'?'111111':'000000';
  assert.equal((await req(`/join/${invite.code}`,{name:'QA Новый человек',code:'12'})).status,400);
  assert.equal((await admin.query(`SELECT attempts FROM phone_challenges WHERE request_id=$1`,[badRequest])).rows[0].attempts,0);
  for(let n=0;n<4;n++)assert.equal((await req(`/join/${invite.code}`,{name:'QA Новый человек',code:bad})).body.error,'code_invalid');
  assert.equal((await admin.query(`SELECT attempts,consumed_at FROM phone_challenges WHERE request_id=$1`,[badRequest])).rows[0].attempts,4);
  assert.equal((await req(`/join/${invite.code}`,{name:'QA Новый человек',code:bad})).body.error,'code_invalid');
  assert.equal((await req(`/join/${invite.code}`,{name:'QA Новый человек',code:bad})).body.error,'code_used');
  assert.equal((await req(`/join/${invite.code}`)).status,200);
  await age(phone);await req(`/join/${invite.code}/challenge`,{requestId:id()});
  await admin.query(`UPDATE phone_challenges SET expires_at=now()-interval '1 second' WHERE phone=$1 AND consumed_at IS NULL`,[phone]);
  assert.equal((await req(`/join/${invite.code}`,{name:'QA Новый человек',code:qaCode(phone)})).body.error,'code_expired');
  assert.equal((await req(`/join/${invite.code}`)).status,200);
  await age(phone);const live=id();await req(`/join/${invite.code}/challenge`,{requestId:live});const code=qaCode(phone);
  await age(phone);await req(`/join/${invite.code}/challenge`,{requestId:id()});
  assert.equal((await req(`/join/${invite.code}`,{name:'QA Новый человек',code})).body.error,'code_invalid');
  const raced=await Promise.all([0,1].map(()=>req(`/join/${invite.code}`,{name:'QA Новый человек',code:qaCode(phone)})));
  assert.equal(raced.filter(item=>item.status===201).length,1);
  assert.equal(raced.filter(item=>item.status===201||item.status===401||item.status===410).length,2);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM phone_identities WHERE phone=$1`,[phone])).rows[0].n,1);
});

test('phone send limits, unknown numbers and delivery stay closed',async()=>{
  const phone=mobile();const same=id();
  assert.equal((await req('/auth/phone/challenge',{phone,requestId:same})).status,201);
  assert.equal((await req('/auth/phone/challenge',{phone,requestId:same})).status,201);
  assert.equal((await admin.query(`SELECT count(*)::int n FROM phone_challenges WHERE request_id=$1`,[same])).rows[0].n,1);
  assert.equal((await req('/auth/phone/challenge',{phone:mobile(),requestId:same})).status,409);
  assert.equal((await req('/auth/phone/challenge',{phone,requestId:id()})).status,429);
  for(let n=0;n<4;n++){await age(phone);assert.equal((await req('/auth/phone/challenge',{phone,requestId:id()})).status,201);}
  await age(phone);assert.equal((await req('/auth/phone/challenge',{phone,requestId:id()})).status,429);
  const unknown=mobile();await req('/auth/phone/challenge',{phone:unknown,requestId:id()});
  const denied=await req('/auth/phone/login',{phone:unknown,code:qaCode(unknown)});assert.equal(denied.status,401);assert.equal(denied.body.error,'unauthorized');hides(denied.body,qaCode(unknown));
  assert.equal((await admin.query(`SELECT count(*)::int n FROM phone_identities WHERE phone=$1`,[unknown])).rows[0].n,0);
  const known=mobile();const invite=await issue('worker',director,{phone:known});await req(`/join/${invite.code}/challenge`,{requestId:id()});
  const joined=await req(`/join/${invite.code}`,{name:'QA Новый человек',code:qaCode(known)});tokens.set(joined.body.user.id,joined.body.token);
  await age(known);const loginId=id();await req('/auth/phone/challenge',{phone:known,requestId:loginId});
  const wrong=qaCode(known)==='000000'?'111111':'000000';
  assert.equal((await req('/auth/phone/login',{phone:known,code:wrong})).body.error,'unauthorized');
  const raced=await Promise.all([0,1].map(()=>req('/auth/phone/login',{phone:known,code:qaCode(known)})));
  assert.equal(raced.filter(item=>item.status===201).length,1);assert.equal(raced.filter(item=>item.status===401).length,1);
  const provider=process.env.HELIOS_PHONE_PROVIDER;delete process.env.HELIOS_PHONE_PROVIDER;
  try{const closed=await issue('worker',director,{phone:mobile()});assert.equal((await req(`/join/${closed.code}/challenge`,{requestId:id()})).status,503);}
  finally{process.env.HELIOS_PHONE_PROVIDER=provider;}
});

test('phone invitation keeps employee cards, rights and the previous password login',async()=>{
  const cardPhone=mobile(),card=id();
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name,phone) VALUES($1,$2,$3,'Существующая карточка',$4)`,[tenant,card,org,cardPhone]);
  const linked=await issue('worker',director,{phone:cardPhone,employeeId:card});
  await req(`/join/${linked.code}/challenge`,{requestId:id()});
  const accepted=await req(`/join/${linked.code}`,{name:'QA Новый человек',code:qaCode(cardPhone)});assert.equal(accepted.status,201,accepted.body.error);
  const cards=await admin.query(`SELECT id,user_id FROM employees WHERE tenant_id=$1 AND phone=$2`,[tenant,cardPhone]);
  assert.equal(cards.rowCount,1);assert.equal(cards.rows[0].id,card);assert.equal(cards.rows[0].user_id,accepted.body.user.id);
  const taken=mobile(),takenCard=id();
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name,phone) VALUES($1,$2,$3,$4,'Занятая карточка',$5)`,[tenant,takenCard,org,worker,taken]);
  assert.equal((await req('/invitations',{role:'worker',projectId:project,organizationId:org,requestId:id(),phone:taken,employeeId:takenCard})).body.error,'employee_linked');
  const mismatch=mobile();const mismatchCard=id();
  await admin.query(`INSERT INTO employees(tenant_id,id,organization_id,full_name,phone) VALUES($1,$2,$3,'Другой номер',$4)`,[tenant,mismatchCard,org,mobile()]);
  assert.equal((await req('/invitations',{role:'worker',projectId:project,organizationId:org,requestId:id(),phone:mismatch,employeeId:mismatchCard})).body.error,'employee_phone');
  const active=mobile();await issue('worker',director,{phone:active});
  assert.equal((await req('/invitations',{role:'worker',projectId:project,organizationId:org,requestId:id(),phone:active})).body.error,'invitation_active');
  assert.equal((await req('/invitations',{role:'master',projectId:project,organizationId:org,requestId:id(),phone:mobile()})).status,400);
  const masterPhone=mobile();const masterInvite=await issue('worker',master,{phone:masterPhone});
  await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);
  try{assert.equal((await req(`/join/${masterInvite.code}/challenge`,{requestId:id()})).status,403);assert.equal((await req(`/join/${masterInvite.code}`)).status,403);}
  finally{await admin.query(`UPDATE memberships SET status='active' WHERE tenant_id=$1 AND user_id=$2`,[tenant,master]);}
  assert.equal((await req(`/join/${masterInvite.code}`)).status,200);
  const conflictPhone=mobile();await admin.query(`INSERT INTO phone_identities(phone,user_id) VALUES($1,$2)`,[conflictPhone,director]);
  const conflict=await issue('worker',director,{phone:conflictPhone});await req(`/join/${conflict.code}/challenge`,{requestId:id()});
  assert.equal((await req(`/join/${conflict.code}`,{name:'QA Новый человек',code:qaCode(conflictPhone)})).body.error,'role_conflict');
  assert.equal((await req(`/join/${conflict.code}`)).status,200);
  const revokedPhone=mobile();const revokedInvite=await issue('worker',director,{phone:revokedPhone});
  await req(`/join/${revokedInvite.code}/challenge`,{requestId:id()});
  const revokedUser=(await req(`/join/${revokedInvite.code}`,{name:'QA Новый человек',code:qaCode(revokedPhone)})).body.user.id;
  await admin.query(`UPDATE memberships SET status='revoked' WHERE tenant_id=$1 AND user_id=$2`,[tenant,revokedUser]);
  const restore=await issue('worker',director,{phone:revokedPhone});await age(revokedPhone);assert.equal((await req(`/join/${restore.code}/challenge`,{requestId:id()})).status,201);
  assert.equal((await req(`/join/${restore.code}`,{name:'QA Новый человек',code:qaCode(revokedPhone)})).body.error,'membership_revoked');
  assert.equal((await req(`/join/${restore.code}`)).status,200);
  const rotatedPhone=mobile();const original=await issue('worker',director,{phone:rotatedPhone});
  await req(`/join/${original.code}/challenge`,{requestId:id()});const stale=qaCode(rotatedPhone);
  const rotated=await req(`/invitations/${original.id}/refresh`,{requestId:id()});assert.equal(rotated.status,201);
  await age(rotatedPhone);await req(`/join/${rotated.body.code}/challenge`,{requestId:id()});
  assert.equal((await req(`/join/${rotated.body.code}`,{name:'QA Новый человек',code:stale})).body.error,'code_invalid');
  assert.equal((await req(`/join/${rotated.body.code}`,{name:'QA Новый человек',code:qaCode(rotatedPhone)})).status,201);
  assert.equal((await req('/auth/login',{email:`${director}@invite.test`,password:'fixture-password'})).status,201);
});
