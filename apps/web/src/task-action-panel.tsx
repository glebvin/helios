import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { staffRequest } from "./staff-form";
import { ApiError, v1 } from "./v1";
import {
  taskActionBody, taskActionError, taskActionLabel, taskActionProblem, taskActions, taskNeedsReason,
  type TaskActionName,
} from "./task-action";
import { taskStatusText, type ServerTask } from "./task-read";

type RouteInfo={configured:boolean;taskVersion:number;allowedActions:TaskActionName[]|null;route:{attempt:{number:number;configurationVersion:number}|null;currentConfigurationVersion:number|null;holder:{userId:string;name:string}|null;dueAt:string|null;deadlineState:string;nextStep:string;history:{id:string;action:TaskActionName;actorName:string;reason:string|null;createdAt:string}[]}|null};
function deadlineText(dueAt:string|null,state:string,timezone:string){
  if(!dueAt||state==="not-configured")return "Не настроен";
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:timezone||"UTC",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(dueAt));
  const pick=(type:string)=>parts.find((part)=>part.type===type)?.value??"";
  const when=`${pick("day")}.${pick("month")}.${pick("year")} ${pick("hour")}:${pick("minute")}`;
  return state==="overdue"?`Срок прошёл, ${when}`:when;
}
const routedLabel=(action:TaskActionName,routed:boolean)=>routed&&action==='publish'?'Утвердить и опубликовать':routed&&action==='submit'?'Отправить РП':taskActionLabel(action);
const nextStepText:Record<string,string>={'approve-or-return':'РП проверяет и утверждает или возвращает','reopen-and-submit':'Мастер возвращает в черновик и отправляет по маршруту','prepare-and-submit':'Мастер готовит и отправляет РП',execute:'Задание можно выполнять',none:'Маршрут завершён'};
const historyText:Record<TaskActionName,string>={submit:'Отправлено РП',publish:'Утверждено и опубликовано',reject:'Возвращено РП',reopen:'Возвращено в черновик',cancel:'Отменено'};

const describe = (reason: unknown) => taskActionError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");

export function TaskActionPanel({ session, projectId, task, onDone, timezone="UTC" }: { session: Session; projectId: string; task: ServerTask; onDone: () => void; timezone?:string }) {
  const [info,setInfo]=useState<{key:string;value:RouteInfo}|null>(null),[routeError,setRouteError]=useState(''),[readPass,setReadPass]=useState(0);
  const key=`${session.token}:${session.tenantId}:${projectId}:${task.id}:${task.version}:${readPass}`;
  useEffect(()=>{
    let live=true;setRouteError('');
    void v1<RouteInfo>(session,`/projects/${projectId}/tasks/${task.id}/route`).then(value=>{if(live)setInfo({key,value});}).catch(()=>{if(live){setInfo(null);setRouteError('Маршрут не прочитан. Действия временно недоступны.');}});
    return()=>{live=false;};
  },[key]);
  const current=info?.key===key?info.value:null,routed=current?.configured===true;
  const actions=current?(routed?current.allowedActions??[]:taskActions(session.role,task.status)):[];
  const [choice, setChoice] = useState<{action:TaskActionName;task:ServerTask;label:string}|null>(null);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==='visible'&&!choice)setReadPass(n=>n+1);};window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);},[choice]);
  const body=!current?<section className="panel" aria-label="Согласование"><h2>Согласование</h2>{routeError?<p role="alert">{routeError} <button className="ghost desk-action" type="button" onClick={()=>setReadPass(n=>n+1)}>Повторить чтение</button></p>:<p className="quiet" role="status">Читаем маршрут…</p>}</section>:
  current.taskVersion!==task.version?<section className="panel" aria-label="Согласование"><h2>Согласование</h2><p className="quiet">Задание уже изменилось в другом окне. Прочитайте его перед следующим действием.</p><button className="ghost desk-action" type="button" onClick={()=>{setChoice(null);setReadPass(n=>n+1);onDone();}}>Прочитать актуальное задание</button></section>:
  !actions.length&&!routed?null:
  <section className="panel" aria-label={routed?"Согласование":"Публикация"}>
    <div className="panel-head">
      <h2>{routed?"Согласование":"Публикация"}</h2>
      <NoteMark label="Про публикацию"><p>Колонка на доске сменится только после ответа сервера. Для задания по маршруту причина и участники сохраняются в истории.</p></NoteMark>
    </div>
    {routed&&current.route?<div className="daily-route-facts">
      <div><span className="quiet">Сейчас у</span><b>{current.route.holder?.name??(task.status==='draft'?'Мастер не назначен':'—')}</b></div>
      <div><span className="quiet">Следующий шаг</span><b>{nextStepText[current.route.nextStep]??'Обновите маршрут'}</b></div>
      <div><span className="quiet">Срок</span><b className={current.route.deadlineState==="overdue"?"orders-warn":undefined}>{deadlineText(current.route.dueAt,current.route.deadlineState,timezone)}</b></div>
      <p className="quiet">{current.route.attempt?`Попытка ${current.route.attempt.number} · настройка версии ${current.route.attempt.configurationVersion}`:'По маршруту ещё не отправлено'}{task.status==='draft'&&current.route.attempt&&current.route.currentConfigurationVersion!==current.route.attempt.configurationVersion?` · следующая отправка по версии ${current.route.currentConfigurationVersion}`:''}.</p>
    </div>:null}
    <div className="template-bar">
      {actions.map((action) => <button className={action === "publish" || action === "submit" ? "fill desk-action" : "ghost desk-action"} key={action} type="button" onClick={() => setChoice({action,task:structuredClone(task),label:routedLabel(action,routed)})}>{routedLabel(action,routed)}</button>)}
    </div>
    {routed&&current.route?.history.length?<details className="daily-route-history"><summary>История согласования · {current.route.history.length}</summary><ol>{current.route.history.map(event=><li key={event.id}><div><b>{historyText[event.action]}</b><span className="quiet">{event.actorName} · {new Intl.DateTimeFormat('ru-RU',{timeZone:timezone||'UTC',dateStyle:'short',timeStyle:'short'}).format(new Date(event.createdAt))}</span></div>{event.reason?<p>{event.reason}</p>:null}</li>)}</ol></details>:null}

  </section>;
  return <>{body}<Flash message={saved} pulse={pulse}/>{choice ? <ActionDialog session={session} projectId={projectId} task={choice.task} action={choice.action} label={choice.label} onRead={() => { setChoice(null); setReadPass(n=>n+1); onDone(); }} onClose={() => setChoice(null)} onSaved={(row) => {
      setChoice(null); setReadPass(n=>n+1);
      setSaved(`Сервер записал статус «${taskStatusText(row.status)}».`);
      setPulse((value) => value + 1);
      onDone();
    }} /> : null}</>;
}

function ActionDialog({ session, projectId, task, action, label, onRead, onClose, onSaved }: {
  session: Session;
  projectId: string;
  task: ServerTask;
  action: TaskActionName;
  label: string;
  onRead: () => void;
  onClose: () => void;
  onSaved: (row: ServerTask) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(true);
  const lock = useRef(false);
  const request = useRef({ id: "", key: "" });
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pendingKey = `helios.task-action:${session.tenantId}:${session.userId}:${task.id}:${action}`;
  const problem = taskActionProblem(action, reason);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit() {
    if (lock.current || problem) return;
    const key = JSON.stringify(taskActionBody(action, task.version, "", reason));
    if (!request.current.id) {
      try { const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous; } catch { /* The open form can still repeat the same attempt. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const row = await v1<ServerTask>(session, `/projects/${projectId}/tasks/${task.id}/${action}`, taskActionBody(action, task.version, request.current.id, reason));
      if (!row.status) throw new ApiError(502, "missing_status");
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      onSaved(row);
    } catch (failure) { setError(describe(failure)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={label} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      <p className="quiet">{task.title}</p>
      {taskNeedsReason(action) ? <label className="field"><span>Причина</span><input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <p className="quiet">Переход запишется, только если сервер его подтвердит.</p>}
      {problem ? <p className="quiet">{problem}</p> : null}
      {error ? <button className="ghost desk-action" type="button" disabled={busy} onClick={onRead}>Прочитать актуальное задание</button> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : label}</button>
    </form>
  </Dialog>;
}
