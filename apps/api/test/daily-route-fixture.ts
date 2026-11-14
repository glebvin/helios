import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import type {Pool} from 'pg';
import {hashPassword} from '../src/password.js';
import {defaultRouteConfiguration} from '../src/route-config.js';

export async function dailyRouteFixture(admin:Pool){
 const url=new URL((admin.options as {connectionString:string}).connectionString);
 assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,process.env.GITHUB_ACTIONS==='true'?'54339':'54553');
 if(process.env.GITHUB_ACTIONS!=='true')assert.equal(realpathSync((await admin.query('SHOW data_directory')).rows[0].data_directory),realpathSync(fileURLToPath(new URL('../../../.data/pg-54553',import.meta.url))));
 const tenantId=randomUUID(),foreignId=randomUUID(),projectId=randomUUID(),otherProjectId=randomUUID(),orgId=randomUUID();
 const users=['admin','rp','rp2','master','master2','worker','pto'].map(key=>({key,id:randomUUID(),role:key.startsWith('rp')?'director':key.startsWith('master')?'master':key,email:`${randomUUID()}@daily-route.test`,password:'fixture-daily-route-2026',name:({admin:'Администратор маршрутов',rp:'РП назначенный',rp2:'РП другой',master:'Мастер назначенный',master2:'Мастер другой',worker:'Работник маршрута',pto:'ПТО маршрута'}as Record<string,string>)[key]!}));
 await admin.query("INSERT INTO tenants(id,name,timezone) VALUES($1,'Daily route QA','Europe/Moscow'),($2,'Foreign route QA','UTC')",[tenantId,foreignId]);
 await admin.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Объект дневного маршрута'),($1,$3,'Другой объект маршрута')",[tenantId,projectId,otherProjectId]);
 await admin.query("INSERT INTO organizations(tenant_id,id,kind,name) VALUES($1,$2,'own','Учебная организация маршрута')",[tenantId,orgId]);
 for(const u of users){await admin.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[u.id,u.email,u.name,hashPassword(u.password)]);await admin.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenantId,u.id,u.role]);await admin.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)',[tenantId,projectId,u.id]);}
 return {tenantId,foreignId,projectId,otherProjectId,orgId,users};
}
export type DailyFixture=Awaited<ReturnType<typeof dailyRouteFixture>>;
export async function dailyScenario(base:string,f:DailyFixture){
 assert.equal(new URL(base).hostname,'127.0.0.1');
 const tokens:Record<string,string>={};
 for(const u of f.users){const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:u.email,password:u.password})});assert.equal(r.status,201);tokens[u.key]=(await r.json()).token;}
 const state={fixture:f,tokens,base,sequence:0,employee:null as any,zone:null as any,workType:null as any,front:null as any,configuration:defaultRouteConfiguration(),configurationVersion:0,legacyPending:null as any,legacyPublished:null as any};
 const post=async(path:string,body:Record<string,unknown>,key='rp',method='POST')=>{const r=await dailyRequest(state,path,key,method,{requestId:randomUUID(),...body});assert.equal(r.status,method==='POST'?201:200,JSON.stringify(r));return r.body;};
 state.employee=await post('/employees',{fullName:'Работник дневного маршрута',organizationId:f.orgId,userId:f.users.find(u=>u.key==='worker')!.id});
 const template=await post(`/projects/${f.projectId}/admission-template`,{code:'safe',title:'Учебный допуск',items:[{id:'safe',label:'Инструктаж',critical:true}],requiredQualificationCodes:[]});
 const check=await post(`/employees/${state.employee.id}/admission-checks`,{projectId:f.projectId,templateVersion:template.version,answers:[{itemId:'safe',value:true}]});
 await post(`/projects/${f.projectId}/assignments/${state.employee.id}`,{expectedVersion:0,status:'active',admissionCheckId:check.id},'rp','PUT');
 state.zone=await post(`/projects/${f.projectId}/zones`,{name:'Учебная зона'});
 state.workType=await post(`/projects/${f.projectId}/work-types`,{name:'Учебная работа',unit:'м²',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false});
 state.front=await post(`/projects/${f.projectId}/front-template`,{code:'front',title:'Учебный фронт',items:[{id:'ready',label:'Фронт готов',critical:true}]});
 state.legacyPending=await newReadyDayTask(state);state.legacyPending=await dailyAction(state,state.legacyPending,'submit','rp');
 state.legacyPublished=await newReadyDayTask(state);state.legacyPublished=await dailyAction(state,state.legacyPublished,'submit','rp');state.legacyPublished=await dailyAction(state,state.legacyPublished,'publish','rp');
 const daily=state.configuration.routes.find(r=>r.documentType==='daily-task')!;
 daily.preparers[0]!.userId=f.users.find(u=>u.key==='master')!.id;
 daily.responsibles[0]!.userId=f.users.find(u=>u.key==='rp')!.id;
 daily.approvers[0]!.userId=f.users.find(u=>u.key==='rp')!.id;
 await saveDailyConfiguration(state);return state;
}
export type DailyScenario=Awaited<ReturnType<typeof dailyScenario>>;
type ScenarioCore={fixture:DailyFixture;tokens:Record<string,string>;base:string;sequence:number;employee:any;zone:any;workType:any;front:any;configuration:ReturnType<typeof defaultRouteConfiguration>;configurationVersion:number};
export async function dailyRequest(s:Pick<ScenarioCore,'fixture'|'tokens'|'base'>,path:string,key='rp',method='GET',body?:unknown,tenant=s.fixture.tenantId){
 const response=await fetch(s.base+'/api/v1'+path,{method,headers:{authorization:`Bearer ${s.tokens[key]}`,'x-tenant-id':tenant,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json(),headers:response.headers};
}
export async function saveDailyConfiguration(s:ScenarioCore){
 const r=await dailyRequest(s,`/projects/${s.fixture.projectId}/route-config`,'admin','POST',{requestId:randomUUID(),expectedVersion:s.configurationVersion,configuration:s.configuration});assert.equal(r.status,201,JSON.stringify(r));s.configurationVersion=r.body.version;return r.body;
}
export async function newReadyDayTask(s:ScenarioCore,extra:Record<string,unknown>={}){
 const day=new Date(Date.UTC(2027,1,1+s.sequence++)).toISOString().slice(0,10),p=s.fixture.projectId;
 const created=await dailyRequest(s,`/projects/${p}/tasks`,'master','POST',{requestId:randomUUID(),zoneId:s.zone.id,workTypeId:s.workType.id,title:`Дневной маршрут ${day}`,workDate:day,plannedQuantity:'18',assigneeEmployeeId:s.employee.id,responsibleUserId:s.fixture.users.find(u=>u.key==='master')!.id,plannedStart:`${day}T09:00:00+03:00`,plannedEnd:`${day}T10:00:00+03:00`,rdReference:null,...extra});assert.equal(created.status,201,JSON.stringify(created));
 const check=await dailyRequest(s,`/projects/${p}/tasks/${created.body.id}/front-checks`,'master','POST',{requestId:randomUUID(),expectedVersion:created.body.version,templateVersion:s.front.version,answers:[{itemId:'ready',value:true}]});assert.equal(check.status,201,JSON.stringify(check));
 return (await dailyRequest(s,`/projects/${p}/tasks/${created.body.id}`,'master')).body;
}
export async function dailyAction(s:Pick<ScenarioCore,'fixture'|'tokens'|'base'>,task:any,action:string,key='master',reason='Учебная причина'){
 const r=await dailyRequest(s,`/projects/${s.fixture.projectId}/tasks/${task.id}/${action}`,key,'POST',{requestId:randomUUID(),expectedVersion:task.version,...(['reject','reopen','cancel'].includes(action)?{reason}:{})});assert.equal(r.status,200,JSON.stringify(r));return r.body;
}
export async function removeDailyFixture(admin:Pool,f:DailyFixture){
 const client=await admin.connect();try{
  await client.query('BEGIN');await client.query('SET CONSTRAINTS ALL DEFERRED');
  for(const table of ['daily_task_route_events','daily_task_route_attempts','task_publication_snapshots','task_front_checks','front_template_versions','front_templates','daily_tasks','project_work_zones','project_work_types','employee_project_assignments','employee_admission_checks','admission_template_versions','admission_templates','route_config_versions','project_memberships','employee_qualifications','people_command_receipts','employees','memberships','projects','organizations','audit_log'])await client.query(`DELETE FROM ${table} WHERE tenant_id=ANY($1::uuid[])`,[[f.tenantId,f.foreignId]]);
  await client.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])',[[f.tenantId,f.foreignId]]);await client.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[f.users.map(u=>u.id)]);await client.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[f.users.map(u=>u.id)]);await client.query('COMMIT');
 }finally{await client.query('ROLLBACK');client.release();}
}
