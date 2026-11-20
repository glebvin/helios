import {useEffect,useRef,useState} from 'react';
import type {Session} from './api';
import {ApiError,v1} from './v1';
import {amount} from './model';
import {NoteMark} from './note-mark';
import {clearCorrectionCommand,keepCorrectionCommand,readCorrectionCommand} from './volume-correction-command';
export type CurrentPart={id:string;quantity:string};
export type Correction={version:number;allowed:boolean;needsFreshSelfControl:boolean;history:{id:string;previousPartId:string;quantity:string;reason:string;actorName:string;createdAt:string}[]};
function explain(problem:unknown){
 if(!(problem instanceof ApiError))return 'Нет ответа сервера. Исходная корректировка ждёт подтверждения.';
 return ({stale_version:'Объём изменился в другом окне. Обновите карточку и проверьте результат.',part_superseded:'Эта часть уже заменена. Обновите карточку.',remainder_pending:'Сначала завершите решение по предъявленному остатку.',quantity_unchanged:'Новое количество совпадает с прежним.',quantity_exceeds_submitted:'Сумма действующих частей не может превышать предъявленный объём.',fresh_self_control_required:'После последнего решения нужен новый успешный самоконтроль.',self_control_required:'Нужен последний успешный самоконтроль задания.',checklist_changed:'Самоконтроль изменился. Обновите карточку.',invalid_quantity:'Введите число от нуля с точностью до трёх знаков.',invalid_text:'Укажите основание до 500 символов.',role_denied:'Корректировка доступна действующему мастеру объекта.',not_found:'Объём недоступен этому входу.'}as Record<string,string>)[problem.message]??'Сервер не подтвердил корректировку. Обновите карточку или повторите исходную команду.';
}
export function VolumeCorrection({session,projectId,reportId,unit,row,parts,checklistId,onSaved}:{session:Session;projectId:string;reportId:string;unit:string;row:Correction;parts:CurrentPart[];checklistId:string;onSaved:(confirmed?:boolean)=>void}){
 const path=`/projects/${projectId}/volume-reviews/${reportId}/corrections`,key=`helios.volume-correction:${session.tenantId}:${session.userId}:${projectId}:${reportId}`;
 const[pending,setPending]=useState(()=>readCorrectionCommand(key)),[part,setPart]=useState(''),[quantity,setQuantity]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function save(){
  if(lock.current)return;
  const command=readCorrectionCommand(key)??keepCorrectionCommand(key,{path,body:{requestId:crypto.randomUUID(),expectedVersion:row.version,previousPartId:part,quantity,checklistRunId:checklistId,reason:reason.trim()}});
  lock.current=true;setBusy(true);setPending(command);setError('');
  try{await v1(session,command.path,command.body);clearCorrectionCommand(key,command.body.requestId);if(active.current){setPending(null);setPart('');setReason('');onSaved(true);}}
  catch(problem){const known=problem instanceof ApiError&&problem.status<500&&problem.status!==429;if(known)clearCorrectionCommand(key,command.body.requestId);if(active.current){if(known)setPending(null);setError(explain(problem));}}
  finally{lock.current=false;if(active.current)setBusy(false);}
 }
 return <section className="panel" aria-label="Корректировки объёма">
  <div className="panel-head"><h3>Корректировки</h3><NoteMark label="Как работает корректировка"><p>Новая версия заменит выбранную часть в текущем итоге. Прежнее количество и приёмка сохранятся в истории. Новое количество проходит ПТО заново. Ноль снимает часть с текущего итога.</p></NoteMark></div>
  {error?<p role="alert">{error}</p>:null}
  {session.role==='master'&&row.needsFreshSelfControl&&parts.length?<p className="quiet">Для изменения количества нужен новый успешный самоконтроль после последнего решения.</p>:null}
  <button type="button" className="ghost desk-action" disabled={busy} onClick={()=>onSaved()}>Обновить корректировки</button>
  {pending?<p role="status">Исходная корректировка ждёт подтверждения. <button type="button" className="fill desk-action" disabled={busy} onClick={()=>void save()}>Повторить корректировку</button></p>:null}
  {row.allowed&&!pending&&!part?<div className="dialog-actions"><button type="button" className="ghost desk-action" onClick={()=>{setPart(parts[0].id);setQuantity(parts[0].quantity);setReason('');}}>Корректировать количество</button></div>:null}
  {part&&row.allowed&&!pending?<form onSubmit={e=>{e.preventDefault();void save();}}><fieldset style={{border:0,padding:0,margin:0,minWidth:0}} disabled={busy}>
   {parts.length>1?<label className="field"><span>Действующая часть</span><select aria-label="Действующая часть" value={part} onChange={e=>{setPart(e.target.value);setQuantity(parts.find(p=>p.id===e.target.value)!.quantity);}}>{parts.map((p,i)=><option value={p.id} key={p.id}>Часть {i+1} · {amount(p.quantity)} {unit}</option>)}</select></label>:null}
   <label className="field"><span>Новое количество</span><input aria-label="Новое количество" inputMode="decimal" required value={quantity} onChange={e=>setQuantity(e.target.value.replace(',','.'))}/></label>
   <label className="field"><span>Основание корректировки</span><textarea aria-label="Основание корректировки" required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <p className="quiet">Прежняя приёмка не распространяется на новое количество.</p>
   <div className="dialog-actions"><button type="submit" className="fill desk-action" disabled={!reason.trim()}>Подтвердить корректировку</button><button type="button" className="ghost desk-action" onClick={()=>setPart('')}>Отмена</button></div>
  </fieldset></form>:null}
  {row.history.length?<details><summary>История корректировок · {row.history.length}</summary><ol>{row.history.map(event=><li key={event.id}><p>Новое количество: {amount(event.quantity)} {unit} · {event.actorName}</p><p>{event.reason}</p><p className="quiet">{new Date(event.createdAt).toLocaleString('ru-RU')}</p></li>)}</ol></details>:null}
 </section>;
}
