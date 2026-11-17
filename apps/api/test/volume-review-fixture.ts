import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { hashPassword } from '../src/password.js';

export async function assertVolumeReviewDatabase(admin: Pool, runtime = false) {
  const url = new URL(process.env.ADMIN_DATABASE_URL ?? 'postgres://invalid');
  assert.equal(url.hostname, '127.0.0.1');
  const ci = process.env.GITHUB_ACTIONS === 'true';
  const port=process.env.HELIOS_VOLUME_QA_DB_PORT??'54643';assert.ok(['54643','54647','54653'].includes(port));
  assert.equal(url.port, ci ? '54339' : port);
  if (runtime) {
    const app = new URL(process.env.DATABASE_URL ?? 'postgres://invalid');
    assert.equal(app.hostname, url.hostname); assert.equal(app.port, url.port); assert.equal(app.pathname, url.pathname);
  }

  const dir = (await admin.query('SHOW data_directory')).rows[0].data_directory;
  if (ci) assert.match(dir, /codex-api\/\.data\/pg-54339$/);
  else assert.equal(realpathSync(dir), realpathSync(fileURLToPath(new URL(`../../../.data/pg-${port}`, import.meta.url))));
}

export async function volumeReviewFixture(admin: Pool, base: string) {
  await assertVolumeReviewDatabase(admin);
  const tenant = randomUUID(), project = randomUUID(), otherProject = randomUUID(), org = randomUUID(), employee = randomUUID();
  const actors = Object.fromEntries(['master','master2','worker','otherWorker','pto','director','hr'].map(key => [key, {id: randomUUID(), role: key === 'master2' ? 'master' : key === 'otherWorker' ? 'worker' : key, email: `${key}-${tenant}@volume-review.test`, name: key === 'master' ? 'Мастер QA' : key}]));
  const password = 'volume-review-local-only', hash = hashPassword(password);
  await admin.query("INSERT INTO tenants(id,name)VALUES($1,'Самоконтроль QA')", [tenant]);
  await admin.query("INSERT INTO organizations(tenant_id,id,kind,name)VALUES($1,$2,'own','Компания QA')", [tenant,org]);
  await admin.query("INSERT INTO projects(tenant_id,id,name)VALUES($1,$2,'Самоконтроль QA'),($1,$3,'Другой объект')", [tenant,project,otherProject]);
  const tokens: Record<string,string> = {};
  for (const [key,a] of Object.entries(actors)) {
    await admin.query('INSERT INTO users(id,email,name,password_hash)VALUES($1,$2,$3,$4)', [a.id,a.email,a.name,hash]);
    await admin.query('INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,$3)', [tenant,a.id,a.role]);
    await admin.query("INSERT INTO project_memberships(tenant_id,project_id,user_id,status)VALUES($1,$2,$3,'active')", [tenant,project,a.id]);
    const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:a.email,password})});
    assert.equal(r.status,201); tokens[key]=(await r.json()).token;
  }
  await admin.query("INSERT INTO employees(tenant_id,id,organization_id,full_name,user_id)VALUES($1,$2,$3,'Работник QA',$4)",[tenant,employee,org,actors.worker.id]);
  const otherEmployee=randomUUID();
  await admin.query("INSERT INTO employees(tenant_id,id,organization_id,full_name,user_id)VALUES($1,$2,$3,'Другой работник QA',$4)",[tenant,otherEmployee,org,actors.otherWorker.id]);
  await admin.query("INSERT INTO employee_project_assignments(tenant_id,project_id,employee_id,status)VALUES($1,$2,$3,'active')",[tenant,project,otherEmployee]);
  const day=(await admin.query("SELECT to_char(now() AT TIME ZONE timezone,'YYYY-MM-DD') AS today FROM tenants WHERE id=$1",[tenant])).rows[0].today as string;
  const headers=(key='master')=>({authorization:`Bearer ${tokens[key]}`,'x-tenant-id':tenant,'content-type':'application/json'});
  async function call(path:string,body?:unknown,key='master',method=body===undefined?'GET':'POST') {
    const response=await fetch(base+'/api/v1'+path,{method,headers:headers(key),body:body===undefined?undefined:JSON.stringify(body)});
    const raw=await response.text();return {status:response.status,body:raw?JSON.parse(raw):null};
  }
  async function ok(path:string,body:unknown,key='director',method='POST') {
    const r=await call(path,body,key,method);assert.equal(r.status,method==='POST'?201:200,`${path}: ${JSON.stringify(r.body)}`);return r.body;
  }
  const command=(body:Record<string,unknown>)=>({requestId:randomUUID(),...body});
  const admission=await ok(`/projects/${project}/admission-template`,command({code:'safe',title:'Допуск QA',items:[{id:'safe',label:'Безопасно',critical:true}],requiredQualificationCodes:[]}));
  const check=await ok(`/employees/${employee}/admission-checks`,command({projectId:project,templateVersion:admission.version,answers:[{itemId:'safe',value:true}]}));
  await ok(`/projects/${project}/assignments/${employee}`,command({expectedVersion:0,status:'active',admissionCheckId:check.id}),'director','PUT');
  const zone=await ok(`/projects/${project}/zones`,command({name:'Зона QA'}));
  const work=await ok(`/projects/${project}/work-types`,command({name:'Кладка QA',unit:'м2',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
  const front=await ok(`/projects/${project}/front-template`,command({code:'ready',title:'Фронт QA',items:[{id:'ready',label:'Готово',critical:true}]}));
  const template=randomUUID();
  await admin.query('INSERT INTO checklist_templates(tenant_id,project_id,id,created_by)VALUES($1,$2,$3,$4)',[tenant,project,template,actors.master.id]);
  await admin.query("INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by)VALUES($1,$2,$3,1,'Самоконтроль QA',$4,'approved',1,$5)",[tenant,project,template,JSON.stringify([{id:'ready',prompt:'Работа проверена',kind:'yes_no',required:true,critical:true,pass:'yes'}]),actors.master.id]);
  let streamVersion=0,index=0;
  async function report(quantity='18',withChecklist=true,unit='м2') {
    const n=index++,startedAt=`${day}T${String(8+n).padStart(2,'0')}:00:00.000Z`,endedAt=`${day}T${String(9+n).padStart(2,'0')}:00:00.000Z`;
    const selectedWork=unit==='м2'?work:await ok(`/projects/${project}/work-types`,command({name:`Другой вид ${n}`,unit,requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
    let task=await ok(`/projects/${project}/tasks`,command({zoneId:zone.id,workTypeId:selectedWork.id,title:`Кладка ${n+1}`,workDate:day,plannedQuantity:'20',assigneeEmployeeId:employee,responsibleUserId:actors.master.id,plannedStart:startedAt,plannedEnd:endedAt,rdReference:null}));
    await ok(`/projects/${project}/tasks/${task.id}/front-checks`,command({expectedVersion:task.version,templateVersion:front.version,answers:[{itemId:'ready',value:true}]}));
    task=(await call(`/projects/${project}/tasks/${task.id}`,undefined,'director')).body;
    for(const action of ['submit','publish']) {const r=await call(`/projects/${project}/tasks/${task.id}/${action}`,command({expectedVersion:task.version}),'director');assert.equal(r.status,200,JSON.stringify(r.body));task=r.body;}
    let checklist:any=null;
    if(withChecklist) checklist=await ok(`/projects/${project}/tasks/${task.id}/checklist-runs`,command({templateId:template,edition:1,expectedVersion:0,answers:[{itemId:'ready',value:'yes'}]}),'master');
    const shift=randomUUID(),startId=randomUUID(),workId=randomUUID(),endId=randomUUID(),reportId=randomUUID();
    const events=[{requestId:startId,kind:'shift_start',employeeId:employee,projectId:project,shiftId:shift,expectedVersion:streamVersion,occurredAt:startedAt},{requestId:workId,kind:'segment_change',employeeId:employee,projectId:project,shiftId:shift,expectedVersion:streamVersion+1,occurredAt:startedAt,mode:'work',taskId:task.id,previousEventId:startId},{requestId:endId,kind:'shift_end',employeeId:employee,projectId:project,shiftId:shift,expectedVersion:streamVersion+2,occurredAt:endedAt,previousEventId:workId},{requestId:randomUUID(),kind:'submit_volume',employeeId:employee,projectId:project,shiftId:shift,expectedVersion:streamVersion+3,occurredAt:endedAt,taskId:task.id,reportId,submittedQuantity:quantity,previousEventId:endId}];
    const response=await call('/execution/events',{events},'worker');assert.equal(response.status,200);assert.deepEqual(response.body.results.map((r:any)=>r.outcome),['success','success','success','success'],JSON.stringify(response.body));streamVersion+=4;
    return {reportId,taskId:task.id,checklistRunId:checklist?.id??null};
  }
  return {tenant,project,otherProject,employee,org,actors,password,tokens,day,headers,call,ok,command,report,template};
}
