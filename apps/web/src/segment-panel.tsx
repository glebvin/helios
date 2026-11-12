import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { DeskSelect } from "./kit";
import { NoteMark } from "./note-mark";
import { shiftNeedsReason } from "./shift-command";
import { downtimeReasons, openSegment, segmentActionLabel, segmentActions, segmentBatchError, segmentEventBody, segmentLabel, segmentListPath, segmentProblem, type DowntimeReason, type SegmentMode, type SegmentRow } from "./segment";
import { ApiError, v1, v1Collection } from "./v1";

type Page<T> = { items: T[]; total: number };
type TaskChoice = { id: string; title: string };

export function SegmentPanel({ session, projectId, employeeId, shiftId, version, tasks, writable, compact = false, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  shiftId: string;
  version: number;
  tasks: TaskChoice[];
  writable: boolean;
  compact?: boolean;
  onDone: (message: string) => void;
}) {
  const [pass, setPass] = useState(0);
  const [text, setText] = useState("Читаем интервал…");
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<SegmentRow | null>(null);
  const [mode, setMode] = useState<SegmentMode | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await v1Collection<SegmentRow>(session, segmentListPath(projectId, shiftId));
        if (!live) return;
        const found = openSegment(page.items, page.total, shiftId, employeeId, projectId);
        setCurrent(found.kind === "one" ? found.segment : null);
        setText(found.kind === "one" ? `Сейчас: ${segmentLabel(found.segment.mode)}.` : found.kind === "none" ? "Открытого интервала на сервере нет." : found.kind === "many" ? "Открытых интервалов несколько. Экран не выбирает один." : "Сервер отдал интервалы не полностью.");
        setError("");
      } catch (reason) {
        if (!live) return;
        setCurrent(null);
        setError(reason instanceof ApiError && reason.status === 403 ? "Этому входу интервал не разрешён." : "Интервал прочитать не удалось.");
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, employeeId, shiftId, version, pass]);
  const actions = current ? segmentActions(current.mode) : [];
  const modeName = current ? segmentLabel(current.mode) : "";
  const buttons = writable && current && actions.length ? <div className={actions.length > 1 ? "worker-actions" : "worker-actions is-one"}>
    {actions.map((action) => {
      const primary = actions.length > 1 && action === "break";
      const short = action === "idle" ? "Завершить" : segmentActionLabel(current.mode, action);
      return <button className={`${primary ? "fill" : "ghost"} desk-action`} key={action} type="button" onClick={() => setMode(action)}>{glyph(action)}{compact ? short : segmentActionLabel(current.mode, action)}</button>;
    })}
  </div> : null;
  const note = <NoteMark label="Про интервал"><p>Перерыв и простой колонку задания не меняют.</p></NoteMark>;
  return <>
    {compact ? <section className="job worker-interval">
      {error ? <p role="alert">{error}</p> : <div className="worker-meta">{modeName || text} {current ? note : null}</div>}
      {buttons}
    </section> : <>
      {error ? <p role="alert">{error}</p> : <p className="task-now">{current ? modeName : text} {current ? note : null}</p>}
      {buttons}
    </>}
    {mode && current ? <SegmentDialog session={session} projectId={projectId} employeeId={employeeId} shiftId={shiftId} version={version} mode={mode} current={current} tasks={tasks} needsBehalf={shiftNeedsReason(session.role)} onClose={() => setMode(null)} onDone={(message) => { setMode(null); setPass((value) => value + 1); onDone(message); }} /> : null}
  </>;
}

function glyph(action: SegmentMode) {
  if (action === "work") return <svg className="worker-glyph" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 1.8v8.4L10 6Z" fill="currentColor" /></svg>;
  if (action === "break") return <svg className="worker-glyph" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 1.8h1.8v8.4H3.2Zm3.8 0h1.8v8.4H7Z" fill="currentColor" /></svg>;
  if (action === "idle") return <svg className="worker-glyph" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>;
  return null;
}

function SegmentDialog({ session, projectId, employeeId, shiftId, version, mode, current, tasks, needsBehalf, onClose, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  shiftId: string;
  version: number;
  mode: SegmentMode;
  current: SegmentRow;
  tasks: TaskChoice[];
  needsBehalf: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const remembered = current.taskId || (tasks.length === 1 ? tasks[0].id : "");
  const [taskId, setTaskId] = useState(remembered);
  const [reason, setReason] = useState<DowntimeReason | "">("");
  const [comment, setComment] = useState("");
  const [behalf, setBehalf] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const attempt = useRef<{ body: ReturnType<typeof segmentEventBody> } | null>(null);
  const pendingKey = `helios.segment:${session.tenantId}:${session.userId}:${shiftId}:${mode}`;
  const problem = segmentProblem({ online: typeof navigator === "undefined" ? true : navigator.onLine, mode, taskId, reason, comment, behalf, needsBehalf });
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit() {
    if (lock.current || problem) return;
    lock.current = true; setBusy(true); setError("");
    try {
      let stored = attempt.current;
      if (!stored) { try { stored = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); } catch { stored = null; } }
      const event = stored?.body.events[0];
      const same = event?.mode === mode && (attempt.current !== null || event.expectedVersion === version) && (event.taskId ?? "") === (mode === "work" || mode === "downtime" ? taskId : "") && (event.reasonCode ?? "") === (mode === "downtime" ? reason : "") && (event.comment ?? "") === (mode === "downtime" ? comment.trim() : "") && (event.onBehalfReason ?? "") === (needsBehalf ? behalf.trim() : "");
      if (!same) {
        stored = { body: segmentEventBody({
          requestId: crypto.randomUUID(), employeeId, projectId, shiftId, expectedVersion: version, occurredAt: new Date().toISOString(), mode,
          taskId: mode === "work" || mode === "downtime" ? taskId : undefined,
          reasonCode: mode === "downtime" && reason ? reason : undefined,
          comment: mode === "downtime" ? comment : undefined,
          onBehalfReason: needsBehalf ? behalf : undefined,
        }) };
        try { sessionStorage.setItem(pendingKey, JSON.stringify(stored)); } catch { /* The open form still repeats this attempt. */ }
      }
      attempt.current = stored;
      const result = await v1<{ results?: { outcome?: string; code?: string; result?: { version?: number } }[] }>(session, "/execution/events", stored!.body);
      const row = result.results?.[0];
      const failure = row?.outcome === "success" || row?.outcome === "duplicate" ? (row.result?.version ? "" : "Сервер не вернул версию интервала.") : segmentBatchError(row?.code ?? "event_rejected", 200);
      if (failure) {
        if (row?.code === "stale_version") { attempt.current = null; try { sessionStorage.removeItem(pendingKey); } catch { /* The next confirmation reads the fresh version. */ } }
        throw new Error(failure);
      }
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      attempt.current = null;
      onDone(row?.outcome === "duplicate" ? `Сервер уже записал интервал, версия ${row?.result?.version}.` : `Сервер записал интервал, версия ${row?.result?.version}.`);
    } catch (failure) {
      setError(failure instanceof ApiError ? "Нет подтверждения сервера. Повторите в этой форме, не закрывая её." : failure instanceof Error ? failure.message : "Нет подтверждения сервера. Повторите в этой форме, не закрывая её.");
    } finally { lock.current = false; setBusy(false); }
  }
  const title = segmentActionLabel(current.mode, mode);
  return <Dialog title={title} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      {mode === "work" || mode === "downtime" ? tasks.length === 1 ? <p className="quiet">{tasks[0].title}</p> : <DeskSelect label="Задание" value={taskId} options={[{ value: "", label: "Выберите задание" }, ...tasks.map((item) => ({ value: item.id, label: item.title }))]} onChange={setTaskId} /> : null}
      {mode === "downtime" ? <DeskSelect label="Причина" value={reason} options={[{ value: "", label: "Выберите причину" }, ...downtimeReasons]} onChange={(value) => setReason(value as DowntimeReason | "")} /> : null}
      {mode === "downtime" ? <label className="field"><span>Что остановило работу</span><input maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} /></label> : null}
      {needsBehalf ? <label className="field"><span>Почему за работника</span><input maxLength={500} value={behalf} onChange={(event) => setBehalf(event.target.value)} /></label> : <p className="quiet">Сервер закроет текущий интервал и откроет следующий тем же временем. Колонка задания не изменится.</p>}
      {problem ? <p className="quiet">{problem}</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : title}</button>
    </form>
  </Dialog>;
}
