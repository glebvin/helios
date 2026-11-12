import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { staffRequest } from "./staff-form";
import { ApiError, v1 } from "./v1";
import {
  taskActionBody, taskActionError, taskActionLabel, taskActionProblem, taskActions, taskNeedsReason,
  type TaskActionName,
} from "./task-action";
import { taskStatusText, type ServerTask } from "./task-read";

const describe = (reason: unknown) => taskActionError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");

export function TaskActionPanel({ session, projectId, task, onDone }: { session: Session; projectId: string; task: ServerTask; onDone: () => void }) {
  const actions = taskActions(session.role, task.status);
  const [choice, setChoice] = useState<TaskActionName | null>(null);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  if (!actions.length) return null;
  return <section className="panel" aria-label="Публикация">
    <h2>Публикация</h2>
    <p className="quiet">Колонка на доске сменится только после ответа сервера. Причина в карточке не хранится.</p>
    <div className="template-bar">
      {actions.map((action) => <button className={action === "publish" || action === "submit" ? "fill desk-action" : "ghost desk-action"} key={action} type="button" onClick={() => setChoice(action)}>{taskActionLabel(action)}</button>)}
    </div>
    <Flash message={saved} pulse={pulse} />
    {choice ? <ActionDialog session={session} projectId={projectId} task={task} action={choice} onClose={() => setChoice(null)} onSaved={(row) => {
      setChoice(null);
      setSaved(`Сервер записал статус «${taskStatusText(row.status)}».`);
      setPulse((value) => value + 1);
      onDone();
    }} /> : null}
  </section>;
}

function ActionDialog({ session, projectId, task, action, onClose, onSaved }: {
  session: Session;
  projectId: string;
  task: ServerTask;
  action: TaskActionName;
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
  return <Dialog title={taskActionLabel(action)} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      <p className="quiet">{task.title}</p>
      {taskNeedsReason(action) ? <label className="field"><span>Причина</span><input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <p className="quiet">Переход запишется, только если сервер его подтвердит.</p>}
      {problem ? <p className="quiet">{problem}</p> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : taskActionLabel(action)}</button>
    </form>
  </Dialog>;
}
