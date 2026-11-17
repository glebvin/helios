import {VolumeRemainder,type Remainder} from './volume-remainder';
import { InternalInspection } from './internal-inspection';
import { useEffect, useRef, useState } from 'react';
import type { Session } from './api';
import { ApiError, v1 } from './v1';
import { useServerRead } from './server-read';
import { DeskBadge, DeskEmpty, StatGrid } from './kit';
import { Dialog } from './dialog';
import { Flash } from './flash';
import { NoteMark } from './note-mark';
import { amount } from './model';
import { civilLabel } from './scope';
import { clearReviewCommand, keepReviewCommand, readReviewCommand } from './volume-review-command';

type Review = {id: string; acceptedPartId: string | null; acceptedQuantity: string; differenceQuantity: string; reason: string | null; actorName: string; createdAt: string};
type Report = {reportId: string; title: string; unit: string; submittedQuantity: string; totalAcceptedQuantity?:string|null; remainder?:Remainder|null; version: number; review: Review | null; checklist: {id: string; version: number; passed: boolean; blocksNext: boolean} | null};
type Page = {items: Report[]; total: number; totals: {unit: string; submittedQuantity: string; acceptedQuantity: string | null; reviewedReports: number; unreviewedReports: number}[]};
function message(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Нет ответа сервера. Исходный результат пока не подтверждён.';
  const codes: Record<string,string> = {invalid_quantity:'Введите число от нуля с точностью до трёх знаков.',quantity_exceeds_submitted:'Нельзя принять больше предъявленного.',reason_required:'Укажите причину разницы с предъявленным объёмом.',self_control_required:'Нужен пройденный самоконтроль задания.',checklist_changed:'Самоконтроль изменился. Обновите карточку и проверьте результат.',stale_version:'Решение уже записано другим окном. Обновите карточку.',review_closed:'Решение закрыто. Для изменения нужна отдельная корректировка.',role_denied:'Этому входу запись решения мастера недоступна.',not_found:'Предъявление или объект недоступны этому входу.'};
  return codes[error.message] ?? 'Сервер не подтвердил действие. Повторите чтение или исходную команду.';
}

export function VolumeReviews({session,projectId,projectName,day,notice,onBack}: {session:Session;projectId:string;projectName:string;day:string;notice:string;onBack:()=>void}) {
  const [offset,setOffset] = useState(0), [selected,setSelected] = useState(''), [pickedDay,setPickedDay] = useState(day);
  const limit=25,blocked=notice||(!projectId||!pickedDay?'Выберите объект и день предъявления.':'');
  const read=useServerRead(session,`${projectId}:${pickedDay}:${offset}`,blocked,()=>v1<Page>(session,`/projects/${projectId}/volume-reviews?day=${pickedDay}&limit=${limit}&offset=${offset}`),message);
  return <section className="page">
    <div className="documents-heading"><button className="ghost desk-action" type="button" onClick={onBack}>К фактам</button></div>
    <div><h1>Приёмка</h1><p className="sub">{blocked||`${projectName} · ${civilLabel(pickedDay)}`}</p></div>
    <div className="panel-head"><h2>Самоконтроль мастера</h2><NoteMark label="Этап приёмки"><p>Мастер подтверждает фактический объём после самоконтроля. После решения мастера часть передаётся нашему ПТО. Внешний СК — отдельный этап.</p></NoteMark></div>
    <label className="field" style={{maxWidth:220}}><span>День предъявления</span><input type="date" aria-label="День предъявления" value={pickedDay} onChange={event=>{setPickedDay(event.target.value);setOffset(0);setSelected('');}}/></label>
    {blocked?<DeskEmpty title="День не подтверждён" description={blocked}/>:null}
    {read.loading?<p role="status" className="quiet">Читаем предъявления…</p>:null}
    {read.error?<p role="alert">{read.error} <button type="button" className="ghost desk-action" onClick={read.retry}>Повторить чтение</button></p>:null}
    {read.body?<>
      {read.body.totals.map(total=><StatGrid key={total.unit} items={[{value:`${amount(total.submittedQuantity)} ${total.unit}`,label:'Предъявлено'},{value:total.acceptedQuantity===null?'—':`${amount(total.acceptedQuantity)} ${total.unit}`,label:'Принято мастером'},{value:String(total.unreviewedReports),label:'Ждут решения'}]}/>)}
      {read.body.items.length===0?<DeskEmpty title="За этот день предъявлений нет" description="Пустой список не означает, что работу приняли или отклонили."/>:<div className="sheet-wrap volume-review-desktop"><table className="sheet facts-grid"><thead><tr><th>Работа</th><th>Предъявлено</th><th>Принято мастером</th><th>Состояние</th><th></th></tr></thead><tbody>{read.body.items.map(row=><tr key={row.reportId}>
        <td><b>{row.title}</b></td><td>{amount(row.submittedQuantity)} {row.unit}</td><td>{row.review===null?'—':`${amount(row.totalAcceptedQuantity??row.review.acceptedQuantity)} ${row.unit}`}</td>
        <td><DeskBadge tone={row.review===null?'neutral':row.review.acceptedPartId?'done':'warn'}>{row.review===null?'Ждёт мастера':row.review.acceptedPartId?'Решение записано':'Не принято'}</DeskBadge></td>
        <td><button className="ghost desk-action" type="button" aria-label={`Открыть предъявление ${row.title}`} onClick={()=>setSelected(row.reportId)}>Открыть</button></td>
      </tr>)}</tbody></table></div>}
      <div className="volume-review-mobile">{read.body.items.map(row=><article className="panel" key={row.reportId}>
        <div className="panel-head"><h3>{row.title}</h3><DeskBadge>{row.review===null?'Ждёт мастера':row.review.acceptedPartId?'Решение записано':'Не принято'}</DeskBadge></div>
        <p>Предъявлено {amount(row.submittedQuantity)} {row.unit}</p><p>Принято мастером: {row.review===null?'—':`${amount(row.totalAcceptedQuantity??row.review.acceptedQuantity)} ${row.unit}`}</p>
        <button className="ghost desk-action" type="button" aria-label={`Открыть предъявление ${row.title}`} onClick={()=>setSelected(row.reportId)}>Открыть</button>
      </article>)}</div>
      {read.body.total>limit?<div className="rowline"><button className="ghost desk-action" type="button" disabled={offset===0} onClick={()=>setOffset(Math.max(0,offset-limit))}>Назад</button><span>{offset+1}–{Math.min(offset+limit,read.body.total)} из {read.body.total}</span><button className="ghost desk-action" type="button" disabled={offset+limit>=read.body.total} onClick={()=>setOffset(offset+limit)}>Далее</button></div>:null}
    </>:null}
    {selected?<ReviewDialog key={selected} session={session} projectId={projectId} reportId={selected} onClose={()=>setSelected('')} onSaved={read.retry}/>:null}
  </section>;
}

function ReviewDialog({session,projectId,reportId,onClose,onSaved}: {session:Session;projectId:string;reportId:string;onClose:()=>void;onSaved:()=>void}) {
  const path=`/projects/${projectId}/volume-reviews/${reportId}`,key=`helios.volume-review:${session.tenantId}:${session.userId}:${projectId}:${reportId}`;
  const [pending,setPending]=useState(()=>readReviewCommand(key));
  const [quantity,setQuantity]=useState<string|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[saved,setSaved]=useState(''),[busy,setBusy]=useState(false);
  const [savedPulse,setSavedPulse]=useState(0);
  const lock=useRef(false),active=useRef(true);
  useEffect(()=>()=>{active.current=false;},[]);
  const read=useServerRead(session,path,'',()=>v1<Report>(session,path),message);
  const row=read.body;
  async function save() {
    if(lock.current||!row)return;
    const command=readReviewCommand(key)??keepReviewCommand(key,{path,body:{requestId:crypto.randomUUID(),expectedVersion:row.version,checklistRunId:row.checklist?.id??'',acceptedQuantity:quantity??row.submittedQuantity,reason:reason.trim()||null}});
    lock.current=true;setBusy(true);setPending(command);setError('');
    try{
      await v1(session,command.path,command.body);clearReviewCommand(key,command.body.requestId);
      if(active.current){setPending(null);setSaved('Решение мастера подтверждено сервером.');read.retry();onSaved();}
    }catch(problem){
      const known=problem instanceof ApiError&&problem.status<500&&problem.status!==429;
      if(known)clearReviewCommand(key,command.body.requestId);
      if(active.current){if(known)setPending(null);setError(message(problem));}
    }finally{lock.current=false;if(active.current)setBusy(false);}
  }
  return <Dialog title="Самоконтроль объёма" onClose={()=>{if(!lock.current)onClose();}}>
    {saved?<Flash message={saved} pulse={savedPulse}/>:null}
    {read.loading?<p role="status">Читаем предъявление…</p>:null}
    {read.error?<p role="alert">{read.error}</p>:null}
    {error?<p role="alert">{error}</p>:null}
    {read.error||error?<button className="ghost desk-action" type="button" onClick={read.retry}>Обновить карточку</button>:null}
    {row?<>
      <h3>{row.title}</h3><p>Предъявлено {amount(row.submittedQuantity)} {row.unit}.</p>
      {row.review?<section className="panel"><h3>{row.remainder?.history.length?'Первое решение мастера':row.review.acceptedPartId?'Принято мастером':'Не принято'}</h3><p>{amount(row.review.acceptedQuantity)} {row.unit}. Разница: {amount(row.review.differenceQuantity)} {row.unit}.</p>{row.review.reason?<p>{row.review.reason}</p>:null}<p className="quiet">{row.review.actorName} · {new Date(row.review.createdAt).toLocaleString('ru-RU')}</p><p className="quiet">Решение сохранено в истории. Изменение закрытого результата требует отдельной корректировки.</p></section>:null}
      {pending?<p role="status">Исходное решение ждёт подтверждения. <button className="fill desk-action" type="button" disabled={busy} onClick={()=>void save()}>Повторить решение</button></p>:null}
      {!row.review&&session.role==='master'?<form onSubmit={event=>{event.preventDefault();void save();}}>
        <p className="quiet">{row.checklist?.passed&&!row.checklist.blocksNext?`Самоконтроль №${row.checklist.version} пройден.`:'Для решения нужен пройденный самоконтроль задания.'}</p>
        <fieldset style={{border:0,padding:0,margin:0,minWidth:0}} disabled={busy||Boolean(pending)}>
          <label className="field"><span>Принято мастером</span><input aria-label="Принято мастером" inputMode="decimal" value={quantity??row.submittedQuantity} onChange={event=>setQuantity(event.target.value.replace(',','.'))}/></label>
          <label className="field"><span>Причина разницы</span><textarea aria-label="Причина разницы" maxLength={500} value={reason} onChange={event=>setReason(event.target.value)}/></label>
          <button className="fill desk-action" type="submit" disabled={!row.checklist?.passed||row.checklist.blocksNext}>Подтвердить объём</button>
        </fieldset>
      </form>:null}
      {row.remainder?<VolumeRemainder key={`${session.userId}:${projectId}:${reportId}`} session={session} projectId={projectId} reportId={reportId} unit={row.unit} total={row.totalAcceptedQuantity??row.review?.acceptedQuantity??'0'} row={row.remainder} checklistId={row.checklist?.id??''} onSaved={confirmed=>{if(confirmed){setSaved('Остаток подтверждён сервером.');setSavedPulse(value=>value+1);}read.retry();onSaved();}}/>:null}
      {row.review?.acceptedPartId?<InternalInspection key={`${session.userId}:${projectId}:${row.review.acceptedPartId}`} session={session} projectId={projectId} partId={row.review.acceptedPartId}/>:null}
    </>:null}
    <div className="dialog-actions"><button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Закрыть</button></div>
  </Dialog>;
}
