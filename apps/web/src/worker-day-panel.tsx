import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskBadge } from "./kit";
import { NoteMark } from "./note-mark";
import { taskListPath, taskStatusText, type ServerTask } from "./task-read";
import { ApiError, v1, v1Items } from "./v1";
import { SegmentPanel } from "./segment-panel";
import { ShiftDialog } from "./shift-panel";
import { canWriteShift, shiftNeedsReason } from "./shift-command";
import { VolumeDesk } from "./volume-panel";
import { canWriteVolume } from "./volume";
import { deliveryNote, retryDelivery, watchDelivery } from "./delivery";
import { readShiftSnapshot, saveShiftSnapshot, snapshotAge } from "./shift-snapshot";
import { MyRemarkTasks } from "./remark-tasks";
import { clockLabel, dayReadError, dayReadPath, durationLabel, employeeListPath, ownEmployee, shiftListPath, shiftReading, visibleWorkerTasks, type DayEmployee, type DayReading, type DayShift, type ShiftReading } from "./worker-day";

type Page<T> = { items: T[]; total: number };

export function WorkerDayPanel({ session, projectId, projectName, day, notice, onExpire }: { session: Session; projectId: string; projectName: string; day: string; notice: string; onExpire: () => void }) {
  const reduce = useReducedMotion();
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const [pass, setPass] = useState(0);
  const [stamp, setStamp] = useState("");
  const scope = `${projectId}:${day}`;
  const scopeSeen = useRef("");
  const [gap, setGap] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [shiftKind, setShiftKind] = useState<"shift_start" | "shift_end" | null>(null);
  const [slideKey, setSlideKey] = useState(0);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [reading, setReading] = useState<DayReading | null>(null);
  const [shifts, setShifts] = useState<ShiftReading | null>(null);
  const [tasks, setTasks] = useState<ServerTask[] | null>(null);
  const [tasksTruncated, setTasksTruncated] = useState(false);
  const [dayError, setDayError] = useState("");
  const [shiftError, setShiftError] = useState("");
  const [taskError, setTaskError] = useState("");
  const [waiting, setWaiting] = useState("");
  const [age, setAge] = useState("");
  const [cacheWarning, setCacheWarning] = useState("");
  const ready = Boolean(projectId && day && !notice);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    let live = true;
    const read = () => { void deliveryNote().then((text) => { if (live) setWaiting(text); }).catch(() => { if (live) setWaiting("Очередь устройства недоступна. Действия не отправлены."); }); };
    read();
    const stop = watchDelivery(() => { read(); if (live) setPass((value) => value + 1); });
    return () => { live = false; stop(); };
  }, [session.token, session.userId, session.tenantId]);

  useEffect(() => {
    if (!ready) return;
    const switched = scopeSeen.current !== scope;
    scopeSeen.current = scope;
    if (switched) setStamp("");
    let live = true;
    void (async () => {
      const people = await readPage<DayEmployee>(session, employeeListPath(projectId));
      if (!live) return;
      if (!people.ok) {
        if (people.status === 401) expire.current();
        const saved = people.status === null ? readShiftSnapshot(session.tenantId, session.userId) : null;
        if (saved && saved.projectId === projectId && saved.day === day) {
          setEmployeeId(saved.employeeId);
          setReading(saved.reading);
          setShifts(saved.shifts);
          setTasks(saved.tasks);
          setTasksTruncated(false);
          setGap("");
          setDayError("");
          setShiftError("");
          setTaskError("");
          setAge(snapshotAge(saved.fetchedAt));
          setStamp(scope);
          return;
        }
        if (switched) { setReading(null); setShifts(null); setTasks(null); setTasksTruncated(false); setEmployeeId(""); }
        setGap(""); setDayError(dayReadError(people.status, "people"));
        setCacheWarning("");
        setAge("");
        setStamp(scope);
        return;
      }
      const employee = ownEmployee(people.ok.items, session.userId);
      if (!employee) {
        const own = people.ok.items.filter((item) => item.userId === session.userId);
        if (switched) { setReading(null); setShifts(null); setTasks(null); setTasksTruncated(false); setEmployeeId(""); }
        setDayError("");
        setGap(people.ok.items.length === 0 ? "Вас не назначили на этот объект. Без назначения день и задания не читаются." : own.length > 1 ? "Сервер показал больше одной своей карточки. День не выбирается сам." : "Своей карточки на этом объекте нет.");
        setStamp(scope);
        return;
      }
      const [dayResult, shiftResult, taskResult] = await Promise.all([
        readOne<DayReading>(session, dayReadPath(projectId, employee.id, day)),
        readPage<DayShift>(session, shiftListPath(projectId, employee.id)),
        readPage<ServerTask>(session, taskListPath(projectId, day)),
      ]);
      if (!live) return;
      if (dayResult.status === 401 || shiftResult.status === 401 || taskResult.status === 401) { expire.current(); setStamp(scope); return; }
      setEmployeeId(employee.id);
      if (dayResult.ok || switched) setReading(dayResult.ok ?? null);
      setDayError(dayResult.ok ? "" : dayReadError(dayResult.status, "day"));
      if (shiftResult.ok || switched) setShifts(shiftResult.ok ? shiftReading(shiftResult.ok.items, shiftResult.ok.total, employee.id, projectId) : null);
      setShiftError(shiftResult.ok ? "" : dayReadError(shiftResult.status, "shifts"));
      if (taskResult.ok || switched) {
        setTasks(taskResult.ok ? visibleWorkerTasks(taskResult.ok.items, employee.id) : null);
        setTasksTruncated(Boolean(taskResult.ok && taskResult.ok.items.length < taskResult.ok.total));
      }
      setTaskError(taskResult.ok ? "" : dayReadError(taskResult.status, "tasks"));
      if (dayResult.ok && shiftResult.ok && taskResult.ok) {
        const visible = visibleWorkerTasks(taskResult.ok.items, employee.id);
        const cached = saveShiftSnapshot({
          tenantId: session.tenantId, userId: session.userId, projectId, projectName: projectName || "Объект", day,
          employeeId: employee.id, reading: dayResult.ok, shifts: shiftReading(shiftResult.ok.items, shiftResult.ok.total, employee.id, projectId),
          tasks: visible, fetchedAt: new Date().toISOString(),
        });
        setCacheWarning(cached ? "" : "Снимок дня не записан: хранилище устройства недоступно. Холодный запуск без сети может не открыться.");
        setAge("");
      }
      setStamp(scope);
    })();
    return () => { live = false; };
  }, [session.token, session.userId, session.tenantId, projectId, projectName, day, pass, ready]);

  const fresh = stamp === scope;
  const retry = <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button>;
  const canShift = Boolean(ready && fresh && !gap && !dayError && !shiftError && reading && employeeId && Number.isSafeInteger(reading.version) && (shifts?.kind === "one" || shifts?.kind === "none"));
  return (
    <section className="worker-day" aria-busy={!fresh}>
      <h1>Моя смена</h1>
      {cacheWarning ? <p role="status" className="quiet">{cacheWarning}</p> : null}
      <p className="quiet">Без сети после входа здесь открывается только «Моя смена», с отметкой давности. Остальные разделы без сети не открываются.</p>
      {age ? <p className="quiet" role="status">Снимок от {age}. Это сохранённое чтение, не свежий ответ сервера.</p> : null}
      {waiting ? <p className="quiet" role="status">{waiting} <button className="ghost desk-action" type="button" onClick={() => { void retryDelivery().catch(() => setWaiting("Очередь устройства недоступна. Действия не отправлены.")); }}>Повторить отправку</button></p> : null}
      <motion.div className="worker-stack" key={scope} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
        {!ready ? <p className="quiet worker-hold">{notice || "Объект и день не подтверждены."}</p> : null}
        {ready && !fresh ? <p className="quiet worker-hold" role="status">Читаем день…</p> : null}
        {fresh && gap ? <p className="quiet worker-hold">{gap}</p> : null}
        {fresh && dayError ? <p role="alert">{dayError} {retry}</p> : null}
        {fresh && reading ? <DayFacts reading={reading} shifts={shifts} shiftError={shiftError} retry={retry} /> : null}
        {canShift && shifts?.kind === "one" ? <EndSlide key={slideKey} onEnd={() => setShiftKind("shift_end")} /> : null}
        {canShift && shifts?.kind === "none" ? <button className="fill desk-action worker-start" type="button" onClick={() => setShiftKind("shift_start")}>Начать смену</button> : null}
        {canShift && reading && employeeId && shifts?.kind === "one" && Number.isSafeInteger(reading.version) ? <SegmentPanel compact session={session} projectId={projectId} employeeId={employeeId} shiftId={shifts.shift.id} version={reading.version} tasks={(tasks ?? []).filter((item) => item.workflowKind === "managed02b" && item.status === "published").map((item) => ({ id: item.id, title: item.title }))} writable={canWriteShift(session.role)} onDone={(message) => { setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); }} /> : null}
        <Flash message={saved} pulse={pulse} />
        {ready && shiftKind && reading && employeeId ? <ShiftDialog session={session} projectId={projectId} employeeId={employeeId} kind={shiftKind} day={day} shiftId={shifts?.kind === "one" ? shifts.shift.id : ""} expectedVersion={reading.version} previousEventId={shifts?.kind === "one" ? shifts.shift.startEvent?.requestId ?? "" : ""} needsReason={shiftNeedsReason(session.role)} open={shifts?.kind === "one"} immediate={shiftKind === "shift_end" && !shiftNeedsReason(session.role)} onClose={() => { setShiftKind(null); setSlideKey((value) => value + 1); }} onDone={(message) => { setShiftKind(null); setSlideKey((value) => value + 1); setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); }} /> : null}
        {fresh && !gap && taskError ? <p role="alert">{taskError} {retry}</p> : null}
        {fresh && tasks && tasks.length === 0 ? <p className="quiet">На сегодня опубликованных заданий нет. Их ставит прораб.</p> : null}
        {fresh && tasksTruncated ? <p className="quiet">Сервер отдал не все задания этого дня.</p> : null}
        {fresh ? <MyRemarkTasks session={session} projectId={projectId} notice={notice} /> : null}
        {fresh && tasks ? tasks.map((item) => (
          <article className="job" key={item.id}>
            <div className="rowline">
              <h2>{item.title}</h2>
              <DeskBadge tone="accent">{taskStatusText(item.status)}</DeskBadge>
            </div>
            <div className="quiet">{item.plannedQuantity} {item.unit}</div>
            {reading && employeeId && item.workflowKind === "managed02b" ? <VolumeDesk compact refreshToken={reading?.version ?? 0} session={session} projectId={projectId} employeeId={employeeId} day={day} tasks={[{ id: item.id, title: item.title, unit: item.unit, status: item.status, workflowKind: item.workflowKind }]} writable={ready && !gap && !dayError && canWriteVolume(session.role)} onDone={(message) => { setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); }} /> : null}
          </article>
        )) : null}
      </motion.div>
    </section>
  );
}

function DayFacts({ reading, shifts, shiftError, retry }: { reading: DayReading; shifts: ShiftReading | null; shiftError: string; retry: ReactNode }) {
  const presence = durationLabel(reading.presenceMs);
  const open = shifts?.kind === "one";
  const attended = /^\d+$/.test(reading.presenceMs) && BigInt(reading.presenceMs) > 0n;
  const title = shiftError ? "Смена не прочитана" : shifts?.kind === "many" ? "Несколько открытых смен" : shifts?.kind === "incomplete" ? "Смена не выбрана" : open ? "Смена открыта" : attended ? "Смена закрыта" : "Смена не начата";
  const figure = shiftError || shifts?.kind === "many" || shifts?.kind === "incomplete" ? "" : open ? clockLabel(shifts.shift.startedAt, reading.timezone) : attended ? presence : "";
  const aside = shiftError ? "" : shifts?.kind === "many" ? "Экран не выбирает одну." : shifts?.kind === "incomplete" ? "Страница смен неполная." : "";
  return (
    <div className="shift-card worker-status">
      <div>
        <h2>{title}</h2>
        <div className="worker-meta">
          {shiftError ? <>{shiftError} {retry}</> : aside ? aside : <>не утверждено <NoteMark label="Про часы"><p>Часы этого дня сервер ещё не утверждал. Смена не переносит задание в другую колонку.</p></NoteMark></>}
        </div>
      </div>
      {figure ? <b className="worker-figure">{figure}</b> : null}
    </div>
  );
}

function EndSlide({ onEnd }: { onEnd: () => void }) {
  const reduce = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const fade = useTransform(x, [0, 120], [1, 0.4]);
  return (
    <div className="end-slide" ref={track}>
      <motion.span className="end-slide-label" style={{ opacity: fade }}>Закончить смену</motion.span>
      <motion.button type="button" className="end-slide-thumb" aria-label="Сдвиньте, чтобы закончить смену" style={{ x }} drag="x" dragConstraints={track} dragElastic={reduce ? 0 : 0.06} dragMomentum={false} dragSnapToOrigin onDragEnd={(_, info) => {
        const travel = Math.max(1, (track.current?.clientWidth ?? 0) - 48);
        if (info.offset.x > travel * 0.5) onEnd();
      }}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.2 2.4 7.8 6 4.2 9.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </motion.button>
    </div>
  );
}

async function readPage<T>(session: Session, path: string): Promise<{ ok?: Page<T>; status: number | null }> {
  try {
    const items = await v1Items<T>(session, path);
    return { ok: { items, total: items.length }, status: 200 };
  } catch (reason) {
    return { status: reason instanceof ApiError ? reason.status : null };
  }
}

async function readOne<T>(session: Session, path: string): Promise<{ ok?: T; status: number | null }> {
  try {
    return { ok: await v1<T>(session, path), status: 200 };
  } catch (reason) {
    return { status: reason instanceof ApiError ? reason.status : null };
  }
}
