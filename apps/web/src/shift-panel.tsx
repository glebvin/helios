import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { canWriteShift, shiftBatchError, shiftEventBody, shiftNeedsReason, shiftProblem, type ShiftKind } from "./shift-command";
import { deliveryError, deliveryPredecessor, sendEvent } from "./delivery";
import { ApiError, v1, v1Collection } from "./v1";
import type { EventPayload } from "../../../packages/offline/src/index.js";
import { NoteMark } from "./note-mark";
import { SegmentPanel } from "./segment-panel";
import { taskListPath, type ServerTask } from "./task-read";
import { dayReadPath, shiftListPath, shiftReading, visibleWorkerTasks, type DayReading, type DayShift } from "./worker-day";

type Page<T> = { items: T[]; total: number };
const shiftFlights = new Map<string, Promise<string | null>>();

export function ShiftPanel({ session, projectId, employeeId, day, onChanged }: { session: Session; projectId: string; employeeId: string; day: string; onChanged: () => void }) {
  const [pass, setPass] = useState(0);
  const [reading, setReading] = useState<DayReading | null>(null);
  const [openId, setOpenId] = useState("");
  const [previousId, setPreviousId] = useState("");
  const [text, setText] = useState("Читаем смену…");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<ShiftKind | null>(null);
  const [taskChoices, setTaskChoices] = useState<{ id: string; title: string }[]>([]);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const writable = canWriteShift(session.role);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [clock, shifts] = await Promise.all([
          v1<DayReading>(session, dayReadPath(projectId, employeeId, day)),
          v1Collection<DayShift>(session, shiftListPath(projectId, employeeId)),
        ]);
        if (!live) return;
        try {
          const taskPage = await v1Collection<ServerTask>(session, taskListPath(projectId, day));
          if (live) setTaskChoices(visibleWorkerTasks(taskPage.items, employeeId).filter((item) => item.workflowKind === "managed02b" && item.status === "published").map((item) => ({ id: item.id, title: item.title })));
        } catch { if (live) setTaskChoices([]); }
        const found = shiftReading(shifts.items, shifts.total, employeeId, projectId);
        setReading(clock);
        setOpenId(found.kind === "one" ? found.shift.id : "");
        setPreviousId(found.kind === "one" ? found.shift.startEvent?.requestId ?? "" : "");
        setText(found.kind === "one" ? "Смена на сервере открыта." : found.kind === "none" ? "Смена на сервере не открыта." : "Страница смен неполная. Кнопку не показываем.");
        setError("");
      } catch (reason) {
        if (!live) return;
        setReading(null);
        setError(reason instanceof ApiError && reason.status === 403 ? "Этому входу смена не разрешена." : "Смену прочитать не удалось.");
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, employeeId, day, pass]);
  const open = Boolean(openId);
  const ready = Boolean(reading && Number.isSafeInteger(reading.version) && text !== "Страница смен неполная. Кнопку не показываем.");
  const known = text === "Смена на сервере открыта." || text === "Смена на сервере не открыта.";
  return <section className="panel" aria-label="Смена">
    <div className="panel-head">
      <h2>Смена</h2>
      <NoteMark label="Про смену"><p>Колонка задания сменится, только если сервер сменит его статус.</p></NoteMark>
    </div>
    {error ? <p role="alert">{error}</p> : <p className={known ? "task-state" : "quiet"}>{known ? (open ? "Открыта" : "Не открыта") : text}</p>}
    {openId && reading && Number.isSafeInteger(reading.version) ? <SegmentPanel session={session} projectId={projectId} employeeId={employeeId} shiftId={openId} version={reading.version} tasks={taskChoices} writable={writable} onDone={(message) => { setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); onChanged(); }} /> : null}
    {writable && ready && reading ? <div className="template-bar">
      {open ? <button className="ghost desk-action" type="button" onClick={() => setKind("shift_end")}>Закончить смену</button> : <button className="fill desk-action" type="button" onClick={() => setKind("shift_start")}>Начать смену</button>}
    </div> : null}
    <Flash message={saved} pulse={pulse} />
    {kind && reading ? <ShiftDialog session={session} projectId={projectId} employeeId={employeeId} kind={kind} day={day} shiftId={openId} expectedVersion={reading.version} previousEventId={previousId} needsReason={shiftNeedsReason(session.role)} open={open} onClose={() => setKind(null)} onDone={(message) => { setKind(null); setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); onChanged(); }} /> : null}
  </section>;
}

export function ShiftDialog({ session, projectId, employeeId, kind, day, shiftId, expectedVersion, previousEventId, needsReason, open, immediate = false, onClose, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  kind: ShiftKind;
  day: string;
  shiftId: string;
  expectedVersion: number;
  previousEventId: string;
  needsReason: boolean;
  open: boolean;
  immediate?: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const attempt = useRef<{ body: ReturnType<typeof shiftEventBody> } | null>(null);
  const pendingKey = `helios.shift:${session.tenantId}:${session.userId}:${projectId}:${employeeId}:${day}:${kind}`;
  const problem = shiftProblem(typeof navigator === "undefined" ? true : navigator.onLine, kind, open, reason, needsReason);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  useEffect(() => {
    if (!immediate || needsReason || problem) return;
    let live = true;
    void submit().then((message) => { if (live && message) onDone(message); });
    return () => { live = false; };
  }, [immediate, needsReason, problem]);
  function submit() {
    if (problem) return Promise.resolve(null);
    const flying = shiftFlights.get(pendingKey);
    if (flying) return flying;
    const run = send();
    shiftFlights.set(pendingKey, run);
    void run.finally(() => { if (shiftFlights.get(pendingKey) === run) shiftFlights.delete(pendingKey); });
    return run;
  }
  async function send(): Promise<string | null> {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError("");
    try {
      const trimmed = needsReason ? reason.trim() : "";
      let stored = attempt.current;
      if (!stored) { try { stored = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); } catch { stored = null; } }
      const event = stored?.body.events[0];
      const same = event?.kind === kind && event.projectId === projectId && event.employeeId === employeeId && (kind !== "shift_end" || event.shiftId === shiftId) && (attempt.current !== null || event.expectedVersion === expectedVersion) && (event.onBehalfReason ?? "") === trimmed;
      if (!same) {
        stored = { body: shiftEventBody({
          requestId: crypto.randomUUID(), employeeId, projectId, shiftId: shiftId || crypto.randomUUID(), expectedVersion,
          occurredAt: new Date().toISOString(), kind, previousEventId: await deliveryPredecessor(employeeId, projectId, expectedVersion) ?? (kind === "shift_end" && previousEventId ? previousEventId : undefined),
          onBehalfReason: trimmed || undefined,
        }) };
        try { sessionStorage.setItem(pendingKey, JSON.stringify(stored)); } catch { /* The open form still repeats this attempt. */ }
      }
      attempt.current = stored;
      const outcome = await sendEvent(stored!.body.events[0] as EventPayload);
      if (outcome.state === "synced") {
        try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
        attempt.current = null;
        return "Сохранено сервером";
      }
      if (outcome.state === "blocked" || outcome.state === "auth-required") throw new Error(shiftBatchError({ results: [{ outcome: "error", code: outcome.code ?? "" }] }, 200));
      return "Ожидает отправки";
    } catch (failure) {
      setError(deliveryError(failure) ?? (failure instanceof Error ? failure.message : "Нет подтверждения сервера. Повторите в этой форме, не закрывая её."));
      return null;
    } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={kind === "shift_start" ? "Начать смену" : "Закончить смену"} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit().then((message) => { if (message) onDone(message); }); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      {needsReason ? <label className="field"><span>Почему за работника</span><input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <p className="quiet">Запись уйдёт на сервер один раз. Повтор этой кнопки отправляет тот же запрос.</p>}
      {problem ? <p className="quiet">{problem}</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : kind === "shift_start" ? "Начать смену" : "Закончить смену"}</button>
    </form>
  </Dialog>;
}
