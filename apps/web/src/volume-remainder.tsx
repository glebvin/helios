import {useEffect,useRef,useState} from 'react';
import type {Session} from './api';
import {ApiError,v1} from './v1';
import {amount} from './model';
import {NoteMark} from './note-mark';
import {InternalInspection} from './internal-inspection';
import {clearRemainderCommand,keepRemainderCommand,readRemainderCommand} from './volume-remainder-command';
type Event={id:string;version:number;action:'present'|'review';presentedQuantity:string;acceptedQuantity:string|null;acceptedPartId:string|null;reason:string|null;actorName:string;createdAt:string};
export type Remainder={version:number;remainingQuantity:string;needsFreshSelfControl:boolean;allowedActions:('present'|'review')[];presentation:Event|null;history:Event[]};
function message(problem:unknown){
 if(!(problem instanceof ApiError))return 'Нет ответа сервера. Исходная команда ждёт подтверждения.';
 return ({stale_version:'Остаток изменился в другом окне. Обновите карточку и проверьте результат.',remainder_state_changed:'Предъявление уже изменилось. Обновите карточку.',quantity_exceeds_remainder:'Количество больше доступного остатка или текущего предъявления.',positive_quantity_required:'Предъявляемый остаток должен быть больше нуля.',invalid_quantity:'Введите число от нуля с точностью до трёх знаков.',reason_required:'Укажите основание исправления или причину неполного принятия.',invalid_text:'Укажите непустое основание до 500 символов.',self_control_required:'Нужен последний успешный самоконтроль задания.',fresh_self_control_required:'После последнего решения нужен новый успешный самоконтроль.',checklist_changed:'Самоконтроль изменился. Обновите карточку.',role_denied:'Изменение остатка доступно действующему мастеру объекта.',not_found:'Исходное предъявление недоступно этому входу.'}as Record<string,string>)[problem.message]??'Сервер не подтвердил действие. Обновите карточку или повторите исходную команду.';
}
export function VolumeRemainder({session,projectId,reportId,unit,total,row,checklistId,onSaved}:{session:Session;projectId:string;reportId:string;unit:string;total:string;row:Remainder;checklistId:string;onSaved:(confirmed?:boolean)=>void}){
 const path=`/projects/${projectId}/volume-reviews/${reportId}/remainder`,key=`helios.volume-remainder:${session.tenantId}:${session.userId}:${projectId}:${reportId}`;
 const[pending,setPending]=useState(()=>readRemainderCommand(key)),[form,setForm]=useState<'present'|'review'|null>(null),[quantity,setQuantity]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),active=useRef(true);useEffect(()=>()=>{active.current=false;},[]);
 function open(action:'present'|'review'){setForm(action);setQuantity(action==='present'?row.remainingQuantity:row.presentation!.presentedQuantity);setReason('');setError('');}
 async function save(){
  if(lock.current)return;
  const command=readRemainderCommand(key)??(form?keepRemainderCommand(key,{path,body:{requestId:crypto.randomUUID(),expectedVersion:row.version,action:form,quantity,checklistRunId:checklistId,reason:reason.trim()||null}}):null);if(!command)return;
  lock.current=true;setBusy(true);setPending(command);setError('');
  try{await v1(session,command.path,command.body);clearRemainderCommand(key,command.body.requestId);if(active.current){setPending(null);setForm(null);onSaved(true);}}
  catch(problem){const known=problem instanceof ApiError&&problem.status<500&&problem.status!==429;if(known)clearRemainderCommand(key,command.body.requestId);if(active.current){if(known)setPending(null);setError(message(problem));}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 return <section className="panel">
  <div className="panel-head"><h3>Остаток объёма</h3><NoteMark label="Как считается остаток"><p>Исходный факт и первое решение сохраняются. Принимаются только связанные доработанные части; один объём не считается повторно.</p></NoteMark></div>
  <p>Принято всего: {amount(total)} {unit}. Осталось: {amount(row.remainingQuantity)} {unit}.</p>
  {error?<p role="alert">{error}</p>:null}
  {row.presentation?<p>Предъявлен остаток {amount(row.presentation.presentedQuantity)} {unit}. Ждёт решения мастера.</p>:null}
  {session.role==='master'&&row.needsFreshSelfControl&&row.remainingQuantity!=='0.000'?<p className="quiet">После последнего решения пройдите новый успешный самоконтроль задания и обновите карточку.</p>:null}
  <button className="ghost desk-action" type="button" disabled={busy} onClick={()=>onSaved()}>Обновить остаток</button>
  {pending?<p role="status">Исходная команда ждёт подтверждения. <button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save()}>Повторить запись остатка</button></p>:null}
  {!pending&&!form?<div className="dialog-actions">{row.allowedActions.map(action=><button key={action} className="fill desk-action" type="button" onClick={()=>open(action)}>{action==='present'?'Предъявить остаток':'Принять остаток'}</button>)}</div>:null}
  {!pending&&form&&row.allowedActions.includes(form)?<form onSubmit={e=>{e.preventDefault();void save();}}>
   <fieldset style={{border:0,padding:0,margin:0,minWidth:0}} disabled={busy}>
    <label className="field"><span>{form==='present'?'Доработанный объём':'Принято из остатка'}</span><input aria-label={form==='present'?'Доработанный объём':'Принято из остатка'} inputMode="decimal" required value={quantity} onChange={e=>setQuantity(e.target.value.replace(',','.'))}/></label>
    <label className="field"><span>{form==='present'?'Что исправлено в остатке':'Причина неполного принятия'}</span><textarea aria-label={form==='present'?'Что исправлено в остатке':'Причина неполного принятия'} required={form==='present'} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <div className="dialog-actions"><button className="fill desk-action" type="submit" disabled={form==='present'&&!reason.trim()}>{form==='present'?'Подтвердить предъявление остатка':'Подтвердить приём остатка'}</button><button className="ghost desk-action" type="button" onClick={()=>setForm(null)}>Отмена</button></div>
   </fieldset>
  </form>:null}
  {row.history.length?<details><summary>История остатка · {row.history.length}</summary><ol>{row.history.map(event=><li key={event.version}><p>{event.action==='present'?`Предъявлено ${amount(event.presentedQuantity)}`:`Принято ${amount(event.acceptedQuantity??'0')}`} {unit} · {event.actorName}</p>{event.reason?<p>{event.reason}</p>:null}<p className="quiet">{new Date(event.createdAt).toLocaleString('ru-RU')}</p></li>)}</ol></details>:null}
  {row.history.filter(event=>event.acceptedPartId).map(event=><details key={event.id}><summary>ПТО: часть {amount(event.acceptedQuantity!)} {unit}</summary><InternalInspection session={session} projectId={projectId} partId={event.acceptedPartId!}/></details>)}
 </section>;
}
