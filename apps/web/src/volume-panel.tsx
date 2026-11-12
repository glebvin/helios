import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { segmentListPath } from "./segment";
import { ApiError, v1 } from "./v1";
import { dayReadPath, type DayReading } from "./worker-day";
import { positiveWork, reportListPath, reportsForTask, volumeBatchError, volumeEventBody, volumeNeedsReason, volumeOccurredAt, volumeProblem, volumeQuantity, volumeShift, type ClosedShift, type VolumeBatchRow, type VolumeReport, type VolumeSegment, type VolumeShiftRow } from "./volume";

type Page<T> = { items: T[]; total: number };
export type VolumeTask = { id: string; title: string; unit: string; status: string; workflowKind: string };

export function VolumeDesk({ session, projectId, employeeId, day, tasks, writable, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  day: string;
  tasks: VolumeTask[];
  writable: boolean;
  onDone: (message: string) => void;
}) {
  const taskKey = tasks.map((task) => `${task.id}:${task.status}:${task.workflowKind}`).join("|");
  const taskRef = useRef(tasks);
  taskRef.current = tasks;
  const [pass, setPass] = useState(0);
  const [error, setError] = useState("");
  const [shiftText, setShiftText] = useState("Читаем смену для объёма…");
  const [closed, setClosed] = useState<ClosedShift | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [reports, setReports] = useState<VolumeReport[]>([]);
  const [reportsReady, setReportsReady] = useState(false);
  const [ready, setReady] = useState(false);
  const [work, setWork] = useState<Record<string, "yes" | "no" | "incomplete">>({});
  const [taskId, setTaskId] = useState("");
  useEffect(() => {
    let live = true;
    setReady(false);
    void (async () => {
      try {
        const [clock, shifts, reportPage] = await Promise.all([
          v1<DayReading>(session, dayReadPath(projectId, employeeId, day)),
          v1<Page<VolumeShiftRow>>(session, `/projects/${projectId}/execution/shifts?${new URLSearchParams({ employeeId, limit: "100", offset: "0" })}`),
          v1<Page<VolumeReport>>(session, reportListPath(projectId, employeeId)),
        ]);
        if (!live) return;
        const found = volumeShift(shifts.items, shifts.total, employeeId, projectId, day, clock.timezone);
        const chosen = found.kind === "one" ? found.shift : null;
        const next: Record<string, "yes" | "no" | "incomplete"> = {};
        if (chosen) {
          const segments = await v1<Page<VolumeSegment>>(session, segmentListPath(projectId, chosen.id));
          if (!live) return;
          for (const task of taskRef.current) next[task.id] = positiveWork(segments.items, segments.total, chosen.id, employeeId, projectId, task.id);
        }
        setVersion(Number.isSafeInteger(clock.version) ? clock.version : null);
        setClosed(chosen);
        setWork(next);
        setReports(reportPage.items);
        const pageReady = Number(reportPage.total) === reportPage.items.length;
        setReportsReady(pageReady);
        setReady(true);
        setShiftText(found.kind === "one" ? "Смена закрыта. Сообщённый объём приёмкой не считается и колонку «Сдано» не включает." : found.kind === "none" ? "Объём сдаётся после закрытой смены." : found.kind === "many" ? "Закрытых смен за этот день несколько. Объём не выбирается сам." : "Страница смен неполная. Объём не отправляем.");
        setError(Number.isSafeInteger(clock.version) ? "" : "Версия дня не прочитана. Объём не отправляем.");
      } catch (reason) {
        if (!live) return;
        setClosed(null);
        setVersion(null);
        setReady(false);
        setReportsReady(false);
        setError(reason instanceof ApiError && reason.status === 403 ? "Этому входу объём не разрешён." : "Объём прочитать не удалось.");
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, employeeId, day, pass, taskKey]);
  const open = tasks.find((task) => task.id === taskId) ?? null;
  return <section className="panel" aria-label="Объём">
    <h2>Объём</h2>
    {error ? <p role="alert">{error}</p> : <p className="quiet">{shiftText}</p>}
    {ready && !reportsReady && !error ? <p className="quiet">Сервер отдал не все отчёты. Повтор не показываем.</p> : null}
    {tasks.map((task) => {
      const found = reportsForTask(reports, reportsReady ? reports.length : reports.length + 1, task.id);
      const rows = found.kind === "ready" ? found.items : [];
      const eligible = task.status === "published" && task.workflowKind === "managed02b";
      const canSend = Boolean(writable && reportsReady && version !== null && closed && eligible && work[task.id] === "yes" && !rows.some((row) => row.shiftId === closed.id));
      return <div key={task.id}>
        <p>{task.title}</p>
        {rows.map((row) => <p className="quiet" key={row.reportId}>Сообщено {row.submittedQuantity} {row.unit || task.unit}. Не принято.</p>)}
        {closed && work[task.id] === "no" && eligible ? <p className="quiet">В этой смене нет закрытой работы по заданию.</p> : null}
        {closed && work[task.id] === "incomplete" ? <p className="quiet">Интервалы смены прочитаны не полностью.</p> : null}
        {canSend ? <div className="template-bar"><button className="ghost desk-action" type="button" onClick={() => setTaskId(task.id)}>Сдать объём</button></div> : null}
      </div>;
    })}
    {open && closed && version !== null ? <VolumeDialog session={session} projectId={projectId} employeeId={employeeId} shift={closed} version={version} task={open} needsReason={volumeNeedsReason(session.role)} onClose={() => setTaskId("")} onDone={(message) => { setTaskId(""); setPass((value) => value + 1); onDone(message); }} /> : null}
  </section>;
}

function VolumeDialog({ session, projectId, employeeId, shift, version, task, needsReason, onClose, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  shift: ClosedShift;
  version: number;
  task: VolumeTask;
  needsReason: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pendingKey = `helios.volume:${session.tenantId}:${session.userId}:${shift.id}:${task.id}`;
  const problem = volumeProblem(typeof navigator === "undefined" ? true : navigator.onLine, quantity, reason, needsReason);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit() {
    const sent = volumeQuantity(quantity);
    if (lock.current || problem || !sent) return;
    lock.current = true; setBusy(true); setError("");
    try {
      let stored: { body: ReturnType<typeof volumeEventBody> } | null = null;
      try { stored = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); } catch { stored = null; }
      const event = stored?.body.events[0];
      const same = event?.kind === "submit_volume" && event.expectedVersion === version && event.taskId === task.id && event.submittedQuantity === sent && (event.onBehalfReason ?? "") === (needsReason ? reason.trim() : "");
      if (!same) {
        const occurredAt = volumeOccurredAt(new Date().toISOString(), shift.endedAt);
        if (!occurredAt) throw new Error("Время конца смены не прочитано.");
        stored = { body: volumeEventBody({
          requestId: crypto.randomUUID(), employeeId, projectId, shiftId: shift.id, expectedVersion: version, occurredAt,
          taskId: task.id, reportId: crypto.randomUUID(), submittedQuantity: sent,
          previousEventId: shift.endRequestId || undefined, onBehalfReason: needsReason ? reason : undefined,
        }) };
        try { sessionStorage.setItem(pendingKey, JSON.stringify(stored)); } catch { /* The open form still repeats this attempt. */ }
      }
      const result = await v1<{ results?: VolumeBatchRow[] }>(session, "/execution/events", stored!.body);
      const row = result.results?.[0];
      const failure = volumeBatchError(row, 200);
      if (failure) {
        if (row?.code === "stale_version") { try { sessionStorage.removeItem(pendingKey); } catch { /* The next confirmation reads the fresh version. */ } }
        throw new Error(failure);
      }
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      const amount = row?.result?.submittedQuantity;
      onDone(row?.outcome === "duplicate" ? `Сервер уже записал объём ${amount}, версия ${row?.result?.version}. Это ещё не приёмка.` : `Сервер записал объём ${amount}, версия ${row?.result?.version}. Это ещё не приёмка.`);
    } catch (failure) {
      setError(failure instanceof ApiError ? "Нет подтверждения сервера. Повторите в этой форме, не закрывая её." : failure instanceof Error ? failure.message : "Нет подтверждения сервера. Повторите в этой форме, не закрывая её.");
    } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title="Сдать объём" onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      <p className="quiet">{task.title}</p>
      <label className="field"><span>Объём, {task.unit}</span><input inputMode="decimal" value={quantity} aria-invalid={problem && quantity ? true : undefined} aria-describedby="volume-note" onChange={(event) => setQuantity(event.target.value)} /></label>
      <p id="volume-note" className="quiet">{problem || "Число больше нуля, до трёх знаков. Запятая подойдёт. Ноль другим числом не заменяется."}</p>
      {needsReason ? <label className="field"><span>Почему за работника</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : "Сдать объём"}</button>
    </form>
  </Dialog>;
}
