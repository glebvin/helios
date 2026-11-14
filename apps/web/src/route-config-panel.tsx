import {useEffect,useRef,useState} from 'react';
import type {Session} from './api';
import {ApiError,v1} from './v1';
import {DeskBadge} from './kit';
import {NoteMark} from './note-mark';
import {Flash} from './flash';
import {staffRequest} from './staff-form';

type Assignment={role:string;userId:string|null};
const slots=['preparers','responsibles','reviewers','approvers','observers','dataProviders'] as const;
type Slot=typeof slots[number];
type Route={documentType:string}&Record<Slot,Assignment[]>;
type Configuration={schemaVersion:1;routes:Route[]};
type Snapshot={projectId:string;version:number;schemaVersion:number;configuration:Configuration;createdBy:string|null;createdAt:string|null};
type Catalog=Snapshot&{documents:{code:string;title:string;external:string[];review:string[]}[];roles:{code:string;label:string}[];people:{userId:string;role:string;name:string}[];history:{version:number;createdAt:string}[]};
const labels:Record<Slot,string>={preparers:'Готовит',responsibles:'Ответственный · Р',reviewers:'Согласуют параллельно · С',approvers:'Утверждает · У',observers:'Наблюдают · К',dataProviders:'Дают данные · Д'};
function describe(reason:unknown){
 if(reason instanceof ApiError){
  if(reason.status===409)return 'Настройки уже изменены. Прочитайте текущую версию и сверяйте назначения перед новым сохранением.';
  if(reason.status===403)return 'Настройка маршрутов доступна администратору назначенного объекта.';
  if(reason.status===401)return 'Сессия закончилась. Войдите снова.';
  if(reason.message==='route_assignee_denied')return 'Один из участников больше не имеет нужной роли или доступа к объекту. Обновите список и проверьте назначения.';
  return 'Сервер не принял настройку. Проверьте состав участников.';
 }
 return 'Нет ответа сервера. Сохранение не подтверждено; повтор отправит тот же запрос.';
}
export function RouteConfigPanel({session,projectId}:{session:Session;projectId:string}){
 const [row,setRow]=useState<Catalog|null>(null),[draft,setDraft]=useState<Configuration|null>(null);
 const [selected,setSelected]=useState('daily-task'),[reading,setReading]=useState(false),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[conflict,setConflict]=useState(false),[message,setMessage]=useState(''),[pulse,setPulse]=useState(0);
 const [historical,setHistorical]=useState<number|null>(null),[extraRole,setExtraRole]=useState('');
 const request=useRef({id:'',key:''}),lock=useRef(false),generation=useRef(0);
 const dirty=!!row&&JSON.stringify(draft)!==JSON.stringify(row.configuration);
 const pendingKey=`helios.route-config:${session.tenantId}:${session.userId}:${projectId}`;
 async function read(version?:number){
  const pass=++generation.current;setReading(true);setError('');
  try{
   const next=await v1<Catalog>(session,`/projects/${projectId}/route-config${version?`?version=${version}`:''}`);
   if(pass!==generation.current)return;
   setRow(next);setDraft(structuredClone(next.configuration));setConflict(false);setHistorical(version??null);
  }catch(reason){if(pass===generation.current){setError(describe(reason));if(reason instanceof ApiError&&[401,403].includes(reason.status)){setRow(null);setDraft(null);}}}
  finally{if(pass===generation.current)setReading(false);}
 }
 useEffect(()=>{if(projectId)void read();return()=>{generation.current++;};},[session.token,session.tenantId,projectId]);
 async function save(){
  if(lock.current||!row||!draft||conflict||historical)return;lock.current=true;setBusy(true);setError('');
  const key=JSON.stringify({expectedVersion:row.version,configuration:draft});
  try{
   if(!request.current.id){try{const saved=JSON.parse(sessionStorage.getItem(pendingKey)??'null');if(typeof saved?.id==='string'&&typeof saved?.key==='string')request.current=saved;}catch{}}
   request.current=staffRequest(request.current,key,()=>crypto.randomUUID());
   // Keep the command identity over a lost acknowledgement/reload. If storage is unavailable,
   // retain the in-memory identity; a stale version still prevents a duplicate revision.
   try{sessionStorage.setItem(pendingKey,JSON.stringify(request.current));}catch{}
   const result=await v1<Snapshot>(session,`/projects/${projectId}/route-config`,{requestId:request.current.id,...JSON.parse(key)});
   try{sessionStorage.removeItem(pendingKey);}catch{}request.current={id:'',key:''};
   setRow({...row,...result,history:[{version:result.version,createdAt:result.createdAt!},...row.history]});setDraft(structuredClone(result.configuration));
   setMessage(`Сервер записал версию ${result.version}.`);setPulse(value=>value+1);
  }catch(reason){setError(describe(reason));if(reason instanceof ApiError&&reason.status===409)setConflict(true);}
  finally{lock.current=false;setBusy(false);}
 }
 const invalidReviewers=draft?.routes.some(r=>new Set(r.reviewers.map(a=>a.userId??`unassigned:${a.role}`)).size!==r.reviewers.length);
 const active=draft?.routes.find(r=>r.documentType===selected);
 const definition=row?.documents.find(d=>d.code===selected);
 const roleName=(code:string)=>row?.roles.find(r=>r.code===code)?.label??code;
 function change(slot:Slot,index:number,userId:string){
  setDraft(value=>value?{...value,routes:value.routes.map(r=>r.documentType===selected?{...r,[slot]:r[slot].map((a,i)=>i===index?{...a,userId:userId||null}:a)}:r)}:value);
 }
 return <section className="panel settings-wide route-config" aria-label="Маршруты согласования">
  <div className="documents-heading"><div className="documents-title"><h2>Маршруты согласования</h2><NoteMark label="Как устроены маршруты"><p>Обязательные роли заданы ТЗ. Назначьте людей своего объекта; новая версия сохраняется отдельно и не меняет старые документы.</p><p>Эта настройка ещё не запускает согласование. Неназначенные места нужно заполнить перед подключением документа. Наблюдение и данные не являются подписью.</p></NoteMark></div>{row?<DeskBadge>{historical?`История · версия ${row.version}`:row.version?`Версия ${row.version}`:'Не сохранено'}</DeskBadge>:null}</div>
  {!projectId?<p className="quiet">Выберите объект в шапке.</p>:<>
   {reading&&!row?<p className="quiet" role="status">Читаем маршруты…</p>:null}
   {error?<p role="alert">{error}</p>:null}
   {row&&draft&&active&&definition?<>
    <div className="route-config-controls"><label className="field"><span>Документ</span><select aria-label="Документ" value={selected} disabled={busy} onChange={e=>setSelected(e.target.value)}>{row.documents.map(d=><option key={d.code} value={d.code}>{d.title}</option>)}</select></label>
    {row.history.length?<label className="field"><span>Версия для просмотра</span><select aria-label="Версия для просмотра" value={historical??''} disabled={busy||reading||dirty} onChange={e=>void read(e.target.value?Number(e.target.value):undefined)}><option value="">Текущая</option>{row.history.map(v=><option key={v.version} value={v.version}>{`Версия ${v.version}`}</option>)}</select></label>:null}</div>
    <div className="route-config-slots">{slots.map(slot=><div className="route-config-slot" key={slot}><h3>{labels[slot]}</h3>
      {active[slot].length?active[slot].map((a,index)=>{
        const people=row.people.filter(p=>p.role===a.role),available=people.some(p=>p.userId===a.userId);
        const additional=slot==='reviewers'&&active.reviewers.findIndex(item=>item.role===a.role)!==index;
        return <div key={`${slot}:${index}`}><label className="field"><span>{roleName(a.role)}</span><select aria-label={`${labels[slot]} — ${roleName(a.role)} ${index+1}`} value={a.userId??''} disabled={busy||reading||!!historical||conflict} onChange={e=>change(slot,index,e.target.value)}><option value="">Не назначен</option>{a.userId&&!available?<option value={a.userId}>Прежний участник недоступен</option>:null}{people.map(p=><option key={p.userId} value={p.userId}>{p.name}</option>)}</select></label>{additional&&!historical?<button className="ghost desk-action" type="button" disabled={busy||reading||conflict} onClick={()=>setDraft(value=>value?{...value,routes:value.routes.map(r=>r.documentType===selected?{...r,reviewers:r.reviewers.filter((_,i)=>i!==index)}:r)}:value)}>Убрать согласующего</button>:null}</div>;
      }):<p className="quiet">{slot==='preparers'?'Система':slot==='reviewers'?'Согласование не требуется':slot==='approvers'?'Утверждение не требуется':'Не предусмотрены'}</p>}
      {slot==='reviewers'&&definition.review.length>0&&active.reviewers.length<3&&!historical?<div className="route-config-add">
        {definition.review.length>1?<label className="field"><span>Роль дополнительного согласующего</span><select aria-label="Роль дополнительного согласующего" disabled={busy||reading||conflict} value={definition.review.includes(extraRole)?extraRole:definition.review[0]} onChange={e=>setExtraRole(e.target.value)}>{definition.review.map(role=><option key={role} value={role}>{roleName(role)}</option>)}</select></label>:null}
        <button className="ghost desk-action" type="button" disabled={busy||reading||conflict} onClick={()=>{const role=definition.review.includes(extraRole)?extraRole:definition.review[0]!;setDraft(value=>value?{...value,routes:value.routes.map(r=>r.documentType===selected?{...r,reviewers:[...r.reviewers,{role,userId:null}]}:r)}:value);}}>Добавить согласующего</button>
      </div>:null}
    </div>)}</div>
    {invalidReviewers?<p className="quiet">Выберите разных участников для добавленных согласований.</p>:null}
    {definition.external.length?<p className="quiet route-config-external">{definition.external.join('. ')}. Загрузка скана и право подписи проверяются отдельно.</p>:null}
    {!historical?<div className="access-actions"><button className="ghost desk-action" type="button" disabled={busy||reading||conflict||invalidReviewers||(!dirty&&row.version>0)} onClick={()=>void save()}>{busy?'Сохраняем…':row.version?'Сохранить версию':'Сохранить первую версию'}</button><button className="ghost desk-action" type="button" disabled={busy||reading} onClick={()=>void read()}>{conflict?'Прочитать текущую версию':dirty?'Отменить изменения':'Обновить'}</button></div>:<button className="ghost desk-action" type="button" disabled={reading} onClick={()=>void read()}>Вернуться к текущей версии</button>}
   </>:!reading?<button className="ghost desk-action" type="button" onClick={()=>void read()}>Повторить чтение</button>:null}
  </>}
  <Flash message={message} pulse={pulse}/>
 </section>;
}
