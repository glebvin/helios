import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../src/app.module.js';
import {AllExceptionsFilter} from '../src/http.js';
import {adminUrl,appUrl,createPool,withTenant} from '../src/db.js';
import {defaultRouteConfiguration} from '../src/route-config.js';
import {routeFixture,removeRouteFixture} from './route-config-fixture.js';
import {checkHttpContract} from './contract-check.js';
const admin=createPool(adminUrl),application=createPool(appUrl);let fixture:Awaited<ReturnType<typeof routeFixture>>,app:any,base:string;
const tokens=new Map<string,string>();let version=0;
async function call(index:number,method='GET',body?:unknown,project=fixture.projectId,tenant=fixture.tenantId,query=''){
 const path=`/api/v1/projects/${project}/route-config${query}`;
 const response=await fetch(base+path,{method,headers:{authorization:`Bearer ${tokens.get(fixture.users[index]!.id)}`,'x-tenant-id':tenant,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();
 checkHttpContract(path,method,response.status,data,response.headers);return {status:response.status,body:data};
}
test.before(async()=>{
 fixture=await routeFixture(admin);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());await app.listen(0,'127.0.0.1');base=await app.getUrl();
 for(const u of fixture.users){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:u.email,password:u.password})});assert.equal(r.status,201);tokens.set(u.id,(await r.json()).token);}
});
test.after(async()=>{await app?.close();try{if(fixture)await removeRouteFixture(admin,fixture);}finally{await admin.end();await application.end();}});
test('assigned admin reads defaults, saves first snapshot, reads after fresh request; retry is one revision/audit',async()=>{
 const initial=await call(0);assert.equal(initial.status,200);assert.equal(initial.body.version,0);assert.equal(initial.body.documents.length,14);
 const configuration=initial.body.configuration;configuration.routes[0].responsibles[0].userId=fixture.users[2]!.id;configuration.routes[0].approvers[0].userId=fixture.users[2]!.id;configuration.routes[0].preparers[0].userId=fixture.users[3]!.id;
 const command={requestId:randomUUID(),expectedVersion:0,configuration};
 const saved=await call(0,'POST',command);assert.equal(saved.status,201);version=saved.body.version;assert.equal(version,1);
 assert.deepEqual((await call(0,'POST',command)).body,saved.body);assert.deepEqual((await call(1)).body.configuration,configuration);
 assert.equal((await admin.query('SELECT count(*)::int n FROM route_config_versions WHERE tenant_id=$1',[fixture.tenantId])).rows[0].n,1);
 assert.equal((await admin.query("SELECT count(*)::int n FROM audit_log WHERE tenant_id=$1 AND action='routes.configure'",[fixture.tenantId])).rows[0].n,1);
 assert.equal((await call(0,'POST',{...command,expectedVersion:1})).status,409);
});
test('three active safety reviewers are valid and remain parallel assignments',async()=>{
 const configuration=(await call(0)).body.configuration;
 configuration.routes.find((r:any)=>r.documentType==='employee-admission').reviewers=fixture.users.filter(u=>u.role==='safety').map(u=>({role:'safety',userId:u.id}));
 const saved=await call(0,'POST',{requestId:randomUUID(),expectedVersion:version,configuration});assert.equal(saved.status,201);version++;
 assert.equal((await call(0)).body.configuration.routes.find((r:any)=>r.documentType==='employee-admission').reviewers.length,3);
});
test('two windows with one version serialize; old snapshot stays unchanged; no automatic retry',async()=>{
 const before=(await call(0)).body.configuration,priorVersion=version;
 const a=structuredClone(before),b=structuredClone(before);a.routes[0].dataProviders[0].userId=fixture.users[5]!.id;
 const results=await Promise.all([call(0,'POST',{requestId:randomUUID(),expectedVersion:version,configuration:a}),call(1,'POST',{requestId:randomUUID(),expectedVersion:version,configuration:b})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);version++;
 const old=await call(0,'GET',undefined,undefined,undefined,`?version=${priorVersion}`);assert.equal(old.status,200);assert.deepEqual(old.body.configuration,before);assert.equal((await call(0)).body.version,version);
});
test('real requests deny non-admin, foreign tenant/project, wrong role/person and revoked project membership',async()=>{
 const command=()=>({requestId:randomUUID(),expectedVersion:version,configuration:defaultRouteConfiguration()});
 for(const i of [2,3,4,5,6]){assert.equal((await call(i)).status,403);assert.equal((await call(i,'POST',command())).status,403);}
 assert.equal((await call(0,'GET',undefined,fixture.otherProjectId)).status,403);
 assert.equal((await call(0,'POST',command(),fixture.otherProjectId)).status,403);
 assert.equal((await call(0,'GET',undefined,fixture.projectId,fixture.foreignId)).status,403);
 for(const id of [fixture.users[3]!.id,randomUUID()]){const c=command();c.configuration.routes[0]!.approvers[0]!.userId=id;assert.equal((await call(0,'POST',c)).status,422);}
 await admin.query("UPDATE project_memberships SET status='revoked' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[fixture.tenantId,fixture.projectId,fixture.users[1]!.id]);assert.equal((await call(1,'POST',command())).status,403);
 await admin.query("UPDATE project_memberships SET status='active' WHERE tenant_id=$1 AND project_id=$2 AND user_id=$3",[fixture.tenantId,fixture.projectId,fixture.users[1]!.id]);
 const extra=await fetch(base+'/api/projects/'+fixture.projectId+'/place',{method:'POST',headers:{authorization:`Bearer ${tokens.get(fixture.users[0]!.id)}`,'x-tenant-id':fixture.tenantId,'content-type':'application/json'},body:'{}'});assert.equal(extra.status,403);
});
test('malformed routes fail HTTP validation, history parameters bounded, snapshots immutable and RLS isolated',async()=>{
 for(const change of [(c:any)=>c.routes[2].reviewers=Array(4).fill({role:'safety',userId:null}),(c:any)=>c.routes[0].approvers.push({role:'director',userId:null}),(c:any)=>c.routes[0].responsibles=[],(c:any)=>c.routes[2].reviewers=[]]){
  const configuration=defaultRouteConfiguration();change(configuration);assert.equal((await call(0,'POST',{requestId:randomUUID(),expectedVersion:version,configuration})).status,400);
 }
 assert.equal((await call(0,'GET',undefined,undefined,undefined,'?version=999')).status,404);
 for(const query of ['?version=0','?version=2147483648','?hidden=1'])assert.equal((await call(0,'GET',undefined,undefined,undefined,query)).status,400);
 assert.equal((await withTenant(application,fixture.foreignId,fixture.users[0]!.id,c=>c.query('SELECT * FROM route_config_versions WHERE project_id=$1',[fixture.projectId]))).rowCount,0);
 await assert.rejects(withTenant(application,fixture.tenantId,fixture.users[0]!.id,c=>c.query('UPDATE route_config_versions SET version=version+100 WHERE project_id=$1',[fixture.projectId])),{code:'42501'});
});
