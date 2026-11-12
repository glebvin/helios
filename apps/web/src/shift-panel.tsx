import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { canWriteShift, shiftBatchError, shiftEventBody, shiftNeedsReason, shiftProblem, type ShiftBatch, type ShiftGeo, type ShiftKind } from "./shift-command";
import { ApiError, v1 } from "./v1";
import { SegmentPanel } from "./segment-panel";
import { taskListPath, type ServerTask } from "./task-read";
import { dayReadPath, shiftListPath, shiftReading, visibleWorkerTasks, type DayReading, type DayShift } from "./worker-day";

type Page<T> = { items: T[]; total: number };

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
          v1<Page<DayShift>>(session, shiftListPath(projectId, employeeId)),
        ]);
        if (!live) return;
        try {
          const taskPage = await v1<Page<ServerTask>>(session, taskListPath(projectId, day));
          if (live) setTaskChoices(visibleWorkerTasks(taskPage.items, employeeId).map((item) => ({ id: item.id, title: item.title })));
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
  return <section className="panel" aria-label="Смена">
    <h2>Смена</h2>
    {error ? <p role="alert">{error}</p> : <p className="quiet">{text} Колонка задания сменится, только если сервер сменит его статус.</p>}
    {openId && reading && Number.isSafeInteger(reading.version) ? <SegmentPanel session={session} projectId={projectId} employeeId={employeeId} shiftId={openId} version={reading.version} tasks={taskChoices} writable={writable} onDone={(message) => { setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); onChanged(); }} /> : null}
    {writable && ready && reading ? <div className="template-bar">
      {open ? <button className="ghost desk-action" type="button" onClick={() => setKind("shift_end")}>Закончить смену</button> : <button className="fill desk-action" type="button" onClick={() => setKind("shift_start")}>Начать смену</button>}
    </div> : null}
    <Flash message={saved} pulse={pulse} />
    {kind && reading ? <ShiftDialog session={session} projectId={projectId} employeeId={employeeId} kind={kind} shiftId={openId} expectedVersion={reading.version} previousEventId={previousId} needsReason={shiftNeedsReason(session.role)} open={open} onClose={() => setKind(null)} onDone={(message) => { setKind(null); setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); onChanged(); }} /> : null}
  </section>;
}

export function ShiftDialog({ session, projectId, employeeId, kind, shiftId, expectedVersion, previousEventId, needsReason, open, onClose, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  kind: ShiftKind;
  shiftId: string;
  expectedVersion: number;
  previousEventId: string;
  needsReason: boolean;
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [geoNote, setGeoNote] = useState("");
  const lock = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pendingKey = `helios.shift:${session.tenantId}:${session.userId}:${employeeId}:${kind}`;
  const problem = shiftProblem(typeof navigator === "undefined" ? true : navigator.onLine, kind, open, reason, needsReason);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit() {
    if (lock.current || problem) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const trimmed = needsReason ? reason.trim() : "";
      let stored: { body: ReturnType<typeof shiftEventBody> } | null = null;
      try { stored = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); } catch { stored = null; }
      const event = stored?.body.events[0];
      const same = event?.kind === kind && event.expectedVersion === expectedVersion && (event.onBehalfReason ?? "") === trimmed;
      if (!same) {
        const geo = await readGeo();
        setGeoNote(geo ? "" : "Геопозиция не записана.");
        stored = { body: shiftEventBody({
          requestId: crypto.randomUUID(), employeeId, projectId, shiftId: shiftId || crypto.randomUUID(), expectedVersion,
          occurredAt: new Date().toISOString(), kind, previousEventId: kind === "shift_end" && previousEventId ? previousEventId : undefined,
          onBehalfReason: trimmed || undefined, geo,
        }) };
        try { sessionStorage.setItem(pendingKey, JSON.stringify(stored)); } catch { /* The open form still repeats this attempt. */ }
      }
      const result = await v1<ShiftBatch>(session, "/execution/events", stored!.body);
      const failure = shiftBatchError(result, 200);
      if (failure) {
        if (result.results?.[0]?.code === "stale_version") { try { sessionStorage.removeItem(pendingKey); } catch { /* The next confirmation reads the fresh day. */ } }
        throw new Error(failure);
      }
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      const version = result.results?.[0]?.result?.version;
      onDone(result.results?.[0]?.outcome === "duplicate" ? `Сервер уже записал эту смену, версия ${version}.` : `Сервер записал смену, версия ${version}.`);
    } catch (failure) {
      setError(failure instanceof ApiError ? "Нет подтверждения сервера. Повторите в этой форме, не закрывая её." : failure instanceof Error ? failure.message : "Нет подтверждения сервера. Повторите в этой форме, не закрывая её.");
    } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={kind === "shift_start" ? "Начать смену" : "Закончить смену"} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      {needsReason ? <label className="field"><span>Почему за работника</span><input required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : <p className="quiet">Запись уйдёт на сервер один раз. Повтор этой кнопки отправляет тот же запрос.</p>}
      {geoNote ? <p className="quiet">{geoNote}</p> : null}
      {problem ? <p className="quiet">{problem}</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : kind === "shift_start" ? "Начать смену" : "Закончить смену"}</button>
    </form>
  </Dialog>;
}

function readGeo(): Promise<ShiftGeo | undefined> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy)) { resolve(undefined); return; }
      resolve({ latitude, longitude, accuracyMeters: accuracy, capturedAt: new Date(position.timestamp).toISOString() });
    }, () => resolve(undefined), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}
