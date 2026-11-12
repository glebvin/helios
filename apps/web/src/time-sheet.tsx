import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { DeskBadge, DeskEmpty, DeskTimeline } from "./kit";
import { NoteMark } from "./note-mark";
import { ApiError, moscowDay, v1 } from "./v1";
import { durationLabel } from "./worker-day";

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
type TimeDay = { employeeId: string; day: string; status: TimeStatus; source: { totals: Totals; hasOpenIntervals: boolean; suspicious: boolean }; latest: { state: "approved" | "revoked"; reason: string; confirmedTotals: Totals; overridden: boolean } | null };

const limit = 50;

export function TimeSheet({ session, projectId }: { session: Session; projectId: string }) {
  const reduce = useReducedMotion();
  const today = moscowDay();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [page, setPage] = useState<TimeDayList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState("");
  const problem = rangeProblem(from, to);
  const scope = `${projectId}:${from}:${to}:${offset}`;
  useEffect(() => { setOffset(0); setPicked(""); }, [projectId, from, to]);
  useEffect(() => {
    if (!projectId || problem) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    const query = new URLSearchParams({ from, to, limit: String(limit), offset: String(offset) });
    void v1<TimeDayList>(session, `/projects/${projectId}/time/days?${query}`).then((rows) => {
      if (!live) return;
      setPage(rows);
      setError("");
    }, (reason: unknown) => {
      if (!live) return;
      setPage(null);
      setError(timeError(reason));
    }).finally(() => { if (live) setLoading(false); });
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
    </div>
    {problem ? <p role="alert">{problem}</p> : null}
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
      {selected ? <TimeDayRead session={session} projectId={projectId} row={selected} /> : <p className="quiet">Выберите день, чтобы прочитать историю.</p>}
    </motion.div> : null}
    {!problem && page && page.total > page.items.length ? <div className="qualification-bar">
      <button className="ghost desk-action" type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Назад</button>
      <span className="quiet">{offset + 1}–{offset + rows.length} из {page.total}</span>
      <button className="ghost desk-action" type="button" disabled={loading || offset + rows.length >= page.total} onClick={() => setOffset(offset + limit)}>Далее</button>
    </div> : null}
    {!problem && page?.truncated ? <p className="quiet">Сервер остановил чтение, пока дни ещё остались. Сузьте период.</p> : null}
  </>;
}

function TimeDayRead({ session, projectId, row }: { session: Session; projectId: string; row: TimeDaySummary }) {
  const [pass, setPass] = useState(0);
  const [day, setDay] = useState<TimeDay | null>(null);
  const [history, setHistory] = useState<TimeHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setDay(null);
    setHistory(null);
    const path = `/projects/${projectId}/time/employees/${row.employeeId}/days/${row.day}`;
    void (async () => {
      try {
        const [one, past] = await Promise.all([
          v1<TimeDay>(session, path),
          v1<TimeHistory>(session, `${path}/history`),
        ]);
        if (!live) return;
        setDay(one);
        setHistory(past);
        setError("");
      } catch (reason) {
        if (!live) return;
        setError(timeError(reason));
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, row.employeeId, row.day, pass]);
  const source = day?.source.totals ?? row.sourceTotals;
  const confirmed = day?.latest?.confirmedTotals ?? row.confirmedTotals;
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
      <div><dt>Подтверждено</dt><dd className={confirmed ? undefined : "is-empty"}>{confirmed ? `${shown(confirmed.presenceMs)} присутствия, ${shown(confirmed.workMs)} работы` : "не утверждено"}</dd></div>
    </dl>
    {row.hasOpenIntervals || day?.source.hasOpenIntervals ? <p className="quiet">На сервере есть открытый интервал.</p> : null}
    {row.overridden || day?.latest?.overridden ? <p className="quiet">Подтверждённая сумма отличается от источника.</p> : null}
    <h2>История</h2>
    {history && events.length === 0 ? <p className="quiet">Утверждений этого дня нет.</p> : null}
    {events.length > 0 ? <DeskTimeline events={events} /> : null}
    {history && history.total > history.items.length ? <p className="quiet">Показаны первые {history.items.length} из {history.total}.</p> : null}
  </section>;
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
