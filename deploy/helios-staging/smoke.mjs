import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createPool,withTenant} from '../../apps/api/src/db.js';
import {hashPassword} from '../../apps/api/src/password.js';
import {TENANT_A,ORG_A,PROJECT_A,USER_DIRECTOR,USER_MASTER} from '@helios/domain';

const base=process.env.SMOKE_BASE??'http://api:4327';
const creds=JSON.parse(await readFile('/run/helios-credentials.json','utf8'));
const checks=[];
async function call(session,path,body,method,expected=body===undefined?200:201){
  const response=await fetch(base+'/api/v1'+path,{method:method??(body===undefined?'GET':'POST'),headers:{...(session?{authorization:`Bearer ${session.token}`,'x-tenant-id':TENANT_A}:{}),...(body!==undefined?{'content-type':'application/json'}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();const data=text?JSON.parse(text):{};
  assert.equal(response.status,expected,`${method??(body===undefined?'GET':'POST')} ${path}: ${text}`);
  checks.push({path,status:response.status});return data;
}
const director=await call(null,'/auth/login',{email:creds[0].email,password:creds[0].password});
await call(director,'/me');
await call(null,'/auth/login',{email:creds[0].email,password:'pilot-director'},'POST',401);
const ordinaryWorker=await call(null,'/auth/login',{email:creds[2].email,password:creds[2].password});
const pool=createPool();
const qaUser=randomUUID(),qaPassword=randomBytes(24).toString('hex'),qaEmail=`qa-${qaUser}@test.helios`;
try {
  await pool.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[qaUser,qaEmail,'Я QA — проверка стенда',hashPassword(qaPassword)]);
  await withTenant(pool,TENANT_A,USER_DIRECTOR,c=>c.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'worker')",[TENANT_A,qaUser]));
  const employee=await call(director,'/employees',{requestId:randomUUID(),fullName:'Я QA — проверка стенда',organizationId:ORG_A,userId:qaUser});
  const members=await call(director,`/projects/${PROJECT_A}/memberships?limit=100`);
  for(const id of [qaUser,USER_MASTER]){
    const current=members.items.find(x=>x.userId===id);
    if(current?.status!=='active')await call(director,`/projects/${PROJECT_A}/memberships/${id}`,{requestId:randomUUID(),expectedVersion:current?.version??0,status:'active'},'PUT',200);
  }
  let template;
  const templates=await fetch(base+`/api/v1/projects/${PROJECT_A}/admission-template`,{headers:{authorization:`Bearer ${director.token}`,'x-tenant-id':TENANT_A}});
  if(templates.status===404)template=await call(director,`/projects/${PROJECT_A}/admission-template`,{requestId:randomUUID(),code:'day',title:'Допуск на день',items:[{id:'ready',label:'Допуск подтверждён',critical:true}],requiredQualificationCodes:[]});else{assert.equal(templates.status,200);template=await templates.json();}
  const check=await call(director,`/employees/${employee.id}/admission-checks`,{requestId:randomUUID(),projectId:PROJECT_A,templateVersion:template.version,answers:[{itemId:'ready',value:true}]});
  await call(director,`/projects/${PROJECT_A}/assignments/${employee.id}`,{requestId:randomUUID(),expectedVersion:0,status:'active',admissionCheckId:check.id},'PUT',200);
  const zone=await call(director,`/projects/${PROJECT_A}/zones`,{requestId:randomUUID(),name:`QA — ${qaUser}`});
  const workType=await call(director,`/projects/${PROJECT_A}/work-types`,{requestId:randomUUID(),name:`QA — ${qaUser}`,unit:'м3',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false});
  let front;
  const frontResponse=await fetch(base+`/api/v1/projects/${PROJECT_A}/front-template`,{headers:{authorization:`Bearer ${director.token}`,'x-tenant-id':TENANT_A}});
  if(frontResponse.status===404)front=await call(director,`/projects/${PROJECT_A}/front-template`,{requestId:randomUUID(),code:'front',title:'Фронт',items:[{id:'ready',label:'Фронт готов',critical:true}]});else{assert.equal(frontResponse.status,200);front=await frontResponse.json();}
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
  let task=await call(director,`/projects/${PROJECT_A}/tasks`,{requestId:randomUUID(),zoneId:zone.id,workTypeId:workType.id,title:'QA — серверная проверка дня',workDate:day,plannedQuantity:'2.500',assigneeEmployeeId:employee.id,responsibleUserId:USER_MASTER,plannedStart:`${day}T00:00:00+03:00`,plannedEnd:`${day}T23:59:59+03:00`,rdReference:null});
  await call(director,`/projects/${PROJECT_A}/tasks/${task.id}/front-checks`,{requestId:randomUUID(),expectedVersion:task.version,templateVersion:front.version,answers:[{itemId:'ready',value:true}]});
  task=await call(director,`/projects/${PROJECT_A}/tasks/${task.id}`);
  task=await call(director,`/projects/${PROJECT_A}/tasks/${task.id}/submit`,{requestId:randomUUID(),expectedVersion:task.version},'POST',200);
  task=await call(director,`/projects/${PROJECT_A}/tasks/${task.id}/publish`,{requestId:randomUUID(),expectedVersion:task.version},'POST',200);
  const worker=await call(null,'/auth/login',{email:qaEmail,password:qaPassword});
  const shiftId=randomUUID(),reportId=randomUUID(),now=Date.now();
  const events=[
    {kind:'shift_start',occurredAt:new Date(now-600000).toISOString()},
    {kind:'segment_change',mode:'work',taskId:task.id,occurredAt:new Date(now-540000).toISOString()},
    {kind:'shift_end',occurredAt:new Date(now-60000).toISOString()},
    {kind:'submit_volume',taskId:task.id,reportId,submittedQuantity:'1.250',occurredAt:new Date(now).toISOString()},
  ].map((e,i)=>({...e,requestId:randomUUID(),employeeId:employee.id,projectId:PROJECT_A,shiftId,expectedVersion:i}));
  for(let i=1;i<events.length;i++)events[i].previousEventId=events[i-1].requestId;
  for(const event of events){const result=await call(worker,'/execution/events',{events:[event]},'POST',200);assert.equal(result.results[0].outcome,'success',JSON.stringify(result));}
  const duplicate=await call(worker,'/execution/events',{events:[events[3]]},'POST',200);assert.equal(duplicate.results[0].outcome,'duplicate');
  const report=await call(director,`/projects/${PROJECT_A}/execution/reports?employeeId=${employee.id}&day=${day}`);assert.equal(report.items.length,1);assert.equal(report.items[0].submittedQuantity,'1.250');
  const fileId=randomUUID(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=','base64'),digest=createHash('sha256').update(png).digest('hex');
  const evidence=`/projects/${PROJECT_A}/evidence/${fileId}`;
  await call(worker,`/projects/${PROJECT_A}/evidence`,{requestId:randomUUID(),fileId,employeeId:employee.id,filename:'qa.png',contentType:'image/png',sizeBytes:png.length,sha256:digest});
  for(let i=0;i<2;i++){const upload=await fetch(base+'/api/v1'+evidence+'/content',{method:'PUT',headers:{authorization:`Bearer ${worker.token}`,'x-tenant-id':TENANT_A,'content-type':'application/octet-stream'},body:png});assert.equal(upload.status,200,await upload.text());}
  await call(worker,evidence+'/attachment',{requestId:randomUUID(),target:{kind:'execution_event',actorUserId:qaUser,requestId:events[0].requestId}});
  const download=await fetch(base+'/api/v1'+evidence+'/content',{headers:{authorization:`Bearer ${director.token}`,'x-tenant-id':TENANT_A}});assert.equal(download.status,200);assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'),digest);
  assert.equal((await fetch(base+'/api/v1'+evidence+'/content')).status,401);
  checks.push({check:'private_file_roundtrip_and_replay',sha256:digest});
  const timePath=`/projects/${PROJECT_A}/time/employees/${employee.id}/days/${day}`;
  let sheet=await call(director,timePath);
  await call(worker,timePath+'/approvals',{requestId:randomUUID(),expectedApprovalVersion:sheet.approvalVersion,sourceHash:sheet.sourceHash,reason:'Forbidden worker check'},'POST',403);
  await call(ordinaryWorker,timePath,undefined,'GET',404);
  sheet=await call(director,timePath+'/approvals',{requestId:randomUUID(),expectedApprovalVersion:sheet.approvalVersion,sourceHash:sheet.sourceHash,reason:'QA deployment check',acknowledgeSuspicious:true});assert.equal(sheet.status,'current');
  // Previous failed smoke attempts are isolated QA employees, never the user's main test employee.
  const qaPeople=await call(director,`/employees?projectId=${PROJECT_A}&limit=100`);
  for(const person of qaPeople.items.filter(x=>x.fullName.startsWith('Я QA')&&x.id!==employee.id)){
    const path=`/projects/${PROJECT_A}/time/employees/${person.id}/days/${day}`;
    const other=await call(director,path);
    if(other.recorded && other.status!=='current')await call(director,path+'/approvals',{requestId:randomUUID(),expectedApprovalVersion:other.approvalVersion,sourceHash:other.sourceHash,reason:'QA deployment check',acknowledgeSuspicious:true});
  }
  const excel=await fetch(base+`/api/v1/projects/${PROJECT_A}/time/export.xlsx?from=${day}&to=${day}`,{headers:{authorization:`Bearer ${director.token}`,'x-tenant-id':TENANT_A}});assert.equal(excel.status,200);
  const bytes=Buffer.from(await excel.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');assert.ok(bytes.length>1000);await writeFile('/qa/smoke.xlsx',bytes);
  await call(worker,'/auth/logout',{},'POST',201);await call(worker,'/me',undefined,'GET',401);
  const result={passed:true,checks,day,projectId:PROJECT_A,employeeId:employee.id,fileId,fileSha256:digest,taskId:task.id,xlsxBytes:bytes.length};
  await writeFile('/qa/smoke.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:true,checks:checks.length,xlsxBytes:bytes.length,photoBytes:png.length}));
} finally {await pool.end();}
