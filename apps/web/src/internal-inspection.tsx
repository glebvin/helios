import {useEffect,useRef,useState} from 'react';
import type {Session} from './api';
import {ApiError,v1} from './v1';
import {useServerRead} from './server-read';
import {DeskBadge} from './kit';
import {Flash} from './flash';
import {NoteMark} from './note-mark';
import {amount} from './model';
import {clearInspectionCommand,keepInspectionCommand,readInspectionCommand,type InspectionAction} from './internal-inspection-command';
import {CustomerSubmission} from './customer-submission';
type Participant={userId:string;name:string;role:string};
type Route={version:number;ready:boolean;preparer:Participant|null;responsible:Participant|null;approver:Participant|null};
type Split={originalPartId:string;acceptedPartId:string;returnedPartId:string;acceptedQuantity:string;returnedQuantity:string;reason:string;role:'source'|'accepted'|'returned'};
type Inspection={acceptedPart:{quantity:string;unit:string;replacedBy?:{id:string;quantity:string}|null};state:string;version:number;attemptNumber:number;split:Split|null;resubmission:{needsFreshSelfControl:boolean;participantsReady:boolean}|null;currentRoute:Route;selfControl:{passed:boolean;blocksNext:boolean}|null;requirement:{required:boolean;reason:'hidden'|'subcontract'|'project'|'none'};record:{snapshot:{configurationVersion:number;preparer:Participant;responsible:Participant;approver:Participant}}|null;history:{version:number;action:string;toState:string;actorName:string;reason:string|null;createdAt:string}[];allowedActions:InspectionAction[]};
const states:Record<string,string>={not_submitted:'Не передано ПТО',awaiting_responsibility:'Ждёт ответственного РП',awaiting_pto:'Ждёт решения ПТО',accepted:'Принято нашим ПТО',returned:'Возвращено ПТО',split:'Часть разделена'};
const historyLabel:Record<string,string>={resubmit:'Повторная подача после исправления',partial:'Решение ПТО разделило часть',accepted_share:'Принятая доля',returned_share:'Возвращённая доля'};
function explain(error:unknown){
 if(!(error instanceof ApiError))return 'Нет ответа сервера. Исходная команда ждёт подтверждения.';
 return ({inspection_not_required:'Для этой работы проверка нашего ПТО не включена. Скрытые работы и субподряд отключить нельзя.',external_decision_recorded:'Часть принята внешним СК и закрыта от изменений.',part_superseded:'Часть уже заменена. Обновите карточку; прежнее решение осталось в истории.',stale_version:'Состояние изменилось в другом окне. Обновите приёмку и проверьте результат.',route_changed:'Маршрут изменился. Обновите приёмку и проверьте участников.',route_not_configured:'Администратору нужно назначить мастера, РП и ПТО в маршруте объекта.',route_denied:'Действие доступно только закреплённому участнику маршрута.',self_control_required:'Нужен пройденный актуальный самоконтроль задания.',inspection_closed:'Приёмка закрыта. Изменение требует отдельной корректировки.',role_denied:'Этому входу действие недоступно.',not_found:'Часть объёма или объект недоступны этому входу.',fresh_self_control_required:'После возврата нужен новый успешный самоконтроль задания.',pinned_participant_unavailable:'Один из закреплённых участников потерял доступ. Обратитесь к администратору.',inspection_not_returned:'Повторная подача доступна только после возврата ПТО.',partial_share_required:'Принятая доля должна быть больше нуля и меньше этой части. Остаток возвращается.',invalid_quantity:'Введите число больше нуля с точностью до трёх знаков.',invalid_text:'Укажите причину возврата или что исправлено.',person:'На этого сотрудника нет приказа на сдачу нашему ПТО.',company:'Приказ относится к другой компании.',object:'Приказ выдан на другой объект.',type:'Приказ не разрешает сдачу нашему ПТО.',revoked:'Приказ отозван. Принятие им не подтверждается.',expired:'Срок приказа на сдачу нашему ПТО истёк.',not_started:'Срок приказа на сдачу нашему ПТО ещё не начался.'} as Record<string,string>)[error.message]??'Сервер не подтвердил действие. Обновите приёмку и проверьте результат.';
}
export function InternalInspection({session,projectId,partId}:{session:Session;projectId:string;partId:string}){
 const path=`/projects/${projectId}/accepted-parts/${partId}/internal-inspection`,key=`helios.internal-inspection:${session.tenantId}:${session.userId}:${projectId}:${partId}`;
 const read=useServerRead(session,path,'',()=>v1<Inspection>(session,path),explain);
 const [pending,setPending]=useState(()=>readInspectionCommand(key)),[reason,setReason]=useState(''),[acceptedQuantity,setAcceptedQuantity]=useState(''),[form,setForm]=useState<'return'|'resubmit'|'partial'|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function save(action?:InspectionAction){
  if(lock.current)return;const existing=readInspectionCommand(key);
  if(!existing&&(!action||!read.body))return;
  const command=existing??keepInspectionCommand(key,{path,body:{requestId:crypto.randomUUID(),expectedVersion:read.body!.version,action:action!,...(action==='submit'?{expectedRouteVersion:read.body!.currentRoute.version}:{}),...(['return','resubmit'].includes(action!)?{reason:reason.trim()}:{}),...(action==='partial'?{acceptedQuantity:acceptedQuantity.trim(),reason:reason.trim()}:{})}});
  lock.current=true;setBusy(true);setPending(command);setError('');setSaved('');
  try{await v1(session,command.path,command.body);clearInspectionCommand(key,command.body.requestId);if(active.current){setPending(null);setForm(null);setReason('');setAcceptedQuantity('');setSaved('Приёмка подтверждена сервером.');read.retry();}}
  catch(problem){const known=problem instanceof ApiError&&problem.status<500&&problem.status!==429;if(known)clearInspectionCommand(key,command.body.requestId);if(active.current){if(known)setPending(null);setError(explain(problem));}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 const row=read.body,pinned=row?.record?.snapshot;
 return <><section className="panel" aria-label="Наш ПТО">
  <div className="panel-head"><h3>Наш ПТО</h3><NoteMark label="О приёмке ПТО"><p>Мастер передаёт принятую часть, РП подтверждает ответственность, закреплённый ПТО принимает её целиком, возвращает с причиной или делит на принятую и возвращённую доли. Доли вместе равны этой части и не добавляют объём. Внешний СК — отдельный этап.</p>{pinned?<p>Маршрут версии {pinned.configurationVersion}: {pinned.preparer.name} → {pinned.responsible.name} → {pinned.approver.name}.</p>:null}</NoteMark></div>
  {saved?<Flash message={saved}/>:null}{error?<p role="alert">{error}</p>:null}
  {read.loading?<p role="status">Читаем приёмку ПТО…</p>:null}{read.error?<p role="alert">{read.error}</p>:null}
  <button className="ghost desk-action" type="button" disabled={busy} onClick={read.retry}>Обновить приёмку</button>
  {pending?<p role="status">Исходная команда ждёт подтверждения. <button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save()}>Повторить приёмку</button></p>:null}
  {row?<>
   {row.split?<p>Принято {amount(row.split.acceptedQuantity)} {row.acceptedPart.unit}, возвращено {amount(row.split.returnedQuantity)} {row.acceptedPart.unit}. Обе доли связаны с исходной частью.</p>:row.acceptedPart.replacedBy?<p className="quiet">Количество заменено корректировкой. Прежняя приёмка сохранена в истории.</p>:null}
   <p><DeskBadge tone={row.state==='accepted'?'done':row.state==='returned'?'warn':'neutral'}>{states[row.state]??row.state}</DeskBadge></p>
   {row.requirement?.reason==='hidden'?<p>Скрытые работы проверяет наш ПТО. Настройка объекта это не отменяет.</p>:null}
   {row.requirement?.reason==='subcontract'?<p>Субподрядные работы проверяет наш ПТО. Настройка объекта это не отменяет.</p>:null}
   {row.requirement?.reason==='none'?<p>Для остальных работ этого объекта проверка нашего ПТО выключена.</p>:null}
   <p>Часть: {amount(row.acceptedPart.quantity)} {row.acceptedPart.unit} · Попытка {row.attemptNumber}</p>
   {row.state==='not_submitted'?<p className="quiet">{row.currentRoute.ready?`Ответственный РП: ${row.currentRoute.responsible!.name}. ПТО: ${row.currentRoute.approver!.name}.`:'В маршруте объекта нужно назначить мастера, РП и ПТО.'}</p>:null}
   {['not_submitted','awaiting_pto'].includes(row.state)&&(!row.selfControl?.passed||row.selfControl.blocksNext)?<p role="status">Самоконтроль задания не пройден. Подача и приёмка недоступны.</p>:null}
   {row.state==='returned'?<p className="quiet">{row.resubmission?.needsFreshSelfControl?'Пройдите новый самоконтроль задания после возврата и обновите приёмку.':!row.resubmission?.participantsReady?'Один из закреплённых участников недоступен. Обратитесь к администратору.':'После устранения замечания мастер может повторно передать ту же часть. Объём и прежние решения сохраняются.'}</p>:null}
   {!pending?<div className="dialog-actions">
    {row.allowedActions.includes('submit')?<button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save('submit')}>Передать нашему ПТО</button>:null}
    {row.allowedActions.includes('resubmit')&&!form?<button className="fill desk-action" type="button" disabled={busy} onClick={()=>setForm('resubmit')}>Повторно передать ПТО</button>:null}
    {row.allowedActions.includes('responsible')?<button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save('responsible')}>Подтвердить ответственность</button>:null}
    {row.allowedActions.includes('approve')?<button className="fill desk-action" type="button" disabled={busy||Boolean(form)} onClick={()=>void save('approve')}>Принять часть</button>:null}
    {row.allowedActions.includes('partial')&&!form?<button className="fill desk-action" type="button" disabled={busy} onClick={()=>setForm('partial')}>Принять часть объёма</button>:null}
    {row.allowedActions.includes('return')&&!form?<button className="ghost desk-action" type="button" disabled={busy} onClick={()=>setForm('return')}>Вернуть с замечанием</button>:null}
   </div>:null}
   {form&&!pending&&row.allowedActions.includes(form)?<form onSubmit={e=>{e.preventDefault();void save(form);}}>
    {form==='partial'?<><label className="field"><span>Принятый объём, обязательно</span><input aria-label="Принятый объём" inputMode="decimal" required disabled={busy} value={acceptedQuantity} onChange={e=>setAcceptedQuantity(e.target.value.replace(',','.'))}/></label><p className="quiet">Остаток этой части возвращается с причиной и не прибавляется к объёму.</p></>:null}
    <label className="field"><span>{form==='resubmit'?'Что исправлено, обязательно':form==='partial'?'Причина возврата остатка, обязательно':'Причина возврата, обязательно'}</span><textarea aria-label={form==='resubmit'?'Что исправлено':form==='partial'?'Причина возврата остатка':'Причина возврата'} required maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <div className="dialog-actions"><button className="fill desk-action" type="submit" disabled={busy||!reason.trim()||(form==='partial'&&!acceptedQuantity.trim())}>{form==='resubmit'?'Подтвердить повторную подачу':form==='partial'?'Подтвердить частичную приёмку':'Подтвердить возврат'}</button><button className="ghost desk-action" type="button" disabled={busy} onClick={()=>setForm(null)}>Отмена</button></div>
   </form>:null}
   {row.history.length?<details><summary>История приёмки · {row.history.length}</summary><ol>{row.history.map(event=><li key={event.version}><p>{historyLabel[event.action]??states[event.toState]} · {event.actorName}</p>{event.reason?<p>{event.reason}</p>:null}<p className="quiet">{new Date(event.createdAt).toLocaleString('ru-RU')}</p></li>)}</ol></details>:null}
  </>:null}
 </section>
 <CustomerSubmission session={session} projectId={projectId} partId={partId}/>
 </>
}
