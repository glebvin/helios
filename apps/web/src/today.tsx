import { useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { DeskBadge, DeskEmpty, FluidTabs, StatGrid } from "./kit";
import { NoteMark } from "./note-mark";
import { civilLabel } from "./scope";
import { taskListPath, taskStatusText, type ServerTask } from "./task-read";
import { timeStatusText, type TimeStatus } from "./time-sheet";
import { ApiError, v1, v1Collection } from "./v1";
import { durationLabel } from "./worker-day";
import { useServerRead } from "./server-read";

type Managed = {
  presenceMs: string;
  workMs: string;
  downtimeMs: string;
  hasOpenIntervals: boolean;
  employeesStartedShiftsForDay: number;
  currentOpenShifts: number;
  submittedReportsForDay: number;
  quantities: { unit: string; submittedQuantity: string; acceptedQuantity: string | null }[];
};
type Overview = {
  day: string;
  quality: { status: string; value: null };
  idReadiness: { status: string; value: null };
  managedExecution: Managed;
};
type TaskPage = { items: ServerTask[]; total: number };
type TimeRow = { employeeId: string; employeeName: string; day: string; status: TimeStatus; hasOpenIntervals: boolean; suspicious: boolean };
type TimePage = { items: TimeRow[]; total: number; nextOffset: number | null };
type DayBody = { overview: Overview; tasks: TaskPage; days: TimePage; names: Record<string, string> };

const ease = [0.23, 1, 0.32, 1] as const;
const slices = [
  { id: "today", label: "Сегодня" },
  { id: "overdue", label: "Просрочено" },
  { id: "all", label: "Все" },
];

function readError(reason: unknown) {
  const status = reason instanceof ApiError ? reason.status : 0;
  if (status === 401) return "Сессия закончилась. Войдите снова.";
  if (status === 403) return "Этому входу сводка объекта недоступна.";
  if (status === 404) return "Объект этому входу недоступен.";
  if (status === 400) return "Сервер не принял день или объект.";
  return "Нет подтверждения сервера. Повторите чтение.";
}

function taskTone(status: string): "neutral" | "accent" | "warn" {
  if (status === "published") return "accent";
  if (status === "cancelled" || status === "needs_fix") return "warn";
  return "neutral";
}

function useServerDay(session: Session, projectId: string, day: string, notice: string) {
  return useServerRead<DayBody>(session, `${projectId}:${day}`, notice || (!projectId || !day ? "Объект и день не подтверждены." : ""), async () => {
    const [overview, tasks, days, people] = await Promise.all([
      v1<Overview>(session, `/overview?projectId=${projectId}&day=${day}`),
      v1<TaskPage>(session, taskListPath(projectId, day, 0)),
      v1Collection<TimeRow>(session, `/projects/${projectId}/time/days?from=${day}&to=${day}`),
      v1Collection<{ id: string; fullName: string }>(session, `/employees?projectId=${projectId}`).catch(() => ({ items: [], total: 0 })),
    ]);
    return { overview, tasks, days: { ...days, nextOffset: null }, names: Object.fromEntries(people.items.map((item) => [item.id, item.fullName])) };
  }, readError);
}

function Hold({ text }: { text: string }) {
  return <p className="quiet task-hold" role="status">{text}</p>;
}

function Appear({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className="live-read-body" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }}>
      {children}
    </motion.div>
  );
}

export function LiveToday({
  title, session, projectId, projectName, day, notice, openLabel, onOpen, onOpenTasks, onOpenSheet,
}: {
  title: string;
  session: Session;
  projectId: string;
  projectName: string;
  day: string;
  notice: string;
  openLabel: string;
  onOpen: () => void;
  onOpenTasks: (id?: string) => void;
  onOpenSheet: () => void;
}) {
  const dayRead = useServerDay(session, projectId, day, notice);
  const shownDay = civilLabel(day);
  return (
    <section className="page">
      <div>
        <h1>{title}</h1>
        <p className="sub">{notice || (projectName && shownDay ? `${projectName} · ${shownDay}` : "Объект и день появятся после ответа сервера")}</p>
      </div>
      {notice ? <DeskEmpty title="День не подтверждён" description={notice} /> : null}
      {!notice && dayRead.loading ? <Hold text="Читаем сводку…" /> : null}
      {!notice && dayRead.error ? <p role="alert">{dayRead.error} <button className="ghost desk-action" type="button" onClick={dayRead.retry}>Повторить чтение</button></p> : null}
      {!notice && dayRead.body ? <Appear><TodayBody body={dayRead.body} day={day} openLabel={openLabel} onOpen={onOpen} onOpenTasks={onOpenTasks} onOpenSheet={onOpenSheet} /></Appear> : null}
    </section>
  );
}

function TodayBody({ body, day, openLabel, onOpen, onOpenTasks, onOpenSheet }: { body: DayBody; day: string; openLabel: string; onOpen: () => void; onOpenTasks: (id?: string) => void; onOpenSheet: () => void }) {
  const managed = body.overview.managedExecution;
  const waiting = body.days.items.filter((row) => row.status !== "current");
  const accepted = body.tasks.items.filter((task) => task.status === "accepted" || task.status === "partially_accepted" || task.status === "closed").length;
  const attention = [
    ...waiting.map((row) => ({ id: `${row.employeeId}:${row.day}`, title: row.employeeName, detail: timeStatusText(row.status), open: onOpenSheet })),
    ...body.tasks.items.filter((task) => task.status === "pending_approval" || task.status === "needs_fix" || task.status === "submitted" || task.status === "in_review").map((task) => ({
      id: task.id, title: task.title, detail: taskStatusText(task.status), open: () => onOpenTasks(task.id),
    })),
  ];
  return (
    <>
      <StatGrid items={[
        { value: String(managed.employeesStartedShiftsForDay), label: "начали смену в этот день", tone: managed.employeesStartedShiftsForDay > 0 ? "accent" : undefined },
        { value: String(managed.currentOpenShifts), label: "смены открыты сейчас", tone: managed.currentOpenShifts > 0 ? "accent" : undefined },
        { value: body.days.nextOffset !== null ? `${waiting.length}+` : String(waiting.length), label: "дни без сверки", tone: waiting.length > 0 ? "warn" : undefined },
        { value: String(managed.submittedReportsForDay), label: "сообщений объёма" },
      ]} />
      <section className="panel">
        <h2>Сводка дня <NoteMark label="Что не считается"><p>Присутствие, работа и простой — снимок сервера, не утверждённые часы. Принятый мастером объём показывается, только когда по единице решены все сообщения дня. Качество и исполнительная документация не подключены: вместо них не ставится ноль. Нет строки табеля — день не записан, это не подтверждённое отсутствие.</p></NoteMark></h2>
        <div className="summary-facts">
          <div><b>{durationLabel(managed.presenceMs) || "—"}</b><span>присутствие по источнику</span></div>
          <div><b>{durationLabel(managed.workMs) || "—"}</b><span>работа по заданиям</span></div>
          <div><b>{durationLabel(managed.downtimeMs) || "—"}</b><span>простой в снимке</span></div>
          <div><b>не подключено</b><span>качество и ИД</span></div>
        </div>
        <p className="quiet person-note">
          {body.overview.day === day ? `День сводки совпадает с шапкой: ${civilLabel(day)}.` : `Шапка просит ${civilLabel(day)}, сводка сервера — ${civilLabel(body.overview.day) || body.overview.day}.`}
          {managed.hasOpenIntervals ? " Есть незакрытый интервал: длительность ещё растёт." : ""}
          {" "}Принятое мастером количество есть только у полностью решённой единицы. Это не приёмка ПТО.
          {body.overview.quality.status !== "unavailable" || body.overview.idReadiness.status !== "unavailable" ? " Сервер прислал поле, которое кабинет не показывает числом." : ""}
        </p>
        {managed.quantities.map((item) => <p className="quiet" key={item.unit}>Сообщено {item.submittedQuantity} {item.unit}. {item.acceptedQuantity === null ? "Мастер ещё не принял все сообщения этой единицы." : `Принято мастером ${item.acceptedQuantity} ${item.unit}. Это не приёмка ПТО.`}</p>)}
      </section>
      <div className="split">
        <section className="panel">
          <h2>Ход работ</h2>
          <div className="work-head"><span>Работа</span><span>План</span><span>Статус</span><span>Исполнитель</span></div>
          {body.tasks.items.length === 0 ? <DeskEmpty title="На этот день заданий нет" description="Список тот же, что на доске. Пусто не означает, что работу забыли записать." /> : null}
          {body.tasks.items.map((task) => (
            <div className="work-line" key={task.id}>
              <b>{task.title}</b>
              <span>{task.plannedQuantity} {task.unit}</span>
              <DeskBadge tone={taskTone(task.status)}>{taskStatusText(task.status)}</DeskBadge>
              <span>{body.names[task.assigneeEmployeeId] ?? "Имя не пришло"}</span>
            </div>
          ))}
          {body.tasks.total > body.tasks.items.length ? <p className="quiet">На главной первые {body.tasks.items.length} из {body.tasks.total}. Остальные на доске этого же дня.</p> : null}
        </section>
        <section className="panel">
          <h2>Требует внимания {attention.length > 0 ? <span className="count">{attention.length}</span> : null}</h2>
          <div className="attention live-attention">
            {attention.length === 0 ? <DeskEmpty title="Сейчас пусто" description="Здесь появятся дни табеля без сверки и задания, которые сервер ещё не принял." /> : null}
            {attention.map((item) => (
              <div className="attention-row" key={item.id}>
                <span><b>{item.title}</b><small>{item.detail}</small></span>
                <button className="ghost desk-action" type="button" onClick={item.open}>Открыть</button>
              </div>
            ))}
          </div>
          {body.days.nextOffset !== null ? <p className="quiet">В дне есть ещё записанные строки. Они в табеле.</p> : null}
        </section>
      </div>
      <div className="daybar">
        <div>
          <b>Итоги дня</b>
          <div className="quiet">{accepted} из {body.tasks.items.length} на этой странице имеют серверный статус принятия. Это не приёмка качества.</div>
        </div>
        <button className="fill desk-action" type="button" onClick={onOpen}>{openLabel}</button>
      </div>
    </>
  );
}

export function LiveInbox({
  session, projectId, projectName, day, notice, onOpenTasks, onOpenSheet,
}: {
  session: Session;
  projectId: string;
  projectName: string;
  day: string;
  notice: string;
  onOpenTasks: (id?: string) => void;
  onOpenSheet: () => void;
}) {
  const [slice, setSlice] = useState("today");
  const dayRead = useServerDay(session, projectId, day, notice);
  const extraRead = useServerRead(session, projectId, notice || (!projectId ? "Объект не подтверждён." : ""), async () => {
    const [pending, drafts] = await Promise.all([
      v1Collection<ServerTask>(session, `/projects/${projectId}/tasks?status=pending_approval`),
      v1Collection<ServerTask>(session, `/projects/${projectId}/tasks?status=draft`),
    ]);
    return [...pending.items, ...drafts.items];
  }, readError);
  const extra = extraRead.body;
  const extraError = extraRead.error;
  const names = dayRead.body?.names ?? {};
  const items = [
    ...(extra ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      who: names[task.assigneeEmployeeId] ?? "Имя не пришло",
      date: task.workDate.slice(0, 10),
      status: taskStatusText(task.status),
      tone: taskTone(task.status),
      note: task.status === "draft" ? "Черновик. Сервер не отмечает, возвращён он или ещё не отправлен." : "День задания, не отдельный срок.",
      action: "К заданию",
      open: () => onOpenTasks(task.id),
    })),
    ...(dayRead.body?.days.items ?? []).filter((row) => row.status !== "current").map((row) => ({
      id: `${row.employeeId}:${row.day}`,
      title: row.employeeName,
      who: row.employeeName,
      date: row.day,
      status: timeStatusText(row.status),
      tone: row.status === "stale" || row.status === "revoked" || row.suspicious ? "warn" as const : "neutral" as const,
      note: "Это сверка табеля, не приёмка качества.",
      action: "К табелю",
      open: onOpenSheet,
    })),
  ];
  const visible = items.filter((item) => slice === "all" || (slice === "today" ? item.date === day : item.date < day));
  const overdue = items.filter((item) => item.date < day).length;
  const dueToday = items.filter((item) => item.date === day).length;
  return (
    <section className="page inbox-page">
      <div>
        <h1>Мои дела</h1>
        <p className="sub">{notice || `${projectName} · ${civilLabel(day)}`}</p>
      </div>
      <div className="inbox-toolbar">
        <FluidTabs name="inbox-tabs" label="Срез дел" value={slice} onChange={setSlice} tabs={slices} />
        <div className="inbox-stat is-warn"><b>{extra === null ? "—" : overdue}</b><span>день задания раньше</span></div>
        <div className="inbox-stat is-accent"><b>{dayRead.body && extra ? dueToday : "—"}</b><span>на этот день</span></div>
      </div>
      {notice ? <DeskEmpty title="День не подтверждён" description={notice} /> : null}
      {!notice && (dayRead.loading || extra === null) && !dayRead.error && !extraError ? <Hold text="Читаем дела…" /> : null}
      {!notice && (dayRead.error || extraError) ? <p role="alert">{dayRead.error || extraError} <button className="ghost desk-action" type="button" onClick={() => { dayRead.retry(); extraRead.retry(); }}>Повторить чтение</button></p> : null}
      {!notice && dayRead.body && extra ? (
        <Appear>
          <div className="inbox">
            <div>
              <div className="inbox-list">
                {visible.length === 0 ? <div className="inbox-empty"><p>{slice === "overdue" ? "Заданий с более ранним днём нет." : slice === "today" ? "На этот день открытых дел нет." : "Открытых дел нет."}</p><button className="ghost desk-action" type="button" onClick={() => onOpenTasks()}>К заданиям</button></div> : null}
                {visible.map((item) => (
                  <article className={item.tone === "neutral" ? "inbox-row" : `inbox-row is-${item.tone}`} key={item.id}>
                    <span />
                    <div>
                      <b>{item.title}</b>
                      <div className="quiet">{item.note}</div>
                      <DeskBadge tone={item.tone}>{item.status}</DeskBadge>
                    </div>
                    <div className="inbox-who"><span className="quiet inbox-label">Ответственный</span><b>{item.who}</b></div>
                    <div className="inbox-when"><span className="quiet inbox-label">День задания</span><b>{civilLabel(item.date)}</b></div>
                    <button className="ghost desk-action" type="button" onClick={item.open}>{item.action}</button>
                  </article>
                ))}
              </div>
            </div>
            <aside className="deadlines">
              <h2>Дни заданий</h2>
              <p className="quiet">Отдельного срока сервер не присылает. Приёмка качества отсюда не записывается.</p>
              {items.filter((item) => item.action === "К заданию").slice(0, 5).map((item) => (
                <div className="deadline" key={item.id}><div><b>{civilLabel(item.date)}</b><div>{item.title}</div><span className="quiet">{item.who} · {projectName}</span></div></div>
              ))}
            </aside>
          </div>
        </Appear>
      ) : null}
    </section>
  );
}
