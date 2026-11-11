import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { DeskEmpty } from "./kit";
import { labelDay } from "./staff";
import { ApiError, v1, type V1Task } from "./v1";

type Totals = { presenceMs: string; idleMs: string; workMs: string; breakMs: string; downtimeMs: string };
type TimeStatus = "unapproved" | "current" | "stale" | "revoked";
type DayRow = {
  employeeId: string;
  employeeName: string;
  day: string;
  status: TimeStatus;
  sourceHash: string;
  approvalVersion: number;
  recorded: boolean;
  future: boolean;
  dayLengthMs: string;
  hasOpenIntervals: boolean;
  suspicious: boolean;
  sourceTotals: Totals;
  confirmedTotals: Totals | null;
  overridden: boolean;
  latestReason: string | null;
};
type DayList = { items: DayRow[]; total: number; limit: number; offset: number; nextOffset: number | null; truncated: boolean; scanned: number };
type Interval = { id: string; mode: string; taskId: string | null; clippedStart: string; clippedEnd: string; ms: string; open: boolean };
type FlaggedEvent = { requestId: string; kind: string; clippedOccurredAt: string; flags: { delayed: boolean; future: boolean; geoTimeMismatch: boolean; suspicious: boolean } };
type TimeDay = DayRow & {
  projectId: string;
  source: { timezone: string; totals: Totals; tasks: { taskId: string; workMs: string; downtimeMs: string }[]; segments: Interval[]; intervalEvents: FlaggedEvent[]; hasOpenIntervals: boolean; suspicious: boolean };
  capturedAt: string;
  latest: { version: number; state: string; reason: string; actorUserId: string; recordedAt: string; overridden: boolean; sourceTotals: Totals; confirmedTotals: Totals; confirmedTaskAllocation: { taskId: string; workMs: string; downtimeMs: string }[] | null } | null;
};
type HistoryItem = { version: number; state: string; reason: string; actorUserId: string; recordedAt: string; overridden: boolean; sourceTotals: Totals; confirmedTotals: Totals };
type ExportProblem = { employeeId: string; day: string; status: TimeStatus };

const totalKeys = ["presenceMs", "idleMs", "workMs", "breakMs", "downtimeMs"] as const;
const totalLabel: Record<(typeof totalKeys)[number], string> = {
  presenceMs: "Присутствие",
  idleMs: "Ожидание",
  workMs: "Работа по заданиям",
  breakMs: "Перерывы",
  downtimeMs: "Простои",
};
const statusLabel: Record<TimeStatus, string> = {
  unapproved: "Ожидает проверки",
  current: "Утверждено",
  stale: "Данные изменились",
  revoked: "Утверждение отменено",
};
const modeLabel: Record<string, string> = { idle: "Ожидание", work: "Работа по заданию", break: "Перерыв", downtime: "Простой" };
const flagLabel: Record<keyof FlaggedEvent["flags"], string> = {
  delayed: "событие пришло с опозданием",
  future: "время события впереди часов сервера",
  geoTimeMismatch: "точка и время не сходятся",
  suspicious: "сервер пометил событие",
};

function duration(ms: string) {
  try {
    const n = BigInt(ms);
    const abs = n < 0n ? -n : n;
    const hours = abs / 3600000n;
    const minutes = (abs % 3600000n) / 60000n;
    const seconds = (abs % 60000n) / 1000n;
    const millis = abs % 1000n;
    return `${n < 0n ? "−" : ""}${hours} ч ${minutes.toString().padStart(2, "0")} мин ${seconds.toString().padStart(2, "0")} с${millis ? ` ${millis} мс` : ""}`;
  } catch {
    return ms;
  }
}

function clock(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone }).format(new Date(iso));
}

function explain(code: string) {
  const text: Record<string, string> = {
    open_intervals: "В дне есть незакрытый интервал. Сначала закройте смену.",
    future_day: "Этот гражданский день ещё не закончился.",
    recorded_time_required: "За этот день нет записанного времени.",
    suspicious_acknowledgment_required: "Отметьте, что вы увидели подозрительные события.",
    invalid_confirmed_totals: "Сумма режимов должна совпадать с присутствием и не превышать длину дня.",
    stale_source: "Исходные данные изменились. Проверьте день заново.",
    stale_approval_version: "Утверждение уже изменилось. Проверьте день заново.",
    approval_required: "Отменять можно действующее утверждение.",
    role_denied: "Это действие на сервере доступно руководителю.",
    idempotency_payload_mismatch: "Повтор ушёл с другим телом. Обновите день и решите заново.",
    invalid_time_range: "Период должен быть не длиннее 31 дня.",
    time_export_row_limit: "В периоде больше 10000 записанных строк.",
    time_list_row_limit: "В периоде больше 10000 записанных строк. Сузьте даты.",
  };
  return text[code] ?? code;
}

function spanTooLong(from: string, to: string) {
  return from > to || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 >= 31;
}

function sameTotals(left: Totals, right: Totals) {
  return totalKeys.every((key) => left[key] === right[key]);
}

function addDecimal(left: string, right: string) {
  const scale = (value: string) => {
    const [whole, fraction = ""] = value.split(".");
    return BigInt((whole || "0") + (fraction + "000").slice(0, 3));
  };
  const sum = (scale(left) + scale(right)).toString().padStart(4, "0");
  return `${sum.slice(0, -3)}.${sum.slice(-3)}`;
}

export function TodaySummary({ session, projectId, projectName, day }: { session: Session; projectId: string; projectName: string; day: string }) {
  const [body, setBody] = useState<{ managed: ManagedDay; tasks: V1Task[]; taskTotal: number; waiting: DayRow[]; waitingMore: boolean } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    setBody(null);
    setError("");
    void (async () => {
      try {
        const [overview, tasks, days] = await Promise.all([
          v1<OverviewBody>(session, `/overview?projectId=${projectId}&day=${day}`, undefined, { signal: ac.signal }),
          v1<{ items: V1Task[]; total: number }>(session, `/projects/${projectId}/tasks?workDate=${day}&limit=100`, undefined, { signal: ac.signal }),
          v1<DayList>(session, `/projects/${projectId}/time/days?from=${day}&to=${day}&limit=25`, undefined, { signal: ac.signal }),
        ]);
        if (!ac.signal.aborted) setBody({ managed: overview.managedExecution, tasks: tasks.items, taskTotal: tasks.total, waiting: days.items.filter((item) => item.status === "unapproved" || item.status === "stale"), waitingMore: days.nextOffset !== null });
      } catch (reason) {
        if (!ac.signal.aborted) setError(reason instanceof ApiError ? explain(reason.message) : "Сводка не загрузилась.");
      }
    })();
    return () => ac.abort();
  }, [session, projectId, day]);
  if (error) return <p className="alert" role="alert">{error}</p>;
  if (!body) return <p className="quiet">Собираем сводку дня.</p>;
  const published = body.tasks.filter((task) => task.status === "published");
  const plan = new Map<string, string>();
  for (const task of published) plan.set(task.unit, addDecimal(plan.get(task.unit) ?? "0.000", task.plannedQuantity));
  const units = [...new Set([...plan.keys(), ...body.managed.quantities.map((item) => item.unit)])];
  return (
    <section className="page time-screen">
      <div>
        <h1>Сегодня</h1>
        <p className="sub">{projectName} · {labelDay(day)}</p>
        <p className="quiet">Данные на {clock(body.managed.asOf, body.managed.timezone)}. Это снимок сервера, не утверждённые часы.</p>
      </div>
      <div className="metrics">
        <article className="metric"><b>{body.managed.employeesStartedShiftsForDay}</b><span>начали смену в этот день</span></article>
        <article className="metric"><b>{body.managed.currentOpenShifts}</b><span>смены ещё открыты</span></article>
        <article className="metric"><b>{body.waiting.length}</b><span>дней ждут проверки</span></article>
        <article className="metric"><b>{body.managed.submittedReportsForDay}</b><span>сообщений объёма</span></article>
      </div>
      <section className="panel">
        <h2>Время по режимам</h2>
        <div className="summary-facts">
          {totalKeys.map((key) => <div key={key}><b>{duration(body.managed[key])}</b><span>{totalLabel[key]}</span></div>)}
        </div>
        {body.managed.hasOpenIntervals ? <p className="quiet">Есть незакрытый интервал: длительность ещё растёт.</p> : null}
      </section>
      <section className="panel">
        <h2>Задания и объём</h2>
        {units.length === 0 ? <DeskEmpty title="За этот день объёма нет" description="План берётся из опубликованных заданий, сообщение — из отчётов смены. Разные единицы не складываются." /> : null}
        {units.map((unit) => {
          const submitted = body.managed.quantities.find((item) => item.unit === unit);
          return (
            <div className="time-row" key={unit}>
              <b>{unit}</b>
              <span>План {plan.get(unit) ?? "нет опубликованного плана"}</span>
              <span>Сообщено {submitted?.submittedQuantity ?? "нет сообщения"}</span>
              <span>Принято: ещё не подключено</span>
            </div>
          );
        })}
        {body.taskTotal > body.tasks.length ? <p className="quiet">Показаны первые {body.tasks.length} заданий из {body.taskTotal}.</p> : null}
      </section>
      <section className="panel">
        <h2>Что ещё не подключено</h2>
        <p>Качество: ещё не подключено.</p>
        <p>Исполнительная документация: ещё не подключено.</p>
        {body.waitingMore ? <p className="quiet">В списке проверки показаны первые дни. Остальные — в табеле.</p> : null}
      </section>
    </section>
  );
}

export function ServerInbox({
  session, projectId, day, onOpenTasks, onOpenDay,
}: {
  session: Session;
  projectId: string;
  day: string;
  onOpenTasks: () => void;
  onOpenDay: (employeeId: string, day: string) => void;
}) {
  const [items, setItems] = useState<InboxCard[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    setItems(null);
    setError("");
    void (async () => {
      try {
        const [pending, drafts, days] = await Promise.all([
          v1<{ items: V1Task[]; total: number }>(session, `/projects/${projectId}/tasks?status=pending_approval&limit=25`, undefined, { signal: ac.signal }),
          v1<{ items: V1Task[]; total: number }>(session, `/projects/${projectId}/tasks?status=draft&limit=25`, undefined, { signal: ac.signal }),
          v1<DayList>(session, `/projects/${projectId}/time/days?from=${day}&to=${day}&limit=25`, undefined, { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;
        const cards: InboxCard[] = [
          ...pending.items.map((task) => ({ id: task.id, title: task.title, meta: `На согласовании · день задания ${labelDay(task.workDate)}`, action: "Открыть задания", kind: "tasks" as const })),
          ...drafts.items.map((task) => ({ id: `draft-${task.id}`, title: task.title, meta: `Черновик · день задания ${labelDay(task.workDate)}. Сервер не отмечает отдельно, возвращён он или ещё не отправлен.`, action: "Открыть задания", kind: "tasks" as const })),
          ...days.items.filter((row) => row.status !== "current").map((row) => ({ id: `${row.employeeId}:${row.day}`, title: row.employeeName, meta: `${labelDay(row.day)} · ${statusLabel[row.status]}`, action: "Открыть день", kind: "day" as const, employeeId: row.employeeId, day: row.day })),
        ];
        setItems(cards);
        setNote([pending.total > pending.items.length ? "Показаны первые 25 заданий на согласовании." : "", drafts.total > drafts.items.length ? "Показаны первые 25 черновиков." : "", days.nextOffset !== null ? "В этом дне есть ещё записанные строки. Они в табеле." : ""].filter(Boolean).join(" "));
      } catch (reason) {
        if (!ac.signal.aborted) setError(reason instanceof ApiError ? explain(reason.message) : "Дела не загрузились.");
      }
    })();
    return () => ac.abort();
  }, [session, projectId, day]);
  return (
    <section className="page time-screen">
      <div>
        <h1>Мои дела</h1>
        <p className="sub">{labelDay(day)}</p>
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {items === null && !error ? <p className="quiet">Собираем дела из заданий и табеля.</p> : null}
      {items && items.length === 0 ? <DeskEmpty title="Сейчас пусто" description="Здесь появятся задания на согласовании, черновики и дни, которые ждут проверки. Срок, которого нет в данных, не подставляется." /> : null}
      <div className="stack">
        {items?.map((item) => (
          <article className="job" key={item.id}>
            <b>{item.title}</b>
            <p className="day-copy">{item.meta}</p>
            <button className="fill" type="button" onClick={() => item.kind === "tasks" ? onOpenTasks() : onOpenDay(item.employeeId!, item.day!)}>{item.action}</button>
          </article>
        ))}
      </div>
      {note ? <p className="quiet">{note}</p> : null}
    </section>
  );
}

export function OwnDayStatus({ session, projectId, employeeId, day }: { session: Session; projectId: string; employeeId: string; day: string }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    void v1<TimeDay>(session, `/projects/${projectId}/time/employees/${employeeId}/days/${day}`, undefined, { signal: ac.signal })
      .then((body) => setText(body.recorded ? `Часы дня: ${statusLabel[body.status]}.` : "За этот день записанного времени нет. Это не подтверждённое отсутствие."))
      .catch(() => setText(""));
    return () => ac.abort();
  }, [session, projectId, employeeId, day]);
  return text ? <p className="quiet">{text}</p> : null;
}

export function TimeDesk({
  session, projectId, projectName, day, canApprove, canExport, focus,
}: {
  session: Session;
  projectId: string;
  projectName: string;
  day: string;
  canApprove: boolean;
  canExport: boolean;
  focus: { employeeId: string; day: string } | null;
}) {
  const [from, setFrom] = useState(focus?.day ?? day);
  const [to, setTo] = useState(focus?.day ?? day);
  const [status, setStatus] = useState<"" | TimeStatus>("");
  const [rows, setRows] = useState<DayRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState(focus ? `${focus.employeeId}:${focus.day}` : "");
  const [problems, setProblems] = useState<ExportProblem[]>([]);
  const [exportError, setExportError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stamp, setStamp] = useState(0);
  const flight = useRef(0);

  useEffect(() => {
    setFrom(focus?.day ?? day);
    setTo(focus?.day ?? day);
    if (focus) setOpenKey(`${focus.employeeId}:${focus.day}`);
  }, [day, focus]);

  useEffect(() => {
    const mine = ++flight.current;
    const ac = new AbortController();
    setLoading(true);
    setError("");
    setRows([]);
    setCursor(null);
    void load(0, false);
    return () => ac.abort();

    async function load(offset: number, append: boolean) {
      if (spanTooLong(from, to)) {
        if (mine === flight.current) { setLoading(false); setError("Период должен быть не длиннее 31 дня."); }
        return;
      }
      try {
        const query = new URLSearchParams({ from, to, limit: "20", offset: String(offset) });
        if (status) query.set("status", status);
        const body = await v1<DayList>(session, `/projects/${projectId}/time/days?${query}`, undefined, { signal: ac.signal });
        if (mine !== flight.current) return;
        setRows((current) => append ? [...current, ...body.items] : body.items);
        setCursor(body.nextOffset);
        setTruncated(body.truncated);
        setTotal(body.total);
        setLoading(false);
      } catch (reason) {
        if (mine !== flight.current || (reason instanceof DOMException && reason.name === "AbortError")) return;
        setLoading(false);
        setError(reason instanceof ApiError ? explain(reason.message) : "Табель не загрузился.");
      }
    }
  }, [session, projectId, from, to, status, stamp]);

  async function more() {
    if (cursor === null || busy) return;
    const mine = flight.current;
    setBusy(true);
    try {
      const query = new URLSearchParams({ from, to, limit: "20", offset: String(cursor) });
      if (status) query.set("status", status);
      const body = await v1<DayList>(session, `/projects/${projectId}/time/days?${query}`);
      if (mine !== flight.current) return;
      setRows((current) => [...current, ...body.items]);
      setCursor(body.nextOffset);
      setTruncated(body.truncated);
      setTotal(body.total);
    } catch (reason) {
      setError(reason instanceof ApiError ? explain(reason.message) : "Следующая страница не загрузилась.");
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (busy || spanTooLong(from, to)) { setExportError("Период должен быть не длиннее 31 дня."); return; }
    setBusy(true);
    setExportError("");
    setProblems([]);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/time/export.xlsx?from=${from}&to=${to}`, {
        headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `http_${response.status}` })) as { error?: string };
        const code = body.error ?? "";
        if (response.status === 409 && code.startsWith("time_export_incomplete:")) {
          setProblems(JSON.parse(code.slice("time_export_incomplete:".length)) as ExportProblem[]);
          setExportError("Файл не собран: есть дни без действующего утверждения.");
          return;
        }
        setExportError(explain(code));
        return;
      }
      const blob = await response.blob();
      const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      if (head[0] !== 0x50 || head[1] !== 0x4b) { setExportError("Сервер прислал не книгу Excel."); return; }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `time-${from}-${to}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("Файл не скачался.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page time-screen">
      <div>
        <h1>Табель</h1>
        <p className="sub">{projectName}</p>
        <p className="quiet">В списке только дни с записанным временем. Пустая клетка здесь не появляется и не значит, что человека не было.</p>
      </div>
      <div className="panel-tools">
        <label className="field">С <input type="date" aria-label="Начало периода" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label className="field">По <input type="date" aria-label="Конец периода" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        {canExport ? <button className="fill" type="button" disabled={busy} onClick={() => void download()}>{busy ? "Готовим файл…" : "Скачать Excel"}</button> : <p className="quiet">Файл часов этому входу не отдаётся.</p>}
      </div>
      {exportError ? <p className="alert" role="alert">{exportError}</p> : null}
      {problems.length ? (
        <div className="stack">
          {problems.map((item) => (
            <button className="ghost" type="button" key={`${item.employeeId}:${item.day}`} onClick={() => { setFrom(item.day); setTo(item.day); setStatus(""); setOpenKey(`${item.employeeId}:${item.day}`); }}>
              {labelDay(item.day)} · {statusLabel[item.status] ?? item.status}
            </button>
          ))}
          <p className="quiet">Сервер остановил файл на первых {problems.length} проблемах и не выбросил остальные строки молча.</p>
        </div>
      ) : null}
      <div className="roles" role="tablist" aria-label="Состояние проверки">
        {([["", "Все"], ["unapproved", statusLabel.unapproved], ["current", statusLabel.current], ["stale", statusLabel.stale], ["revoked", statusLabel.revoked]] as const).map(([id, label]) => (
          <button className={status === id ? "is-on" : ""} type="button" role="tab" aria-selected={status === id} key={id || "all"} onClick={() => setStatus(id)}>{label}</button>
        ))}
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {loading ? <p className="quiet">Загружаем записанные дни.</p> : null}
      {!loading && !error && rows.length === 0 ? <DeskEmpty title={total > 0 ? "В этом срезе пусто" : "Записанных дней нет"} description={total > 0 ? "Записанные дни есть, но не в выбранном состоянии. Пустой срез не означает, что человека не было." : "За этот период сервер не нашёл интервалов. Это не подтверждённое отсутствие работника."} /> : null}
      <div className="stack">
        {rows.map((row) => {
          const key = `${row.employeeId}:${row.day}`;
          const open = openKey === key;
          return (
            <article className="job" key={key}>
              <button className="time-row" type="button" aria-expanded={open} onClick={() => setOpenKey(open ? "" : key)}>
                <b>{row.employeeName}</b>
                <span>{labelDay(row.day)}</span>
                <span>{statusLabel[row.status]}</span>
                <span>{duration(row.sourceTotals.presenceMs)}</span>
              </button>
              <p className="quiet">{totalKeys.filter((item) => item !== "presenceMs").map((item) => `${totalLabel[item]} ${duration(row.sourceTotals[item])}`).join(" · ")}</p>
              {row.hasOpenIntervals ? <p className="quiet">Интервал ещё открыт.</p> : null}
              {open ? (
                <DayReview
                  session={session}
                  projectId={projectId}
                  row={row}
                  canApprove={canApprove}
                  onChanged={() => setStamp((current) => current + 1)}
                />
              ) : null}
            </article>
          );
        })}
      </div>
      {cursor !== null ? <button className="ghost" type="button" disabled={busy} onClick={() => void more()}>{busy ? "Загружаем…" : "Дальше"}</button> : null}
      {truncated ? <p className="quiet">Фильтр просмотрел часть записанных дней. Нажмите «Дальше» или сузьте период.</p> : null}
      {!loading && total > rows.length ? <p className="quiet">В периоде {total} записанных дней. На экране {rows.length}.</p> : null}
    </section>
  );
}

function DayReview({ session, projectId, row, canApprove, onChanged }: { session: Session; projectId: string; row: DayRow; canApprove: boolean; onChanged: () => void }) {
  const [day, setDay] = useState<TimeDay | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState("");
  const [reason, setReason] = useState("");
  const [ack, setAck] = useState(false);
  const [totals, setTotals] = useState<Totals>(row.sourceTotals);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const held = useRef<{ key: string; requestId: string } | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setDay(null);
    setError("");
    void (async () => {
      try {
        const [detail, past] = await Promise.all([
          v1<TimeDay>(session, `/projects/${projectId}/time/employees/${row.employeeId}/days/${row.day}`, undefined, { signal: ac.signal }),
          v1<{ items: HistoryItem[] }>(session, `/projects/${projectId}/time/employees/${row.employeeId}/days/${row.day}/history?limit=20`, undefined, { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;
        setDay(detail);
        setHistory(past.items);
        setTotals(detail.source.totals);
        setAck(false);
      } catch (reason) {
        if (!ac.signal.aborted) setError(reason instanceof ApiError ? explain(reason.message) : "День не открылся.");
      }
    })();
    return () => ac.abort();
  }, [session, projectId, row.employeeId, row.day, reloadKey]);

  function requestId(kind: string, payload: string) {
    const key = `${kind}|${payload}`;
    if (held.current?.key !== key) held.current = { key, requestId: crypto.randomUUID() };
    return held.current.requestId;
  }

  async function send(kind: "approve" | "revoke") {
    if (!day || busy || !reason.trim()) { setError("Напишите причину."); return; }
    const confirmed = sameTotals(totals, day.source.totals) ? undefined : totals;
    const payload = kind === "revoke"
      ? { requestId: requestId(kind, `${day.approvalVersion}|${reason.trim()}`), expectedApprovalVersion: day.approvalVersion, reason: reason.trim() }
      : { requestId: requestId(kind, `${day.sourceHash}|${day.approvalVersion}|${reason.trim()}|${ack}|${JSON.stringify(confirmed ?? null)}`), expectedApprovalVersion: day.approvalVersion, sourceHash: day.sourceHash, reason: reason.trim(), ...(day.source.suspicious ? { acknowledgeSuspicious: ack } : {}), ...(confirmed ? { confirmedTotals: confirmed } : {}) };
    setBusy(true);
    setError("");
    setConflict("");
    try {
      await v1(session, `/projects/${projectId}/time/employees/${row.employeeId}/days/${row.day}/${kind === "revoke" ? "revoke" : "approvals"}`, payload);
      held.current = null;
      setReason("");
      setReloadKey((value) => value + 1);
      onChanged();
    } catch (reason) {
      const code = reason instanceof ApiError ? reason.message : "";
      if (code === "stale_source" || code === "stale_approval_version") {
        held.current = null;
        setConflict(explain(code));
        setReloadKey((value) => value + 1);
        onChanged();
      } else {
        setError(reason instanceof ApiError ? explain(reason.message) : "Действие не сохранилось.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (error && !day) return <p className="alert" role="alert">{error}</p>;
  if (!day) return <p className="quiet">Открываем день.</p>;
  const blocked = day.source.hasOpenIntervals || day.future || !day.recorded;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <p>{statusLabel[day.status]}. Снимок {clock(day.capturedAt, day.source.timezone)}.</p>
      {conflict ? <p className="alert" role="alert">{conflict} Новые данные уже на экране, само утверждение не повторялось.</p> : null}
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {day.source.hasOpenIntervals ? <p>Интервал ещё открыт. Утвердить такой день сервер не даст.</p> : null}
      {day.future ? <p>День ещё не наступил по часам кабинета.</p> : null}
      <div className="summary-facts">
        {totalKeys.map((key) => (
          <div key={key}>
            <b>{duration(day.source.totals[key])}</b>
            <span>{totalLabel[key]}{day.latest ? ` · утверждено ${duration(day.latest.confirmedTotals[key])}` : ""}</span>
          </div>
        ))}
      </div>
      {day.latest?.overridden ? <p>Поправка записана в итогах. Сервер не разложил её по заданиям.</p> : null}
      {day.latest && !day.latest.overridden && day.latest.confirmedTaskAllocation?.length ? (
        <p className="quiet">По заданиям: {day.latest.confirmedTaskAllocation.map((item) => `${item.taskId.slice(0, 8)} · работа ${duration(item.workMs)}`).join("; ")}</p>
      ) : null}
      <h3>Интервалы</h3>
      <ul className="day-history">
        {day.source.segments.map((segment) => (
          <li key={segment.id}>{clock(segment.clippedStart, day.source.timezone)}–{segment.open ? "открыт" : clock(segment.clippedEnd, day.source.timezone)} · {modeLabel[segment.mode] ?? segment.mode} · {duration(segment.ms)}</li>
        ))}
      </ul>
      {day.source.intervalEvents.some((event) => Object.values(event.flags).some(Boolean)) ? (
        <div className="alert-note">
          <div>
            {day.source.intervalEvents.filter((event) => Object.values(event.flags).some(Boolean)).map((event) => (
              <p key={event.requestId}>{clock(event.clippedOccurredAt, day.source.timezone)}: {(Object.keys(event.flags) as (keyof FlaggedEvent["flags"])[]).filter((key) => event.flags[key]).map((key) => flagLabel[key]).join(", ")}</p>
            ))}
          </div>
        </div>
      ) : null}
      <h3>История утверждений</h3>
      {history.length === 0 ? <p className="quiet">Утверждений ещё не было.</p> : null}
      <ul className="day-history">
        {history.map((item) => (
          <li key={item.version}>Версия {item.version} · {item.state === "approved" ? "Утверждено" : "Отменено"} · {clock(item.recordedAt, day.source.timezone)}<br />{item.reason}<br />Автор {item.actorUserId}{item.overridden ? ` · итог ${duration(item.confirmedTotals.presenceMs)} при источнике ${duration(item.sourceTotals.presenceMs)}` : ""}</li>
        ))}
      </ul>
      {canApprove ? (
        <div className="stack">
          <label className="field">Причина
            <textarea value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
          </label>
          {day.source.suspicious ? (
            <label className="field"><input type="checkbox" checked={ack} onChange={(event) => setAck(event.target.checked)} /> Я вижу подозрительные события и подтверждаю это отдельно</label>
          ) : null}
          <fieldset className="stack">
            <legend>Подтверждённые итоги</legend>
            {totalKeys.map((key) => (
              <label className="field" key={key}>{totalLabel[key]}
                <input inputMode="numeric" aria-label={totalLabel[key]} value={totals[key]} onChange={(event) => setTotals((current) => ({ ...current, [key]: event.target.value }))} />
                <span className="quiet">Сейчас {duration(totals[key])}. Источник {duration(day.source.totals[key])}.</span>
              </label>
            ))}
          </fieldset>
          {!blocked ? <button className="fill" type="button" disabled={busy || !reason.trim()} onClick={() => void send("approve")}>{busy ? "Сохраняем…" : day.status === "current" ? "Подтвердить заново" : "Утвердить"}</button> : null}
          {day.status === "current" ? <button className="ghost" type="button" disabled={busy || !reason.trim()} onClick={() => void send("revoke")}>Отменить утверждение</button> : null}
        </div>
      ) : <p className="quiet">Утверждение, поправка и отмена доступны руководителю.</p>}
    </motion.div>
  );
}

type ManagedDay = {
  asOf: string;
  timezone: string;
  employeesStartedShiftsForDay: number;
  currentOpenShifts: number;
  submittedReportsForDay: number;
  hasOpenIntervals: boolean;
  quantities: { unit: string; submittedQuantity: string }[];
} & Totals;
type OverviewBody = { managedExecution: ManagedDay };
type InboxCard = { id: string; title: string; meta: string; action: string; kind: "tasks" | "day"; employeeId?: string; day?: string };
