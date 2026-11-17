import {useEffect,useRef,useState} from 'react';
import type {Session} from './api';
import {ApiError,v1} from './v1';
import {useServerRead} from './server-read';
import {DeskBadge} from './kit';
import {Flash} from './flash';
import {NoteMark} from './note-mark';
import {amount} from './model';
import {clearInspectionCommand,keepInspectionCommand,readInspectionCommand,type InspectionAction} from './internal-inspection-command';
type Participant={userId:string;name:string;role:string};
type Route={version:number;ready:boolean;preparer:Participant|null;responsible:Participant|null;approver:Participant|null};
type Inspection={acceptedPart:{quantity:string;unit:string};state:string;version:number;currentRoute:Route;selfControl:{passed:boolean;blocksNext:boolean}|null;record:{snapshot:{configurationVersion:number;preparer:Participant;responsible:Participant;approver:Participant}}|null;history:{version:number;toState:string;actorName:string;reason:string|null;createdAt:string}[];allowedActions:InspectionAction[]};
const states:Record<string,string>={not_submitted:'Не передано ПТО',awaiting_responsibility:'Ждёт ответственного РП',awaiting_pto:'Ждёт решения ПТО',accepted:'Принято нашим ПТО',returned:'Возвращено ПТО'};
function explain(error:unknown){
 if(!(error instanceof ApiError))return 'Нет ответа сервера. Исходная команда ждёт подтверждения.';
 return ({stale_version:'Состояние изменилось в другом окне. Обновите приёмку и проверьте результат.',route_changed:'Маршрут изменился. Обновите приёмку и проверьте участников.',route_not_configured:'Администратору нужно назначить мастера, РП и ПТО в маршруте объекта.',route_denied:'Действие доступно только закреплённому участнику маршрута.',self_control_required:'Нужен пройденный актуальный самоконтроль задания.',inspection_closed:'Приёмка закрыта. Изменение требует отдельной корректировки.',role_denied:'Этому входу действие недоступно.',not_found:'Часть объёма или объект недоступны этому входу.',invalid_text:'Укажите причину возврата.'} as Record<string,string>)[error.message]??'Сервер не подтвердил действие. Обновите приёмку и проверьте результат.';
}
export function InternalInspection({session,projectId,partId}:{session:Session;projectId:string;partId:string}){
 const path=`/projects/${projectId}/accepted-parts/${partId}/internal-inspection`,key=`helios.internal-inspection:${session.tenantId}:${session.userId}:${projectId}:${partId}`;
 const read=useServerRead(session,path,'',()=>v1<Inspection>(session,path),explain);
 const [pending,setPending]=useState(()=>readInspectionCommand(key)),[reason,setReason]=useState(''),[returning,setReturning]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),active=useRef(true);useEffect(()=>()=>{active.current=false;},[]);
 async function save(action?:InspectionAction){
  if(lock.current)return;const existing=readInspectionCommand(key);
  if(!existing&&(!action||!read.body))return;
  const command=existing??keepInspectionCommand(key,{path,body:{requestId:crypto.randomUUID(),expectedVersion:read.body!.version,action:action!,...(action==='submit'?{expectedRouteVersion:read.body!.currentRoute.version}:{}),...(action==='return'?{reason:reason.trim()}:{} )}});
  lock.current=true;setBusy(true);setPending(command);setError('');setSaved('');
  try{await v1(session,command.path,command.body);clearInspectionCommand(key,command.body.requestId);if(active.current){setPending(null);setReturning(false);setReason('');setSaved('Приёмка подтверждена сервером.');read.retry();}}
  catch(problem){const known=problem instanceof ApiError&&problem.status<500&&problem.status!==429;if(known)clearInspectionCommand(key,command.body.requestId);if(active.current){if(known)setPending(null);setError(explain(problem));}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 const row=read.body,pinned=row?.record?.snapshot;
 return <section className="panel" aria-label="Наш ПТО">
  <div className="panel-head"><h3>Наш ПТО</h3><NoteMark label="О приёмке ПТО"><p>Мастер передаёт принятую часть, РП подтверждает ответственность, закреплённый ПТО принимает её целиком или возвращает с причиной. Объём мастера не меняется. Внешний СК — отдельный этап.</p>{pinned?<p>Маршрут версии {pinned.configurationVersion}: {pinned.preparer.name} → {pinned.responsible.name} → {pinned.approver.name}.</p>:null}</NoteMark></div>
  {saved?<Flash message={saved}/>:null}{error?<p role="alert">{error}</p>:null}
  {read.loading?<p role="status">Читаем приёмку ПТО…</p>:null}{read.error?<p role="alert">{read.error}</p>:null}
  <button className="ghost desk-action" type="button" disabled={busy} onClick={read.retry}>Обновить приёмку</button>
  {pending?<p role="status">Исходная команда ждёт подтверждения. <button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save()}>Повторить приёмку</button></p>:null}
  {row?<>
   <p><DeskBadge tone={row.state==='accepted'?'done':row.state==='returned'?'warn':'neutral'}>{states[row.state]??row.state}</DeskBadge></p>
   <p>Часть: {amount(row.acceptedPart.quantity)} {row.acceptedPart.unit}</p>
   {row.state==='not_submitted'?<p className="quiet">{row.currentRoute.ready?`Ответственный РП: ${row.currentRoute.responsible!.name}. ПТО: ${row.currentRoute.approver!.name}.`:'В маршруте объекта нужно назначить мастера, РП и ПТО.'}</p>:null}
   {['not_submitted','awaiting_pto'].includes(row.state)&&(!row.selfControl?.passed||row.selfControl.blocksNext)?<p role="status">Самоконтроль задания не пройден. Подача и приёмка недоступны.</p>:null}
   {!pending?<div className="dialog-actions">
    {row.allowedActions.includes('submit')?<button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save('submit')}>Передать нашему ПТО</button>:null}
    {row.allowedActions.includes('responsible')?<button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save('responsible')}>Подтвердить ответственность</button>:null}
    {row.allowedActions.includes('approve')?<button className="fill desk-action" type="button" disabled={busy||returning} onClick={()=>void save('approve')}>Принять часть</button>:null}
    {row.allowedActions.includes('return')&&!returning?<button className="ghost desk-action" type="button" disabled={busy} onClick={()=>setReturning(true)}>Вернуть с замечанием</button>:null}
   </div>:null}
   {returning&&!pending&&row.allowedActions.includes('return')?<form onSubmit={e=>{e.preventDefault();void save('return');}}><label className="field"><span>Причина возврата</span><textarea aria-label="Причина возврата" required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="dialog-actions"><button className="fill desk-action" type="submit" disabled={busy||!reason.trim()}>Подтвердить возврат</button><button className="ghost desk-action" type="button" disabled={busy} onClick={()=>setReturning(false)}>Отмена</button></div></form>:null}
   {row.history.length?<details><summary>История приёмки · {row.history.length}</summary><ol>{row.history.map(event=><li key={event.version}><p>{states[event.toState]} · {event.actorName}</p>{event.reason?<p>{event.reason}</p>:null}<p className="quiet">{new Date(event.createdAt).toLocaleString('ru-RU')}</p></li>)}</ol></details>:null}
  </>:null}
 </section>;
}
