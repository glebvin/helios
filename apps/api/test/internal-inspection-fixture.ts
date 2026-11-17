import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {hashPassword} from '../src/password.js';
import {defaultRouteConfiguration} from '../src/route-config.js';
import {volumeReviewFixture} from './volume-review-fixture.js';
export async function internalInspectionFixture(admin:Pool,base:string) {
 const f=await volumeReviewFixture(admin,base);
 for(const [key,role] of [['admin','admin'],['pto2','pto'],['director2','director']]) {
  const a={id:randomUUID(),email:`${key}-${f.tenant}@inspection.test`,name:key,role};f.actors[key]=a;
  await admin.query('INSERT INTO users(id,email,name,password_hash)VALUES($1,$2,$3,$4)',[a.id,a.email,a.name,hashPassword(f.password)]);
  await admin.query('INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',[f.tenant,a.id,role]);
  await admin.query("INSERT INTO project_memberships(tenant_id,project_id,user_id,status)VALUES($1,$2,$3,'active')",[f.tenant,f.project,a.id]);
  const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:a.email,password:f.password})});assert.equal(r.status,201);f.tokens[key]=(await r.json()).token;
 }
 const parts:any[]=[];
 // Prepare sources before route configuration: this fixture does not bypass the task route.
 for(let i=0;i<8;i++){
  const report=await f.report('18');const decision=await f.ok(`/projects/${f.project}/volume-reviews/${report.reportId}`,f.command({expectedVersion:0,checklistRunId:report.checklistRunId,acceptedQuantity:i===7?'0':'17',reason:'1 м² требует доработки'}),'master');
  parts.push({...report,partId:decision.review.id});
 }
 let configVersion=0;
 async function configure(pto='pto',rp='director') {
  const configuration=defaultRouteConfiguration();
  for(const route of configuration.routes.filter(r=>['internal-inspection','daily-task'].includes(r.documentType))) {
   route.preparers[0].userId=f.actors.master.id;route.responsibles[0].userId=f.actors[rp].id;route.approvers[0].userId=f.actors[route.documentType==='internal-inspection'?pto:rp].id;
  }
  const saved=await f.ok(`/projects/${f.project}/route-config`,f.command({expectedVersion:configVersion,configuration}),'admin');configVersion=saved.version;return saved;
 }
 const path=(n:number)=>`/projects/${f.project}/accepted-parts/${parts[n].partId}/internal-inspection`;
 const action=(n:number,action:string,expectedVersion:number,extra:Record<string,unknown>={},key=action==='submit'?'master':action==='responsible'?'director':'pto')=>f.call(path(n),f.command({action,expectedVersion,...(action==='submit'?{expectedRouteVersion:configVersion}:{}),...extra}),key);
 return {...f,parts,path,action,configure};
}
