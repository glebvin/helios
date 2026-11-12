import { useEffect, useState } from "react";
import type { Session } from "./api";
import { DeskBadge, DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { shownTaskStatus, taskArea, taskError, taskListPath, taskStatusText, type ServerTask, type TaskArea } from "./task-read";

type Page = { items: ServerTask[]; total: number; limit: number; offset: number };
const areas: { id: TaskArea; title: string; empty: string }[] = [
  { id: "plan", title: "План", empty: "На этот день плана нет." },
  { id: "shift", title: "Смена", empty: "Сервер не отметил смену. Начало и конец сюда не переносятся." },
  { id: "quality", title: "Качество", empty: "Приёмки на этот день сервер не отдал." },
];

export function TaskRead({ session, projectId, day, notice = "", compact = false, openTaskId = "", openToken = 0 }: { session: Session; projectId: string; day: string; notice?: string; compact?: boolean; openTaskId?: string; openToken?: number }) {
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
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
  const body = !ready ? <DeskEmpty title="Объект и день не подтверждены" description={notice || "Список читается только после выбора объекта и рабочего дня."} />
    : openId ? <TaskDetail session={session} projectId={projectId} taskId={openId} names={names} onBack={() => setOpenId(null)} />
    : <TaskList page={page} loading={loading} error={error} offset={offset} names={names} onOpen={setOpenId} onRetry={() => setPass((value) => value + 1)} onOffset={setOffset} />;
  return compact ? <div className="task-read">{body}</div> : <section className="page">{body}</section>;
}

function TaskList({ page, loading, error, offset, names, onOpen, onRetry, onOffset }: { page: Page | null; loading: boolean; error: string; offset: number; names: Record<string, string>; onOpen: (id: string) => void; onRetry: () => void; onOffset: (offset: number) => void }) {
  return <>
    <div className="documents-heading">
      <div className="documents-title">
        <h1>Задания</h1>
        <NoteMark label="Как читаются задания"><p>Статус берётся из ответа сервера. Перетаскивание ничего не меняет. Смена и приёмка с этого списка не записываются.</p></NoteMark>
      </div>
    </div>
    {loading && !page ? <p className="quiet task-hold" role="status">Читаем задания…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={onRetry}>Повторить чтение</button></p> : null}
    {page && !error ? areas.map((area) => {
      const items = page.items.filter((task) => taskArea(shownTaskStatus(task)) === area.id);
      return <section className="panel" key={area.id} aria-label={area.title}>
        <h2>{area.title}</h2>
        {items.length === 0 ? <p className="quiet">{area.empty}</p> : <div className="qualification-list">{items.map((task) => <TaskRow key={task.id} task={task} names={names} onOpen={() => onOpen(task.id)} />)}</div>}
      </section>;
    }) : null}
    {page && !error && page.items.some((task) => taskArea(task.status) === "other") ? <section className="panel" aria-label="Другой статус"><h2>Другой статус</h2><div className="qualification-list">{page.items.filter((task) => taskArea(task.status) === "other").map((task) => <TaskRow key={task.id} task={task} names={names} onOpen={() => onOpen(task.id)} />)}</div></section> : null}
    {page && !error && page.total > 25 ? <div className="qualification-bar"><button className="ghost desk-action" type="button" disabled={loading || offset === 0} onClick={() => onOffset(Math.max(0, offset - 25))}>Назад</button><span className="quiet">{offset + 1}–{offset + page.items.length} из {page.total}</span><button className="ghost desk-action" type="button" disabled={loading || offset + page.items.length >= page.total} onClick={() => onOffset(offset + 25)}>Далее</button></div> : null}
  </>;
}

function TaskRow({ task, names, onOpen }: { task: ServerTask; names: Record<string, string>; onOpen: () => void }) {
  const status = shownTaskStatus(task);
  return <article className="qualification-row">
    <div>
      <b>{task.title}</b>
      <span className="quiet catalog-meta"><span>{names[task.assigneeEmployeeId] ?? "исполнитель не прочитан"}</span><span>{task.plannedQuantity} {task.unit}</span></span>
    </div>
    <DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge>
    <button className="ghost desk-action" type="button" onClick={onOpen}>Открыть</button>
  </article>;
}

function TaskDetail({ session, projectId, taskId, names, onBack }: { session: Session; projectId: string; taskId: string; names: Record<string, string>; onBack: () => void }) {
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
        <DeskBadge tone={status === "published" ? "accent" : status === "cancelled" || status === "needs_fix" ? "warn" : "neutral"}>{taskStatusText(status)}</DeskBadge>
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
