// Only a newly created local shift QA tenant. No active staging endpoints.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID as id} from 'node:crypto';
const base='http://127.0.0.1:4359',dir=process.env.HELIOS_SHIFT_REVIEW_OUTPUT??'.data/release-r13-r17/fixture';
const m=JSON.parse(await readFile(dir+'/accounts.json','utf8')),director=m.accounts.find(x=>x.role==='director'),master=m.accounts.find(x=>x.role==='master'),worker=m.accounts.find(x=>x.role==='worker');
const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:director.email,password:director.password})});assert.equal(login.status,201);const token=(await login.json()).token;
const headers={authorization:`Bearer ${token}`,'x-tenant-id':m.tenantId,'content-type':'application/json'};
async function api(method,path,data){const r=await fetch(base+'/api/v1'+path,{method,headers,...(data?{body:JSON.stringify(data)}:{})});const text=await r.text();assert.ok(r.ok,method+' '+path+' '+r.status+' '+text);return text?JSON.parse(text):null}
const p=m.projectId,clock=await api('GET','/overview'),command=x=>({requestId:id(),...x});
await api('PUT',`/projects/${p}/memberships/${master.id}`,command({expectedVersion:0,status:'active'}));
const adm=await api('POST',`/projects/${p}/admission-template`,command({code:'safe',title:'Допуск QA',items:[{id:'safe',label:'Инструктаж',critical:true}],requiredQualificationCodes:[]}));
const check=await api('POST',`/employees/${worker.employeeId}/admission-checks`,command({projectId:p,templateVersion:adm.version,answers:[{itemId:'safe',value:true}]}));
await api('PUT',`/projects/${p}/assignments/${worker.employeeId}`,command({expectedVersion:0,status:'active',admissionCheckId:check.id}));
const zone=await api('POST',`/projects/${p}/zones`,command({name:'Секция А'}));
const type=await api('POST',`/projects/${p}/work-types`,command({name:'Бетонирование',unit:'123123',requiresRd:false,requiresMaterialControl:false,requiresPredecessorAcceptance:false,requiresId:false}));
const front=await api('POST',`/projects/${p}/front-template`,command({code:'front',title:'Фронт QA',items:[{id:'ready',label:'Готово',critical:true}]}));
let task=await api('POST',`/projects/${p}/tasks`,command({zoneId:zone.id,workTypeId:type.id,title:'QA смена и отчёт',workDate:clock.day,plannedQuantity:'12.340',assigneeEmployeeId:worker.employeeId,responsibleUserId:master.id,plannedStart:clock.day+'T00:00:00+03:00',plannedEnd:clock.day+'T23:59:00+03:00',rdReference:null}));
await api('POST',`/projects/${p}/tasks/${task.id}/front-checks`,command({expectedVersion:task.version,templateVersion:front.version,answers:[{itemId:'ready',value:true}]}));
task=await api('GET',`/projects/${p}/tasks/${task.id}`);
for(const action of ['submit','publish'])task=await api('POST',`/projects/${p}/tasks/${task.id}/${action}`,command({expectedVersion:task.version}));
await writeFile(dir+'/scenario.json',JSON.stringify({projectId:p,employeeId:worker.employeeId,taskId:task.id,taskTitle:task.title,day:clock.day,unit:task.unit},null,2),{mode:0o600});
await api('POST','/auth/logout');console.log('Prepared one published task with real admission/assignment on isolated QA4359/54359');
