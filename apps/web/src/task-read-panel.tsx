import { useEffect, useState } from "react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskBadge, DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";
import { FrontCheckPanel } from "./front-check-panel";
import { TaskDraftDialog } from "./task-draft-form";
import { canWriteTaskDraft } from "./task-draft";
import { ApiError, v1 } from "./v1";
import { boardColumn, shownTaskStatus, taskArea, taskError, taskListPath, taskStatusText, type BoardColumn, type ServerTask } from "./task-read";

type Page = { items: ServerTask[]; total: number; limit: number; offset: number };
type BoardView = "board" | "list";
const columns: { id: BoardColumn; title: string; empty: string }[] = [
  { id: "assigned", title: "Назначено", empty: "Черновики и опубликованные задания этого дня." },
  { id: "shift", title: "На смене", empty: "Сервер ещё не отметил смену." },
  { id: "submitted", title: "Сдано", empty: "Сданного объёма на этот день нет." },
  { id: "accepted", title: "Принято", empty: "Принятой работы на этот день нет." },
];

export function TaskRead({ session, projectId, day, notice = "", compact = false, openTaskId = "", openToken = 0 }: { session: Session; projectId: string; day: string; notice?: string; compact?: boolean; openTaskId?: string; openToken?: number }) {
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<BoardView>("board");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ServerTask | null>(null);
  const [saved, setSaved] = useState("");
  const [savedPulse, setSavedPulse] = useState(0);
  const canWrite = canWriteTaskDraft(session.role);
  const ready = Boolean(projectId && day && !notice);
  useEffect(() => { setOffset(0); setOpenId(openTaskId || null); }, [projectId, day, openTaskId, openToken]);
  useEffect(() => {
    if (!ready) { setLoading(false); setPage(null); return; }
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const rows = await v1<Page>(session, taskListPath(projectId, day, offset));
        if (!live) return;
        setPage(rows); setError("");
        if (offset && offset >= rows.total) setOffset(Math.max(0, Math.floor((rows.total - 1) / 25) * 25));
        const [people, zones, types] = await Promise.all([
          readNames(session, `/employees?projectId=${projectId}&limit=100`, "fullName"),
          readNames(session, `/projects/${projectId}/zones?limit=100`, "name"),
          readNames(session, `/projects/${projectId}/work-types?limit=100`, "name"),
        ]);
        if (!live) return;
        setNames({ ...people, ...zones, ...types });
      } catch (reason) {
        if (!live) return;
        setPage(null); setError(taskError(reason instanceof ApiError ? reason.status : null));
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, day, offset, pass, ready]);
  const body = !ready ? <div className="page"><DeskEmpty title="Объект и день не подтверждены" description={notice || "Доска читается только после выбора объекта и рабочего дня."} /></div>
    : openId ? <div className="page"><TaskDetail session={session} projectId={projectId} taskId={openId} names={names} canEdit={canWrite} onEdit={setEditing} onBack={() => setOpenId(null)} /></div>
    : <TaskBoard view={view} onView={setView} canWrite={canWrite} onCreate={() => setCreating(true)} page={page} loading={loading} error={error} offset={offset} names={names} onOpen={setOpenId} onRetry={() => setPass((value) => value + 1)} onOffset={setOffset} />;
  const savedDraft = (row: ServerTask) => {
    setCreating(false); setEditing(null);
    setSaved(row.workDate === day ? `Сервер записал черновик «${row.title}».` : `Сервер записал черновик на ${row.workDate.split("-").reverse().join(".")}. На доске этого дня его нет.`);
    setSavedPulse((value) => value + 1);
    setPass((value) => value + 1);
  };
  return <div className={compact ? "task-read" : "kanban-wrap"}>
    {body}
    <Flash message={saved} pulse={savedPulse} />
    {creating || editing ? <TaskDraftDialog session={session} projectId={projectId} day={day} task={editing} onClose={() => { setCreating(false); setEditing(null); }} onSaved={savedDraft} /> : null}
  </div>;
}

function TaskBoard({ view, onView, canWrite, onCreate, page, loading, error, offset, names, onOpen, onRetry, onOffset }: { view: BoardView; onView: (view: BoardView) => void; canWrite: boolean; onCreate: () => void; page: Page | null; loading: boolean; error: string; offset: number; names: Record<string, string>; onOpen: (id: string) => void; onRetry: () => void; onOffset: (offset: number) => void }) {
  const items = page?.items ?? [];
  return <>
    <div className="tasks-head">
      <div className="documents-title"><h1>Задания</h1><NoteMark label="Как устроена доска"><p>Колонка берётся из статуса сервера. Перетаскивание карточку не переносит. Смена, сдача объёма и приёмка появятся на этих же карточках, когда их подтвердит сервер.</p></NoteMark></div>
      <div className="rowline">
        {canWrite ? <button className="ghost desk-action" type="button" onClick={onCreate}>Создать задание</button> : null}
        <div className="roles" role="group" aria-label="Вид заданий">
          <button type="button" className={view === "board" ? "is-on" : ""} onClick={() => onView("board")}>Доска</button>
          <button type="button" className={view === "list" ? "is-on" : ""} onClick={() => onView("list")}>Список</button>
        </div>
      </div>
    </div>
    {loading && !page ? <p className="quiet task-hold" role="status">Читаем задания…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={onRetry}>Повторить чтение</button></p> : null}
    {page && !error && view === "board" ? <div className="kanban">{columns.map((column) => {
      const cards = items.filter((task) => boardColumn(shownTaskStatus(task)) === column.id);
      return <section className="column" key={column.id} aria-label={column.title}>
        <header><h3>{column.title}</h3><span className="count">{cards.length}</span></header>
        <div className="drop">
          {cards.length === 0 ? <p className="empty">{column.empty}</p> : null}
          {cards.map((task) => {
            const status = shownTaskStatus(task);
            return <article className="card is-read" key={task.id} role="button" tabIndex={0} aria-label={task.title} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task.id); }}>
              <div className="meta">{names[task.assigneeEmployeeId] ?? "исполнитель не прочитан"} · {task.plannedQuantity} {task.unit}</div>
              <p className="title">{task.title}</p>
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
          <td><b>{task.title}</b></td>
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

function TaskDetail({ session, projectId, taskId, names, canEdit, onEdit, onBack }: { session: Session; projectId: string; taskId: string; names: Record<string, string>; canEdit: boolean; onEdit: (task: ServerTask) => void; onBack: () => void }) {
  const [task, setTask] = useState<ServerTask | null>(null);
  const [error, setError] = useState("");
  const [pass, setPass] = useState(0);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const row = await v1<ServerTask>(session, `/projects/${projectId}/tasks/${taskId}`);
        if (live) { setTask(row); setError(""); }
      } catch (reason) {
        if (live) { setTask(null); setError(taskError(reason instanceof ApiError ? reason.status : null)); }
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, taskId, pass]);
  const status = task ? shownTaskStatus(task) : "";
  const area = task ? taskArea(status) : "plan";
  return <>
    <div className="documents-heading">
      <button className="ghost desk-action" type="button" onClick={onBack}>К списку</button>
    </div>
    {!task && !error ? <p className="quiet task-hold" role="status">Читаем задание…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {task ? <>
      <div className="passport-head">
        <div><h1>{task.title}</h1><p className="sub">{task.workDate.split("-").reverse().join(".")} · {names[task.assigneeEmployeeId] ?? "исполнитель не прочитан"}</p></div>
        <div className="rowline">
          {canEdit && status === "draft" ? <button className="ghost desk-action" type="button" onClick={() => onEdit(task)}>Изменить</button> : null}
          <DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge>
        </div>
      </div>
      <div className="documents-top">
        <section className="panel" aria-label="План">
          <h2>План</h2>
          <dl className="profile-facts">
            <div><dt>Статус</dt><dd>{taskStatusText(status)}</dd></div>
            <div><dt>Объём</dt><dd>{task.plannedQuantity} {task.unit}</dd></div>
            <div><dt>Зона</dt><dd>{task.zoneId ? names[task.zoneId] ?? "название зоны этому входу не отдано" : "не указана"}</dd></div>
            <div><dt>Вид работ</dt><dd>{task.workTypeId ? names[task.workTypeId] ?? "название вида этому входу не отдано" : "не указан"}</dd></div>
            <div><dt>Рабочая документация</dt><dd>{task.rdReference || "не указана"}</dd></div>
            <div><dt>Интервал</dt><dd>{interval(task.plannedStart, task.plannedEnd)}</dd></div>
          </dl>
        </section>
        <div className="person-column">
          <section className="panel" aria-label="Смена">
            <h2>Смена</h2>
            <p className="quiet">{area === "shift" ? `Сервер отметил: ${taskStatusText(status)}. Начать или закончить смену с этой карточки нельзя.` : "В ответе задания нет открытой смены. Её начало и конец не выводятся из плана."}</p>
          </section>
          <section className="panel" aria-label="Качество">
            <h2>Качество</h2>
            <p className="quiet">{area === "quality" ? `Сервер отметил: ${taskStatusText(status)}. Приёмка с этой карточки не записывается.` : "Приёмка с этой карточки не записывается. Сервер не отметил качество отдельным статусом."}</p>
          </section>
        </div>
      </div>
      <FrontCheckPanel session={session} projectId={projectId} taskId={task.id} taskVersion={task.version} status={status} onRecorded={() => setPass((value) => value + 1)} />
    </> : null}
  </>;
}

async function readNames(session: Session, path: string, field: "name" | "fullName") {
  try {
    const page = await v1<{ items: ({ id: string } & Record<string, string | null>)[] }>(session, path);
    return Object.fromEntries(page.items.map((item) => [item.id, item[field] || ""]));
  } catch {
    return {} as Record<string, string>;
  }
}

function interval(start: string | null, end: string | null) {
  if (!start && !end) return "не указан";
  return `${clock(start)} — ${clock(end)}`;
}

function clock(value: string | null) {
  if (!value) return "не указано";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
