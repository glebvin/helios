import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {realpathSync} from 'node:fs';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module.js';
import {AllExceptionsFilter} from '../src/http.js';
import {createPool, adminUrl} from '../src/db.js';
import {hashPassword} from '../src/password.js';
import {roleCatalog} from '../src/role-catalog.js';
import {checkHttpContract, publicContract} from './contract-check.js';

// Writes only to the normal isolated CI fixture or this explicit local QA root.
const target=new URL(adminUrl);
assert.equal(target.hostname,'127.0.0.1');
assert.equal(target.port,process.env.GITHUB_ACTIONS==='true'?'54339':'54549');
const admin=createPool(adminUrl), tenant=randomUUID(), foreign=randomUUID(), project=randomUUID();
const users=roleCatalog.map(role=>({id:randomUUID(),role:role.code,email:`${randomUUID()}@role-contract.test`}));
const tokens=new Map<string,string>();let app:any,base:string;let ownedContour=false;
async function call(user:string,path:string,method='GET',body?:unknown,scope=tenant){
 const r=await fetch(base+path,{method,headers:{authorization:`Bearer ${tokens.get(user)}`,'x-tenant-id':scope,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await r.json();
 if(path==='/api/v1/me')checkHttpContract(path,method,r.status,data,r.headers);
 return {status:r.status,body:data};
}
test.before(async()=>{
 if(process.env.GITHUB_ACTIONS!=='true'){
  const data=(await admin.query('SHOW data_directory')).rows[0].data_directory;
  assert.equal(realpathSync(data),realpathSync(fileURLToPath(new URL('../../../.data/pg-54549',import.meta.url))));
 }
 ownedContour=true;
 await admin.query("INSERT INTO tenants(id,name) VALUES($1,'Role contract QA'),($2,'Foreign contract QA')",[tenant,foreign]);
 await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Role contract project')",[tenant,project]);
 for(const user of users){
  await admin.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Synthetic role user',$3)",[user.id,user.email,hashPassword('fixture-role-contract-2026')]);
  await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,user.id,user.role]);
  await admin.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)',[tenant,project,user.id]);
 }
 app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const user of users){
  const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:user.email,password:'fixture-role-contract-2026'})});assert.equal(r.status,201);const data=await r.json();checkHttpContract('/api/v1/auth/login','POST',r.status,data,r.headers);assert.equal(data.memberships[0].role,user.role);tokens.set(user.id,data.token);
 }
});
test.after(async()=>{
 await app?.close();
 if(!ownedContour){await admin.end();return;}
 try{
  await admin.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  for(const table of ['project_memberships','memberships','projects','audit_log'])await admin.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[[tenant,foreign]]);
  await admin.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])',[[tenant,foreign]]);
  await admin.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);
 }finally{await admin.end();}
});
test('all20 role identities survive storage/login and keep the actual role on me',async()=>{
 for(const user of users){const r=await call(user.id,'/api/v1/me');assert.equal(r.status,200,user.role);assert.equal(r.body.role,user.role);}
});
test('new reserved roles cannot enter ungranted business handlers even with forged role hints',async()=>{
 for(const user of users.filter(u=>roleCatalog.find(r=>r.code===u.role)!.runtime==='reserved')){
  for(const [method,path]of [['GET','/api/desk'],['GET','/api/v1/employees'],['GET','/api/v1/projects'],['POST',`/api/projects/${project}/place`],['POST','/api/v1/execution/events'],['POST','/api/v1/invitations']]){
   if(user.role==='subcontractor' && path==='/api/v1/employees'){
    const list=await call(user.id,path);
    assert.equal(list.status,200);
    assert.equal(list.body.total,0);
    continue;
   }
   const r=await call(user.id,path!,method!,method==='POST'?{role:'director'}:undefined);assert.equal(r.status,403,`${user.role} ${method} ${path}`);assert.equal(r.body.error,'role_denied');
  }
 }
});
test('membership in another company is never inferred from a catalog role',async()=>{
 for(const user of users){const r=await call(user.id,'/api/v1/me','GET',undefined,foreign);assert.equal(r.status,403,user.role);}
});
test('reserved roles can revoke only their own active bearer',async()=>{
 for(const user of users.filter(u=>roleCatalog.find(r=>r.code===u.role)!.runtime==='reserved')){
  assert.equal((await call(user.id,'/api/v1/auth/logout','POST')).status,201);
  assert.equal((await call(user.id,'/api/v1/me')).status,401);
 }
});

test('published identity enums match the complete catalog and unknown membership codes are rejected',async()=>{
 const codes=roleCatalog.map(r=>r.code).sort();
 for(const name of ['Actor','ProjectMembership'])assert.deepEqual([...publicContract.components.schemas[name].properties.role.enum].sort(),codes);
 await assert.rejects(admin.query("UPDATE memberships SET role='superadmin' WHERE tenant_id=$1 AND user_id=$2",[tenant,users[0]!.id]),{code:'23514'});
});
