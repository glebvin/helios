import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { DeskBadge, DeskEmpty, DeskTimeline } from "./kit";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { ApiError, moscowDay, v1, v1Collection } from "./v1";
import { durationLabel } from "./worker-day";
import { timeDecisionId } from "./time-command";

type Totals = { presenceMs: string; idleMs: string; workMs: string; breakMs: string; downtimeMs: string };
type TimeStatus = "unapproved" | "current" | "stale" | "revoked";
type TimeDaySummary = {
  employeeId: string;
  employeeName: string;
  day: string;
  status: TimeStatus;
  recorded: boolean;
  hasOpenIntervals: boolean;
  suspicious: boolean;
  sourceTotals: Totals;
  confirmedTotals: Totals | null;
  overridden: boolean;
  latestReason: string | null;
};
type TimeDayList = { items: TimeDaySummary[]; total: number; limit: number; offset: number; nextOffset: number | null; truncated: boolean };
type TimeRevision = { version: number; state: "approved" | "revoked"; reason: string; recordedAt: string; sourceTotals: Totals; confirmedTotals: Totals };
type TimeHistory = { items: TimeRevision[]; total: number; limit: number; offset: number };
type TimeDay = {
  employeeId: string;
  day: string;
  status: TimeStatus;
  sourceHash: string;
  approvalVersion: number;
  source: { totals: Totals; hasOpenIntervals: boolean; suspicious: boolean };
  latest: { state: "approved" | "revoked"; reason: string; confirmedTotals: Totals; overridden: boolean } | null;
};

const limit = 50;

export function TimeSheet({ session, projectId, canDecide = false }: { session: Session; projectId: string; canDecide?: boolean }) {
  const reduce = useReducedMotion();
  const today = moscowDay();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [reading, setReading] = useState<{ scope: string; page: TimeDayList | null; error: string } | null>(null);
  const [picked, setPicked] = useState("");
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [gaps, setGaps] = useState<ExportGap[]>([]);
  const [exportError, setExportError] = useState("");
  const problem = rangeProblem(from, to);
  const scope = `${projectId}:${from}:${to}:${offset}`;
  const readScope = JSON.stringify([session.token, session.tenantId, scope, pass]);
  const page = reading?.scope === readScope ? reading.page : null;
  const error = reading?.scope === readScope ? reading.error : "";
  const loading = Boolean(projectId && !problem && reading?.scope !== readScope);
  const exportScope = JSON.stringify([session.token, session.tenantId, projectId, from, to]);
  const exportContext = useRef(exportScope);
  exportContext.current = exportScope;
  useEffect(() => {
    exportContext.current = exportScope;
    return () => { exportContext.current = ""; };
  }, [exportScope]);
  useEffect(() => { setOffset(0); setPicked(""); setGaps([]); setExportError(""); }, [projectId, from, to]);
  useEffect(() => {
    if (!projectId || problem) return;
    let live = true;
    const query = new URLSearchParams({ from, to, limit: String(limit), offset: String(offset) });
    void v1<TimeDayList>(session, `/projects/${projectId}/time/days?${query}`).then((rows) => {
      if (!live) return;
      setReading({ scope: readScope, page: rows, error: "" });
    }, (reason: unknown) => {
      if (!live) return;
      setReading({ scope: readScope, page: null, error: timeError(reason) });
    });
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, from, to, offset, pass, problem]);
  const rows = page && !problem ? page.items : [];
  const selected = rows.find((row) => rowKey(row) === picked) ?? null;
  if (!projectId) return <DeskEmpty title="Объект не выбран" description="Табель читается после выбора объекта." />;
  return <>
    <div className="object-tools">
      <label className="time-range">С <input type="date" aria-label="Начало периода" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label className="time-range">по <input type="date" aria-label="Конец периода" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <NoteMark label="Как читать табель"><p>В списке только записанные дни. Нет строки — день не записан. Это не подтверждённое отсутствие.</p></NoteMark>
      <button className="ghost desk-action" type="button" disabled={Boolean(problem) || exporting} onClick={() => void downloadExcel()}>{exporting ? "Готовим файл…" : "Скачать Excel"}</button>
      <NoteMark label="Про файл"><p>Файл приходит, только если каждый записанный день периода утверждён и совпадает с источником. Иначе сервер присылает список этих дней, а не файл без них.</p></NoteMark>
    </div>
    {problem ? <p role="alert">{problem}</p> : null}
    {exportError ? <p role="alert">{exportError}</p> : null}
    {gaps.length > 0 ? <div role="alert">
      <p>Файл не скачан. Эти дни не подтверждены актуальным снимком.</p>
      <ul className="time-gaps">
        {gaps.map((gap) => <li key={`${gap.employeeId}:${gap.day}`}>{gapName(rows, gap)}, {labelDay(gap.day)}, {gapStatus(gap.status)}</li>)}
      </ul>
      {gaps.length === 20 ? <p className="quiet">Сервер остановил список на 20 днях.</p> : null}
    </div> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {!problem && loading && !page ? <p className="quiet task-hold" role="status">Читаем табель…</p> : null}
    {!problem && !error && page && rows.length === 0 ? <DeskEmpty title="Записанных дней нет" description="В этом периоде сервер не отдал ни одного дня. Пустой список не означает, что людей не было." /> : null}
    {!problem && rows.length > 0 ? <motion.div key={scope} className="sheet-split" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      <div className="sheet-wrap">
        <table className="sheet">
          <thead><tr><th>Сотрудник</th><th>День</th><th>Присутствие</th><th>Работа</th><th>Статус</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr className={selected && rowKey(selected) === rowKey(row) ? "is-link is-on" : "is-link"} key={rowKey(row)} tabIndex={0} onClick={() => setPicked(rowKey(row))} onKeyDown={(event) => { if (event.key === "Enter") setPicked(rowKey(row)); }}>
              <td><b>{row.employeeName}</b></td>
              <td>{labelDay(row.day)}</td>
              <td>{shown(row.sourceTotals.presenceMs)}</td>
              <td>{shown(row.sourceTotals.workMs)}</td>
              <td><DeskBadge tone={row.status === "stale" || row.status === "revoked" || row.suspicious ? "warn" : "neutral"}>{timeStatusText(row.status)}</DeskBadge></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {selected ? <TimeDayRead key={rowKey(selected)} session={session} projectId={projectId} row={selected} canDecide={canDecide} onRead={(day) => {
        setReading((current) => current?.scope === readScope && current.page ? { ...current, page: { ...current.page, items: current.page.items.map((item) => rowKey(item) === rowKey(selected) ? { ...item, status: day.status, sourceTotals: day.source.totals, hasOpenIntervals: day.source.hasOpenIntervals, suspicious: day.source.suspicious, confirmedTotals: day.latest?.confirmedTotals ?? null, overridden: day.latest?.overridden ?? false } : item) } } : current);
      }} onSaved={(message) => { if (exportContext.current !== exportScope) return; setGaps([]); setExportError(""); setSaved(message); setPulse((value) => value + 1); setPass((value) => value + 1); }} /> : <p className="quiet">Выберите день, чтобы прочитать историю.</p>}
    </motion.div> : null}
    {!problem && page && page.total > page.items.length ? <div className="qualification-bar">
      <button className="ghost desk-action" type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Назад</button>
      <span className="quiet">{offset + 1}–{offset + rows.length} из {page.total}</span>
      <button className="ghost desk-action" type="button" disabled={loading || offset + rows.length >= page.total} onClick={() => setOffset(offset + limit)}>Далее</button>
    </div> : null}
    {!problem && page?.truncated ? <p className="quiet">Сервер остановил чтение, пока дни ещё остались. Сузьте период.</p> : null}
    <Flash message={saved} pulse={pulse} />
  </>;

  async function downloadExcel() {
    if (problem || exporting) return;
    setExporting(true);
    setGaps([]);
    setExportError("");
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/time/export.xlsx?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
      });
      if (exportContext.current !== exportScope) return;
      if (!response.ok) {
        const text = await response.text();
        if (exportContext.current !== exportScope) return;
        let code = "";
        try { code = text ? (JSON.parse(text) as { error?: string }).error ?? "" : ""; } catch { code = ""; }
        const listed = exportGaps(code);
        if (response.status === 409 && listed) { setGaps(listed); return; }
        throw new ApiError(response.status, code || `http_${response.status}`);
      }
      const blob = await response.blob();
      if (exportContext.current !== exportScope) return;
      if (!blob.size) throw new ApiError(502, "empty");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const named = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
      link.href = url;
      link.download = named?.[1] || `time-${from}-${to}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      setSaved("Сервер отдал Excel.");
      setPulse((value) => value + 1);
    } catch (reason) {
      if (exportContext.current === exportScope) setExportError(exportProblem(reason));
    } finally {
      setExporting(false);
    }
  }
}

function TimeDayRead({ session, projectId, row, canDecide, onRead, onSaved }: { session: Session; projectId: string; row: TimeDaySummary; canDecide: boolean; onRead: (day: TimeDay) => void; onSaved: (message: string) => void }) {
  const [pass, setPass] = useState(0);
  const [day, setDay] = useState<TimeDay | null>(null);
  const [history, setHistory] = useState<TimeHistory | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let live = true;
    setDay(null);
    setHistory(null);
    const path = `/projects/${projectId}/time/employees/${row.employeeId}/days/${row.day}`;
    void (async () => {
      try {
        const [one, past] = await Promise.all([
          v1<TimeDay>(session, path),
          v1Collection<TimeRevision>(session, `${path}/history`),
        ]);
        if (!live) return;
        setDay(one);
        onRead(one);
        setHistory({ ...past, limit: past.items.length, offset: 0 });
        setError("");
      } catch (reason) {
        if (!live) return;
        setError(timeError(reason));
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, row.employeeId, row.day, pass]);
  const ready = Boolean(day && /^[0-9a-f]{64}$/.test(day.sourceHash) && Number.isInteger(day.approvalVersion));
  const suspicious = Boolean(day?.source.suspicious);
  const canApprove = ready && day?.status !== "current";
  const canRevoke = ready && day?.latest?.state === "approved";
  async function decide(action: "approve" | "revoke") {
    if (!day || lock.current) return;
    const text = reason.trim();
    if (!text) { setDecisionError("Напишите причину."); return; }
    if (action === "approve" && suspicious && !ack) { setDecisionError("Сервер просит подтвердить пометку источника."); return; }
    lock.current = true;
    setBusy(true);
    setDecisionError("");
    try {
      const message = await postDecision(session, projectId, row.employeeId, row.day, action, {
        expectedApprovalVersion: day.approvalVersion,
        reason: text,
        ...(action === "approve" ? { sourceHash: day.sourceHash, acknowledgeSuspicious: suspicious && ack } : {}),
      });
      if (message) { onSaved(message); setPass((value) => value + 1); }
    } catch (reason) {
      setDecisionError(decisionProblem(reason));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const source = day?.source.totals ?? row.sourceTotals;
  const confirmed = day?.latest?.confirmedTotals ?? row.confirmedTotals;
  const status = day?.status ?? row.status;
  const events = [...(history?.items ?? [])].reverse().map((item) => ({
    id: `${row.employeeId}:${row.day}:${item.version}`,
    title: item.state === "approved" ? `Утверждено, версия ${item.version}` : `Отозвано, версия ${item.version}`,
    detail: `${item.reason}. Присутствие ${shown(item.confirmedTotals.presenceMs)}, работа ${shown(item.confirmedTotals.workMs)}.`,
    when: whenOf(item.recordedAt),
  }));
  return <section className="panel" aria-label="День табеля">
    <h2>{row.employeeName}</h2>
    <p className="quiet">{labelDay(row.day)}</p>
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {!day && !error ? <p className="quiet task-hold" role="status">Читаем день…</p> : null}
    <dl className="task-facts">
      <div><dt>Присутствие</dt><dd>{shown(source.presenceMs)}</dd></div>
      <div><dt>Работа</dt><dd>{shown(source.workMs)}</dd></div>
      <div><dt>Ожидание</dt><dd>{shown(source.idleMs)}</dd></div>
      <div><dt>Перерыв</dt><dd>{shown(source.breakMs)}</dd></div>
      <div><dt>Простой</dt><dd>{shown(source.downtimeMs)}</dd></div>
      <div><dt>{status === "revoked" ? "Утверждение отозвано" : status === "stale" ? "Прежнее утверждение" : "Подтверждено"}</dt><dd className={confirmed ? undefined : "is-empty"}>{confirmed ? `${shown(confirmed.presenceMs)} присутствия, ${shown(confirmed.workMs)} работы` : "не утверждено"}</dd></div>
    </dl>
    {row.hasOpenIntervals || day?.source.hasOpenIntervals ? <p className="quiet">На сервере есть открытый интервал.</p> : null}
    {row.overridden || day?.latest?.overridden ? <p className="quiet">Подтверждённая сумма отличается от источника.</p> : null}
    <h2>История</h2>
    {history && events.length === 0 ? <p className="quiet">Утверждений этого дня нет.</p> : null}
    {events.length > 0 ? <DeskTimeline events={events} /> : null}
    {history && history.total > history.items.length ? <p className="quiet">Показаны первые {history.items.length} из {history.total}.</p> : null}
    {canDecide && day ? <div className="time-decide">
      <div className="panel-head">
        <h2>Решение</h2>
        <NoteMark label="Про решение"><p>Повтор той же кнопки отправляет тот же запрос и не создаёт новую ревизию. Если версия или источник уже другие, сервер отказывает и сам решение не принимает.</p></NoteMark>
      </div>
      <label className="field"><span>Причина</span><input aria-label="Причина решения" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      {suspicious ? <label className="task-now"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> Источник помечен, я это вижу</label> : null}
      {decisionError ? <p role="alert">{decisionError} <button className="ghost desk-action" type="button" disabled={busy} onClick={() => { setDecisionError(""); setAck(false); setPass((value) => value + 1); }}>Обновить день</button></p> : null}
      <div className="template-bar">
        {canRevoke ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void decide("revoke")}>Отозвать</button> : null}
        {canApprove ? <button className="fill desk-action" type="button" disabled={busy} onClick={() => void decide("approve")}>Утвердить</button> : null}
      </div>
    </div> : null}
  </section>;
}

type ExportGap = { employeeId: string; day: string; status: string };

function exportGaps(message: string): ExportGap[] | null {
  const prefix = "time_export_incomplete:";
  if (!message.startsWith(prefix)) return null;
  try {
    const parsed = JSON.parse(message.slice(prefix.length)) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as { employeeId?: unknown; day?: unknown; status?: unknown };
      if (typeof row.employeeId !== "string" || typeof row.day !== "string" || typeof row.status !== "string") return [];
      return [{ employeeId: row.employeeId, day: row.day, status: row.status }];
    });
  } catch {
    return null;
  }
}

function gapName(rows: TimeDaySummary[], gap: ExportGap) {
  return rows.find((row) => row.employeeId === gap.employeeId)?.employeeName ?? "Сотрудник вне этой страницы";
}

function gapStatus(status: string) {
  if (status === "current" || status === "stale" || status === "revoked" || status === "unapproved") return timeStatusText(status);
  return status;
}

function exportProblem(reason: unknown) {
  const status = reason instanceof ApiError ? reason.status : 0;
  const code = reason instanceof ApiError ? reason.message : "";
  if (status === 403) return "Этому входу файл не разрешён.";
  if (status === 400) return "Период сервер не принял.";
  if (code === "time_export_row_limit") return "Сервер остановил выгрузку: записанных дней слишком много.";
  if (status === 409) return "Файл не скачан: сервер отказал.";
  return "Файл скачать не удалось.";
}

function rowKey(row: TimeDaySummary) {
  return `${row.employeeId}:${row.day}`;
}

function rangeProblem(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "Укажите начало и конец периода.";
  if (from > to) return "Начало периода позже конца.";
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= 31) return "Период не длиннее 31 дня.";
  return "";
}

function timeStatusText(status: TimeStatus) {
  if (status === "current") return "Совпадает";
  if (status === "stale") return "Источник новее";
  if (status === "revoked") return "Отозвано";
  return "Не утверждено";
}

function shown(ms: string) {
  return durationLabel(ms) || "—";
}

const decisionFlights = new Map<string, Promise<string | null>>();

function postDecision(session: Session, projectId: string, employeeId: string, day: string, action: "approve" | "revoke", body: { expectedApprovalVersion: number; reason: string; sourceHash?: string; acknowledgeSuspicious?: boolean }) {
  const signature = JSON.stringify({ action, ...body });
  const storageKey = `helios.time:${session.tenantId}:${session.userId}:${projectId}:${employeeId}:${day}:${action}`;
  const flightKey = `${storageKey}:${signature}`;
  const flying = decisionFlights.get(flightKey);
  if (flying) return flying;
  const run = (async () => {
    const requestId = timeDecisionId(storageKey, signature);
    const path = `/projects/${projectId}/time/employees/${employeeId}/days/${day}/${action === "approve" ? "approvals" : "revoke"}`;
    await v1(session, path, { ...body, requestId });
    return action === "approve" ? "Сервер утвердил часы." : "Сервер отозвал утверждение.";
  })();
  decisionFlights.set(flightKey, run);
  return run.finally(() => { if (decisionFlights.get(flightKey) === run) decisionFlights.delete(flightKey); });
}

function decisionProblem(reason: unknown) {
  const code = reason instanceof ApiError ? reason.message : "";
  const status = reason instanceof ApiError ? reason.status : 0;
  if (status === 403) return "Этому входу запись часов не разрешена.";
  if (code === "stale_approval_version") return "Версия этого дня уже другая. Решение не повторяю.";
  if (code === "stale_source" || code === "time_source_inconsistent") return "Источник дня уже другой. Решение не повторяю.";
  if (code === "approval_required") return "Утверждённой записи для отзыва нет.";
  if (code === "idempotency_payload_mismatch") return "Тот же запрос уже ушёл с другим текстом.";
  if (code === "open_intervals") return "На сервере есть открытый интервал.";
  if (code === "future_day") return "Этот день ещё не наступил.";
  if (code === "recorded_time_required") return "Записанного времени нет.";
  if (code === "suspicious_acknowledgment_required") return "Сервер просит подтвердить пометку источника.";
  if (status === 409) return "Сервер отказал и сам решение не принял.";
  return "Подтверждение решения не получено. Повторите запрос без изменения причины или обновите день.";
}

function timeError(reason: unknown) {
  const status = reason instanceof ApiError ? reason.status : 0;
  if (status === 403) return "Этому входу табель не разрешён.";
  if (status === 404) return "Этот день входу не виден.";
  if (status === 400) return "Период или запрос сервер не принял.";
  if (status === 409) return "Источник дня на сервере разошёлся.";
  if (status === 422) return "Период прочитать нельзя.";
  return "Табель прочитать не удалось.";
}

function labelDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function whenOf(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
