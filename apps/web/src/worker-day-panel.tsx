import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskBadge } from "./kit";
import { taskListPath, taskStatusText, type ServerTask } from "./task-read";
import { ApiError, v1 } from "./v1";
import { SegmentPanel } from "./segment-panel";
import { ShiftDialog } from "./shift-panel";
import { canWriteShift, shiftNeedsReason } from "./shift-command";
import { clockLabel, dayReadError, dayReadPath, durationLabel, employeeListPath, ownEmployee, shiftListPath, shiftReading, visibleWorkerTasks, type DayEmployee, type DayReading, type DayShift, type ShiftReading } from "./worker-day";

type Page<T> = { items: T[]; total: number };

export function WorkerDayPanel({ session, projectId, day, notice, onExpire }: { session: Session; projectId: string; day: string; notice: string; onExpire: () => void }) {
  const reduce = useReducedMotion();
  const expire = useRef(onExpire);
  expire.current = onExpire;
  const [pass, setPass] = useState(0);
  const [loading, setLoading] = useState(true);
  const [gap, setGap] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [shiftKind, setShiftKind] = useState<"shift_start" | "shift_end" | null>(null);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [reading, setReading] = useState<DayReading | null>(null);
  const [shifts, setShifts] = useState<ShiftReading | null>(null);
  const [tasks, setTasks] = useState<ServerTask[] | null>(null);
  const [tasksTruncated, setTasksTruncated] = useState(false);
  const [dayError, setDayError] = useState("");
  const [shiftError, setShiftError] = useState("");
  const [taskError, setTaskError] = useState("");
  const ready = Boolean(projectId && day && !notice);

  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (!ready) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    setGap("");
    void (async () => {
      const people = await readPage<DayEmployee>(session, employeeListPath(projectId));
      if (!live) return;
      if (!people.ok) {
        if (people.status === 401) expire.current();
        setReading(null); setShifts(null); setTasks(null); setTasksTruncated(false); setEmployeeId("");
        setGap(""); setDayError(dayReadError(people.status, "people"));
        setLoading(false);
        return;
      }
      const employee = ownEmployee(people.ok.items, session.userId);
      if (!employee) {
        const own = people.ok.items.filter((item) => item.userId === session.userId);
        setReading(null); setShifts(null); setTasks(null); setTasksTruncated(false); setEmployeeId(""); setDayError("");
        setGap(people.ok.items.length === 0 ? "Вас не назначили на этот объект. Без назначения день и задания не читаются." : own.length > 1 ? "Сервер показал больше одной своей карточки. День не выбирается сам." : "Своей карточки на этом объекте нет.");
        setLoading(false);
        return;
      }
      const [dayResult, shiftResult, taskResult] = await Promise.all([
        readOne<DayReading>(session, dayReadPath(projectId, employee.id, day)),
        readPage<DayShift>(session, shiftListPath(projectId, employee.id)),
        readPage<ServerTask>(session, taskListPath(projectId, day)),
      ]);
      if (!live) return;
      if (dayResult.status === 401 || shiftResult.status === 401 || taskResult.status === 401) { expire.current(); setLoading(false); return; }
      setEmployeeName(employee.fullName);
      setEmployeeId(employee.id);
      setReading(dayResult.ok ?? null);
      setDayError(dayResult.ok ? "" : dayReadError(dayResult.status, "day"));
      setShifts(shiftResult.ok ? shiftReading(shiftResult.ok.items, shiftResult.ok.total, employee.id, projectId) : null);
      setShiftError(shiftResult.ok ? "" : dayReadError(shiftResult.status, "shifts"));
      setTasks(taskResult.ok ? visibleWorkerTasks(taskResult.ok.items, employee.id) : null);
      setTasksTruncated(Boolean(taskResult.ok && taskResult.ok.items.length < taskResult.ok.total));
      setTaskError(taskResult.ok ? "" : dayReadError(taskResult.status, "tasks"));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [session.token, session.userId, session.tenantId, projectId, day, pass, ready]);

  const retry = <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button>;
  return (
    <section className="worker-day" aria-busy={loading}>
      <h1>Моя смена</h1>
      <motion.div key={`${projectId}:${day}:${pass}`} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.23, 1, 0.32, 1] }}>
        {!ready ? <p className="quiet worker-hold">{notice || "Объект и день не подтверждены."}</p> : null}
        {ready && loading ? <p className="quiet worker-hold" role="status">Читаем день на сервере…</p> : null}
        {ready && !loading && gap ? <p className="quiet worker-hold">{gap}</p> : null}
        {ready && !loading && dayError ? <p role="alert">{dayError} {retry}</p> : null}
        {ready && !loading && reading ? <DayFacts reading={reading} shifts={shifts} shiftError={shiftError} retry={retry} /> : null}
        {ready && !loading && reading && employeeId && shifts?.kind === "one" && Number.isSafeInteger(reading.version) ? <SegmentPanel session={session} projectId={projectId} employeeId={employeeId} shiftId={shifts.shift.id} version={reading.version} tasks={(tasks ?? []).map((item) => ({ id: item.id, title: item.title }))} writable={canWriteShift(session.role)} onDone={(message) => { setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); }} /> : null}
        {ready && !loading && reading && employeeId && (shifts?.kind === "one" || shifts?.kind === "none") && Number.isSafeInteger(reading.version) ? <div className="template-bar">
          {shifts.kind === "one" ? <button className="ghost desk-action" type="button" onClick={() => setShiftKind("shift_end")}>Закончить смену</button> : <button className="fill desk-action" type="button" onClick={() => setShiftKind("shift_start")}>Начать смену</button>}
        </div> : null}
        <Flash message={saved} pulse={pulse} />
        {shiftKind && reading && employeeId ? <ShiftDialog session={session} projectId={projectId} employeeId={employeeId} kind={shiftKind} shiftId={shifts?.kind === "one" ? shifts.shift.id : ""} expectedVersion={reading.version} previousEventId={shifts?.kind === "one" ? shifts.shift.startEvent?.requestId ?? "" : ""} needsReason={shiftNeedsReason(session.role)} open={shifts?.kind === "one"} onClose={() => setShiftKind(null)} onDone={(message) => { setShiftKind(null); setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); }} /> : null}
        {ready && !loading && !gap && taskError ? <p role="alert">{taskError} {retry}</p> : null}
        {ready && !loading && tasks && tasks.length === 0 ? <p className="quiet">На сегодня опубликованных заданий нет. Их ставит прораб.</p> : null}
        {ready && !loading && tasksTruncated ? <p className="quiet">Сервер отдал не все задания этого дня.</p> : null}
        {ready && !loading && tasks ? tasks.map((item) => (
          <article className="job" key={item.id}>
            <div className="label">Моё задание</div>
            <h2>{item.title}</h2>
            <div className="quiet">{employeeName}</div>
            <div className="rowline quiet"><span>{item.plannedQuantity} {item.unit}</span><DeskBadge tone="accent">{taskStatusText(item.status)}</DeskBadge></div>
          </article>
        )) : null}
      </motion.div>
    </section>
  );
}

function DayFacts({ reading, shifts, shiftError, retry }: { reading: DayReading; shifts: ShiftReading | null; shiftError: string; retry: ReactNode }) {
  const presence = durationLabel(reading.presenceMs);
  const shiftText = shiftError ? "" : shifts?.kind === "one" ? `Смена открыта с ${clockLabel(shifts.shift.startedAt, reading.timezone) || "сервера"}.` : shifts?.kind === "none" ? "Смена на сервере не открыта." : shifts?.kind === "many" ? `Открытых смен: ${shifts.count}. Экран не выбирает одну.` : "Страница смен неполная. Открытую смену не выбираем.";
  return (
    <div className="shift-card">
      <div>
        <div className="kicker">{shiftError ? "Смены не прочитаны" : reading.hasOpenIntervals ? "Интервал открыт" : "Интервал закрыт"}</div>
        <div className="quiet">{shiftError ? <>{shiftError} {retry}</> : shiftText}</div>
      </div>
      <div className="worker-time">
        <b>{presence || "—"}</b>
        <div className="quiet">Не утверждено</div>
      </div>
    </div>
  );
}

async function readPage<T>(session: Session, path: string): Promise<{ ok?: Page<T>; status: number | null }> {
  try {
    return { ok: await v1<Page<T>>(session, path), status: 200 };
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
