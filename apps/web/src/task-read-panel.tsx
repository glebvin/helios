import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskBadge, DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";
import { FrontCheckPanel } from "./front-check-panel";
import { ShiftPanel } from "./shift-panel";
import { TaskActionPanel } from "./task-action-panel";
import { TaskDraftDialog } from "./task-draft-form";
import { canWriteTaskDraft } from "./task-draft";
import { ApiError, v1, v1Items, v1Collection } from "./v1";
import { ChecklistRunPanel } from "./checklist-run-panel";
import { listChecklistCards, openDelivery, type ChecklistCard } from "./delivery";
import { VolumeDesk } from "./volume-panel";
import { canWriteVolume, reportListPath, volumeLines, type VolumeReport } from "./volume";
import { boardColumn, shownTaskStatus, taskError, taskListPath, taskStatusText, type BoardColumn, type ServerTask } from "./task-read";
import { boardVolumeLabel, masterDecisionMap } from "./board-volume";

type Page = { items: ServerTask[]; total: number; limit: number; offset: number };
type BoardView = "board" | "list";
const columns: { id: BoardColumn; title: string; empty: string }[] = [
  { id: "assigned", title: "Назначено", empty: "Пока пусто." },
  { id: "shift", title: "На смене", empty: "Сервер смену здесь не отметил." },
  { id: "submitted", title: "Сдано", empty: "Сданного объёма нет." },
  { id: "accepted", title: "Принято", empty: "Принятой работы нет." },
];

export function TaskRead({ session, projectId, day, notice = "", compact = false, openTaskId = "", openToken = 0 }: { session: Session; projectId: string; day: string; notice?: string; compact?: boolean; openTaskId?: string; openToken?: number }) {
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<BoardView>(compact ? "list" : "board");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServerTask | null>(null);
  const [saved, setSaved] = useState("");
  const [savedPulse, setSavedPulse] = useState(0);
  const [reported, setReported] = useState<Record<string, { reportId: string; submittedQuantity: string }[]> | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string | null> | null>(null);
  const [volumeNote, setVolumeNote] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [localTasks, setLocalTasks] = useState<ChecklistCard[]>([]);
  const [stamp, setStamp] = useState("");
  const canWrite = canWriteTaskDraft(session.role);
  const ready = Boolean(projectId && day && !notice);
  const scope = `${projectId}:${day}:${offset}`;
  const reduce = useReducedMotion();
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => { setOffset(0); setOpenId(openTaskId || null); }, [projectId, day, openTaskId, openToken]);
  useEffect(() => {
    if (!ready) { setLoading(false); setPage(null); setStamp(""); return; }
    let live = true;
    if (stamp !== scope) setLoading(true);
    void (async () => {
      try {
        const rows = await v1<Page>(session, taskListPath(projectId, day, offset));
        if (!live) return;
        setPage(rows); setError(""); setStamp(scope);
        if (offset && offset >= rows.total) setOffset(Math.max(0, Math.floor((rows.total - 1) / 25) * 25));
        const [people, zones, types] = await Promise.all([
          readNames(session, `/employees?projectId=${projectId}&limit=100`, "fullName"),
          session.role === "worker" ? Promise.resolve({}) : readNames(session, `/projects/${projectId}/zones?limit=100`, "name"),
          session.role === "worker" ? Promise.resolve({}) : readNames(session, `/projects/${projectId}/work-types?limit=100`, "name"),
        ]);
        if (!live) return;
        setNames({ ...people, ...zones, ...types });
        try {
          const reports = await v1Collection<VolumeReport>(session, reportListPath(projectId));
          if (!live) return;
          const lines = volumeLines(reports.items, reports.total);
          setReported(lines);
          setVolumeNote(lines ? "" : "Отчёты объёма прочитаны не полностью.");
        } catch {
          if (!live) return;
          setReported(null);
          setVolumeNote("Отчёты объёма прочитать не удалось.");
        }
        try {
          const reviews = await v1<{ items: { reportId: string; totalAcceptedQuantity: string | null }[]; total: number }>(session, `/projects/${projectId}/volume-reviews?day=${day}&limit=100&offset=0`);
          if (!live) return;
          const map = masterDecisionMap(reviews.items, reviews.total);
          setDecisions(map);
          setDecisionNote(map ? "" : "Решения мастера прочитаны не полностью.");
        } catch {
          if (!live) return;
          setDecisions(null);
          setDecisionNote("Решения мастера прочитать не удалось.");
        }
      } catch (reason) {
        if (!live) return;
        if (stamp !== scope) { setPage(null); setReported(null); setDecisions(null); setVolumeNote(""); setDecisionNote(""); }
        setError(taskError(reason instanceof ApiError ? reason.status : null));
        const cards = await openDelivery(session).then(() => listChecklistCards()).catch(() => []);
        if (live) setLocalTasks(cards.filter((card) => card.projectId === projectId));
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, day, offset, pass, ready]);
  const body = !ready ? <div className="page"><DeskEmpty title="Объект и день не подтверждены" description={notice || "Доска читается только после выбора объекта и рабочего дня."} /></div>
    : openId ? <div className="page"><TaskDetail compact={compact} session={session} projectId={projectId} taskId={openId} names={names} canEdit={canWrite} onEdit={setEditing} onBack={() => { setOpenId(null); setPass((value) => value + 1); }} onChanged={() => setPass((value) => value + 1)} onNoted={(message) => { setSaved(message); setSavedPulse((value) => value + 1); }} /></div>
    : <TaskBoard compact={compact} view={view} onView={setView} canWrite={canWrite} onCreate={() => setCreating(true)} page={stamp === scope ? page : null} loading={loading || stamp !== scope} error={error} offset={offset} names={names} reported={reported} decisions={stamp === scope ? decisions : null} volumeNote={volumeNote} decisionNote={decisionNote} localTasks={localTasks} onOpen={setOpenId} onRetry={() => setPass((value) => value + 1)} onOffset={setOffset} />;
  const savedDraft = (row: ServerTask) => {
    setCreating(false); setEditing(null);
    setSaved(row.workDate === day ? `Сервер записал черновик «${row.title}».` : `Сервер записал черновик на ${row.workDate.split("-").reverse().join(".")}. На доске этого дня его нет.`);
    setSavedPulse((value) => value + 1);
    setPass((value) => value + 1);
  };
  return <div className={compact ? "task-read task-phone" : "kanban-wrap"}>
    {compact ? <motion.div className="worker-stack" key={`${projectId}:${day}`} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>{body}</motion.div> : body}
    <Flash message={saved} pulse={savedPulse} />
    {creating || editing ? <TaskDraftDialog session={session} projectId={projectId} day={day} task={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={savedDraft} /> : null}
  </div>;
}

function TaskBoard({ compact, view, onView, canWrite, onCreate, page, loading, error, offset, names, reported, decisions, volumeNote, decisionNote, localTasks, onOpen, onRetry, onOffset }: { compact: boolean; view: BoardView; onView: (view: BoardView) => void; canWrite: boolean; onCreate: () => void; page: Page | null; loading: boolean; error: string; offset: number; names: Record<string, string>; reported: Record<string, { reportId: string; submittedQuantity: string }[]> | null; decisions: Record<string, string | null> | null; volumeNote: string; decisionNote: string; localTasks: ChecklistCard[]; onOpen: (id: string) => void; onRetry: () => void; onOffset: (offset: number) => void }) {
  const items = page?.items ?? [];
  const head = <div className="tasks-head">
    <div className="documents-title"><h1>Задания</h1><NoteMark label="Как устроена доска"><p>Колонка берётся из статуса сервера. Перетаскивание карточку не переносит. Сообщённый объём сам колонку «Сдано» не включает и приёмкой не считается.</p></NoteMark></div>
    {compact ? null : <div className="rowline">
      {canWrite ? <button className="ghost desk-action" type="button" onClick={onCreate}>Создать задание</button> : null}
      <div className="roles" role="group" aria-label="Вид заданий">
        <button type="button" className={view === "board" ? "is-on" : ""} onClick={() => onView("board")}>Доска</button>
        <button type="button" className={view === "list" ? "is-on" : ""} onClick={() => onView("list")}>Список</button>
      </div>
    </div>}
  </div>;
  if (compact) {
    const groups = columns.map((column) => ({ column, cards: items.filter((task) => boardColumn(shownTaskStatus(task)) === column.id) })).filter((group) => group.cards.length);
    return <>
      {head}
      {loading && !page ? <p className="quiet worker-hold" role="status">Читаем задания…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={onRetry}>Повторить чтение</button></p> : null}
    {error ? <LocalTasks tasks={localTasks} onOpen={onOpen} /> : null}
    {volumeNote ? <p className="quiet">{volumeNote}</p> : null}
    {decisionNote ? <p className="quiet">{decisionNote}</p> : null}
    {page && !error && items.length === 0 ? <p className="quiet">На этот день заданий нет.</p> : null}
      {page && !error ? groups.map(({ column, cards }) => <section className="task-group" key={column.id} aria-label={column.title}>
        <h2>{column.title}</h2>
        {cards.map((task) => {
          const status = shownTaskStatus(task);
          return <article className="job" key={task.id} role="button" tabIndex={0} aria-label={task.title} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task.id); }}>
            <div className="rowline"><h3>{task.title}</h3><DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge></div>
            <div className="quiet">{task.plannedQuantity} {task.unit}</div>
            {reported?.[task.id]?.map((row) => <div className="quiet" key={row.reportId}>{boardVolumeLabel(row.submittedQuantity, task.unit, decisions?.[row.reportId])}</div>)}
          </article>;
        })}
      </section>) : null}
    </>;
  }
  return <>
    {head}
    {loading && !page ? <p className="quiet task-hold" role="status">Читаем задания…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={onRetry}>Повторить чтение</button></p> : null}
    {error ? <LocalTasks tasks={localTasks} onOpen={onOpen} /> : null}
    {volumeNote ? <p className="quiet">{volumeNote}</p> : null}
    {decisionNote ? <p className="quiet">{decisionNote}</p> : null}
    {page && !error && view === "board" ? <div className="kanban">{columns.map((column) => {
      const cards = items.filter((task) => boardColumn(shownTaskStatus(task)) === column.id);
      return <section className="column" key={column.id} aria-label={column.title}>
        <header><h3>{column.title}</h3><span className="count">{cards.length}</span></header>
        <div className="drop">
          {cards.length === 0 ? <p className="empty">{column.empty}</p> : null}
          {cards.map((task) => {
            const status = shownTaskStatus(task);
            const person = names[task.assigneeEmployeeId];
            return <article className="card is-read" key={task.id} role="button" tabIndex={0} aria-label={task.title} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task.id); }}>
              <div className="card-person"><span className="card-avatar" aria-hidden="true">{person ? initials(person) : "—"}</span><span>{person || "исполнитель не прочитан"}</span></div>
              <p className="title">{task.title}</p>
              <div className="meta">{task.plannedQuantity} {task.unit}</div>
              {reported?.[task.id]?.map((row) => <div className="quiet" key={row.reportId}>{boardVolumeLabel(row.submittedQuantity, task.unit, decisions?.[row.reportId])}</div>)}
              <DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge>
            </article>;
          })}
        </div>
      </section>;
    })}</div> : null}
    {page && !error && view === "list" ? <div className="page"><div className="sheet-wrap"><table className="sheet">
      <thead><tr><th>Задание</th><th>Исполнитель</th><th>План</th><th>Колонка</th><th>Статус</th></tr></thead>
      <tbody>{items.map((task) => {
        const status = shownTaskStatus(task);
        const column = columns.find((item) => item.id === boardColumn(status));
        return <tr className="is-link" key={task.id} tabIndex={0} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task.id); }}>
          <td><b>{task.title}</b>{reported?.[task.id]?.map((row) => <div className="quiet" key={row.reportId}>{boardVolumeLabel(row.submittedQuantity, task.unit, decisions?.[row.reportId], true)}</div>)}</td>
          <td>{names[task.assigneeEmployeeId] ?? "исполнитель не прочитан"}</td>
          <td>{task.plannedQuantity} {task.unit}</td>
          <td>{column?.title}</td>
          <td>{taskStatusText(status)}</td>
        </tr>;
      })}</tbody>
    </table></div>{items.length === 0 ? <p className="quiet">На этот день сервер не отдал заданий.</p> : null}</div> : null}
    {page && !error && page.total > 25 ? <div className="qualification-bar"><button className="ghost desk-action" type="button" disabled={loading || offset === 0} onClick={() => onOffset(Math.max(0, offset - 25))}>Назад</button><span className="quiet">{offset + 1}–{offset + page.items.length} из {page.total}</span><button className="ghost desk-action" type="button" disabled={loading || offset + page.items.length >= page.total} onClick={() => onOffset(offset + 25)}>Далее</button></div> : null}
  </>;
}

function LocalTasks({ tasks, onOpen }: { tasks: ChecklistCard[]; onOpen: (id: string) => void }) {
  if (!tasks.length) return null;
  return <div className="kanban">{tasks.map((task) => <article className="card is-read" key={task.taskId} role="button" tabIndex={0} aria-label={task.title} onClick={() => onOpen(task.taskId)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task.taskId); }}>
    <p className="title">{task.title}</p>
    <p className="quiet">Сохранено на устройстве</p>
  </article>)}</div>;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "—";
}

function TaskDetail({ compact, session, projectId, taskId, names, canEdit, onEdit, onBack, onChanged, onNoted }: { compact: boolean; session: Session; projectId: string; taskId: string; names: Record<string, string>; canEdit: boolean; onEdit: (task: ServerTask) => void; onBack: () => void; onChanged: () => void; onNoted: (message: string) => void }) {
  const reduce = useReducedMotion();
  const [task, setTask] = useState<ServerTask | null>(null);
  const [timezone, setTimezone] = useState("");
  const [error, setError] = useState("");
  const [pass, setPass] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [row, clock] = await Promise.all([
          v1<ServerTask>(session, `/projects/${projectId}/tasks/${taskId}`),
          v1<{ timezone: string }>(session, "/overview"),
        ]);
        if (live) { setTask(row); setTimezone(clock.timezone); setError(""); }
      } catch (reason) {
        if (live) { setTask(null); setError(taskError(reason instanceof ApiError ? reason.status : null)); }
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, taskId, pass]);
  const status = task ? shownTaskStatus(task) : "";
  const person = task ? names[task.assigneeEmployeeId] ?? "" : "";
  const place = task ? [task.zoneId ? names[task.zoneId] : "", task.workTypeId ? names[task.workTypeId] : ""].filter(Boolean).join(" · ") : "";
  return <>
    <div className="documents-heading">
      <button className="ghost desk-action" type="button" onClick={onBack}>К списку</button>
    </div>
    {!task && !error ? <p className="quiet task-hold" role="status">Читаем задание…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {error ? <ChecklistRunPanel key={taskId} session={session} projectId={projectId} taskId={taskId} title="" day="" /> : null}
    {task && compact ? <article className="job">
      <div className="rowline"><h2>{task.title}</h2><DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge></div>
      <p className="quiet">{columns.find((item) => item.id === boardColumn(status))?.title} · {names[task.assigneeEmployeeId] ?? "исполнитель не прочитан"}</p>
      <p>{task.plannedQuantity} {task.unit}</p>
      {place ? <p className="quiet">{place}</p> : null}
      <p className="quiet">Смена и объём остаются на вкладке «Смена».</p>
    </article> : null}
    {task && !compact ? <motion.div className="task-sheet" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
      <div className="passport-head">
        <div>
          <h1>{task.title}</h1>
          <div className="task-who">
            <span className="card-avatar task-who-avatar" aria-hidden="true">{person ? initials(person) : "—"}</span>
            <span className="task-who-name">{person || "исполнитель не прочитан"}</span>
            <span className="task-dot" aria-hidden="true">·</span>
            <time className="quiet" dateTime={task.workDate}>{dayText(task.workDate)}</time>
          </div>
        </div>
        <div className="rowline">
          {canEdit && task.workflowKind === "managed02b" && status === "draft" ? <button className="ghost desk-action" type="button" onClick={() => onEdit(task)}>Изменить</button> : null}
          <DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge>
        </div>
      </div>
      <div className="documents-top">
        <section className="panel" aria-label="План">
          <h2>План</h2>
          <p className="task-figure">{task.plannedQuantity} <span>{task.unit}</span></p>
          <dl className="task-facts">
            <Fact label="Зона" value={task.zoneId ? names[task.zoneId] ?? "название зоны этому входу не отдано" : "не указана"} />
            <Fact label="Вид работ" value={task.workTypeId ? names[task.workTypeId] ?? "название вида этому входу не отдано" : "не указан"} />
            <Fact label="Рабочая документация" value={task.rdReference || "не указана"} />
            <Fact label="Интервал" value={interval(task.plannedStart, task.plannedEnd, timezone)} wide />
          </dl>
        </section>
        <div className="person-column">
          {task.workflowKind === "managed02b" ? <>
          <ShiftPanel session={session} projectId={projectId} employeeId={task.assigneeEmployeeId} day={task.workDate} onChanged={() => { setPass((value) => value + 1); onChanged(); }} />
          <VolumeDesk refreshToken={pass} session={session} projectId={projectId} employeeId={task.assigneeEmployeeId} day={task.workDate} tasks={[{ id: task.id, title: task.title, unit: task.unit, status: task.status, workflowKind: task.workflowKind }]} writable={canWriteVolume(session.role)} onDone={(message) => { onNoted(message); setPass((value) => value + 1); onChanged(); }} />
          </> : <section className="panel" aria-label="Исполнение"><h2>Исполнение</h2><p className="quiet">Смена и отчёты для этого задания здесь недоступны.</p></section>}
          <ChecklistRunPanel key={task.id} session={session} projectId={projectId} taskId={task.id} title={task.title} day={task.workDate} />
        </div>
      </div>
      {task.workflowKind === "managed02b" ? <TaskActionPanel session={session} projectId={projectId} task={task} timezone={timezone} onDone={() => { setPass((value) => value + 1); onChanged(); }} /> : null}
      {task.workflowKind === "managed02b" ? <FrontCheckPanel session={session} projectId={projectId} taskId={task.id} taskVersion={task.version} status={status} onRecorded={() => setPass((value) => value + 1)} /> : null}
    </motion.div> : null}
  </>;
}

async function readNames(session: Session, path: string, field: "name" | "fullName") {
  try {
    const items = await v1Items<{ id: string } & Record<string, string | null>>(session, path);
    return Object.fromEntries(items.map((item) => [item.id, item[field] || ""]));
  } catch {
    return {} as Record<string, string>;
  }
}

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? "is-wide" : undefined}><dt>{label}</dt><dd className={value.startsWith("не ") ? "is-empty" : undefined}>{value}</dd></div>;
}

function dayText(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  const date = new Date(year, month - 1, day);
  return `${date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })} ${year}`;
}

function interval(start: string | null, end: string | null, timezone: string) {
  if (!start && !end) return "не указан";
  return `${clock(start, timezone)} — ${clock(end, timezone)}`;
}

function clock(value: string | null, timeZone: string) {
  if (!value) return "не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { timeZone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
