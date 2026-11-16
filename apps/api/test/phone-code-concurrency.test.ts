import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {Pool} from 'pg';
import {adminUrl,appUrl,createPool} from '../src/db.js';
import {AuthService} from '../src/auth.service.js';
import {InvitationsService} from '../src/invitations.service.js';

const admin=createPool(adminUrl);
const application='phone-concurrency-'+randomUUID();
const app=new Pool({connectionString:appUrl,max:20,application_name:application});
const auth=new AuthService(app),invitations=new InvitationsService(app);
const tenant=randomUUID(),org=randomUUID(),project=randomUUID(),director=randomUUID(),worker=randomUUID();
const phones:string[]=[];
const qa=fileURLToPath(new URL('../../../.data/phone-concurrency-qa/',import.meta.url));
function phone(){const v='+79'+String(Math.floor(Math.random()*1e9)).padStart(9,'0');phones.push(v);return v;}
function code(number:string){return JSON.parse(readFileSync(qa+'/codes.json','utf8'))[number] as string;}
async function result<T>(p:Promise<T>){try{return {status:201,value:await p};}catch(e){return {status:(e as {getStatus():number}).getStatus()};}}
async function waiting(count:number){
 const deadline=Date.now()+10000;
 while(Date.now()<deadline){
  const row=(await admin.query("SELECT count(*)::int n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[application])).rows[0];
  if(row.n>=count)return;
  await new Promise(r=>setTimeout(r,10));
 }
 throw new Error('QA PostgreSQL lock barrier did not fill');
}
test.before(async()=>{
 const localPort=process.env.HELIOS_PHONE_CONCURRENCY_QA_DB_PORT??'54575';
 assert.ok(['54575','54597'].includes(localPort));
 const url=new URL(adminUrl),port=process.env.GITHUB_ACTIONS==='true'?'54339':localPort;
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,port);
 if(process.env.GITHUB_ACTIONS!=='true')assert.equal(realpathSync((await admin.query('SHOW data_directory')).rows[0].data_directory),realpathSync(fileURLToPath(new URL('../../../.data/pg-'+localPort,import.meta.url))));
 mkdirSync(qa,{recursive:true,mode:0o700});
 process.env.HELIOS_PHONE_PROVIDER='synthetic';process.env.HELIOS_PHONE_QA_DIR=qa;process.env.HELIOS_PHONE_CODE_SECRET='qa-concurrency-secret-0123456789abcdef';
 await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Phone concurrency QA')",[tenant]);
 await admin.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','QA')",[tenant,org]);
 await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'QA')",[tenant,project]);
 for(const [id,role] of [[director,'director'],[worker,'worker']]){
  await admin.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,NULL,'QA',NULL)",[id]);
  await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,id,role]);
 }
});
test.after(async()=>{
 try{
  await admin.query('DELETE FROM phone_challenges WHERE phone=ANY($1::text[])',[phones]);
  await admin.query('DELETE FROM phone_identities WHERE user_id=ANY($1::uuid[])',[[director,worker]]);
  await admin.query('DELETE FROM invitation_locator WHERE tenant_id=$1',[tenant]);
  for(const table of ['invitations','audit_log','project_memberships','employees','memberships','projects','organizations'])await admin.query(`DELETE FROM ${table} WHERE tenant_id=$1`,[tenant]);
  await admin.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[[director,worker]]);
  await admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[director,worker]]);await admin.query('DELETE FROM tenants WHERE id=$1',[tenant]);
 }finally{await app.end();await admin.end();}
});

test('five completed wrong OTPs lock the code atomically across connections',async()=>{
 const number=phone();await admin.query('INSERT INTO phone_identities(phone,user_id) VALUES($1,$2)',[number,worker]);
 await auth.phoneChallenge({phone:number,requestId:randomUUID()});const good=code(number),bad=good==='000000'?'111111':'000000';
 const blocker=await admin.connect();const pending:Promise<unknown>[]=[];
 try{
  await blocker.query('BEGIN');await blocker.query("SELECT id FROM phone_challenges WHERE phone=$1 AND purpose='login' FOR UPDATE",[number]);
  const failures=Array.from({length:6},()=>result(auth.phoneLogin({phone:number,code:bad})));pending.push(...failures);await waiting(6);
  await blocker.query('COMMIT');
  const wrong=await Promise.all(failures);wrong.forEach(r=>assert.equal(r.status,401));
  const row=(await admin.query('SELECT attempts,consumed_at FROM phone_challenges WHERE phone=$1',[number])).rows[0];
  assert.equal(row.attempts,5,'concurrent failed guesses must not lose increments or exceed the budget');assert.ok(row.consumed_at);
  assert.equal((await result(auth.phoneLogin({phone:number,code:good}))).status,401,'a valid code after exhausted guesses must not create a session');
  assert.equal((await admin.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1',[worker])).rows[0].n,0);
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled(pending);}
});

test('a valid OTP racing wrong guesses succeeds only before the five-attempt budget is exhausted',async()=>{
 await admin.query('DELETE FROM phone_identities WHERE user_id=$1',[worker]);
 const number=phone();await admin.query('INSERT INTO phone_identities(phone,user_id) VALUES($1,$2)',[number,worker]);
 await auth.phoneChallenge({phone:number,requestId:randomUUID()});const good=code(number),bad=good==='000000'?'111111':'000000';
 const blocker=await admin.connect();const pending:Promise<unknown>[]=[];
 try{
  await blocker.query('BEGIN');await blocker.query("SELECT id FROM phone_challenges WHERE phone=$1 AND purpose='login' FOR UPDATE",[number]);
  const failures=Array.from({length:6},()=>result(auth.phoneLogin({phone:number,code:bad})));pending.push(...failures);await waiting(6);
  const success=result(auth.phoneLogin({phone:number,code:good}));pending.push(success);await waiting(7);
  await blocker.query('COMMIT');
  (await Promise.all(failures)).forEach(r=>assert.equal(r.status,401));
  const outcome=await success;
  const row=(await admin.query('SELECT attempts,consumed_at FROM phone_challenges WHERE phone=$1',[number])).rows[0];
  // Waiting on an old tuple does not establish transaction execution order after an UPDATE.
  // Assert the committed security invariant, independent of which connection acquires the new tuple first.
  assert.ok(row.consumed_at);assert.ok(row.attempts>=0 && row.attempts<=5);
  assert.equal(outcome.status,row.attempts<5?201:401);
  assert.equal((await admin.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1',[worker])).rows[0].n,outcome.status===201?1:0);
  assert.equal((await result(auth.phoneLogin({phone:number,code:good}))).status,401,'even a winning code cannot be reused');
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled(pending);await admin.query('DELETE FROM sessions WHERE user_id=$1',[worker]);}
});

test('concurrent distinct commands cannot create several active invitations for the same phone',async()=>{
 const number=phone(),actor={tenantId:tenant,userId:director,role:'director',name:'QA',email:null};
 const blocker=await admin.connect();const pending:Promise<unknown>[]=[];
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE invitations IN SHARE MODE');
  const calls=Array.from({length:6},()=>result(invitations.create(actor,{role:'worker',projectId:project,organizationId:org,phone:number,requestId:randomUUID()})));pending.push(...calls);await waiting(6);await blocker.query('COMMIT');
  const results=await Promise.all(calls);assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,5);
  assert.equal((await admin.query('SELECT count(*)::int n FROM invitations WHERE tenant_id=$1 AND phone=$2 AND consumed_at IS NULL AND revoked_at IS NULL',[tenant,number])).rows[0].n,1);
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled(pending);}
});

test('refreshing an expired phone invitation races safely with a new invitation',async()=>{
 const number=phone(),actor={tenantId:tenant,userId:director,role:'director',name:'QA',email:null};
 const old=await invitations.create(actor,{role:'worker',projectId:project,organizationId:org,phone:number,requestId:randomUUID()});
 await admin.query("UPDATE invitations SET expires_at=now()-interval '1 second' WHERE id=$1",[old.id]);
 const blocker=await admin.connect();const pending:Promise<unknown>[]=[];
 try{
  await blocker.query('BEGIN');await blocker.query('LOCK TABLE invitations IN SHARE MODE');
  const calls=[result(invitations.create(actor,{role:'worker',projectId:project,organizationId:org,phone:number,requestId:randomUUID()})),result(invitations.refresh(actor,old.id,{requestId:randomUUID()}))];pending.push(...calls);
  await waiting(2);await blocker.query('COMMIT');const outcomes=await Promise.all(calls);assert.deepEqual(outcomes.map(r=>r.status).sort(),[201,409]);
  assert.equal((await admin.query('SELECT count(*)::int n FROM invitations WHERE tenant_id=$1 AND phone=$2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>now()',[tenant,number])).rows[0].n,1);
 }finally{await blocker.query('ROLLBACK').catch(()=>{});blocker.release();await Promise.allSettled(pending);}
});
