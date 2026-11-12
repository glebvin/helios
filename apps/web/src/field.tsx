import { useState } from "react";
import type { Desk, Session } from "./api";
import { Icon, paths } from "./icons";
import { Mark } from "./mark";
import { readCheck, writeCheck, type Check } from "./book";
import { ScopeBar, useCabinetScope } from "./scope-read";
import { WorkerDayPanel } from "./worker-day-panel";
import { RoleSwitch, type View } from "./roles";
import { amount, dayTasks, laneOf, personName, progress, statusLabel } from "./model";
import { TaskRead } from "./task-read-panel";

type WorkerTab = "shift" | "task" | "profile";
type MasterTab = "today" | "crew" | "accept" | "more";

export function WorkerPhone({
  session, data: sourceData, theme, onTheme, onLogout, view, demo = false, preview = false, onRole, onDemoAccount,
  onExpire,
}: {
  session: Session;
  data: Desk;
  pending: number;
  theme: "light" | "dark";
  onTheme: () => void;
  onLogout: () => void;
  view: View;
  demo?: boolean;
  preview?: boolean;
  onRole: (view: View) => void;
  onDemoAccount?: (email: string, password: string) => void;
  onStart: (taskId: string, employeeId: string) => void;
  onEnd: (taskId: string) => void;
  onSubmit: (taskId: string, quantity: string) => void;
  onExpire: () => void;
}) {
  const [tab, setTab] = useState<WorkerTab>("shift");
  const scope = useCabinetScope(session, onExpire, sourceData.projects);
  const project = scope.projectName;
  const place = scope.notice || (project && scope.dayLabel ? `${project} · ${scope.dayLabel}` : "Объект и день не подтверждены.");

  return (
    <div className="phone">
      <div className="phone-body">
        {demo ? <RoleSwitch view={view} onView={onRole} /> : null}
        {demo && onDemoAccount ? (
          <div className="roles" role="group" aria-label="Учебный вход">
            <span className="roles-label">Учебный вход</span>
            <button type="button" onClick={() => onDemoAccount("director@pilot.helios", "pilot-director")}>Анна</button>
            <button type="button" onClick={() => onDemoAccount("master@pilot.helios", "pilot-master")}>Павел</button>
            <button type="button" onClick={() => onDemoAccount("worker@pilot.helios", "pilot-worker")}>Иван</button>
          </div>
        ) : null}
        {preview ? <p className="quiet">Просмотр кабинета. Смена и объём от этого вида не записываются: вход остаётся {session.name}.</p> : null}
        <Mark compact />
        <ScopeBar scope={scope} />
        {tab === "shift" ? <WorkerDayPanel session={session} projectId={scope.projectId} day={scope.day} notice={scope.notice} onExpire={onExpire} /> : null}
        {tab === "task" ? <TaskRead compact session={session} projectId={scope.projectId} day={scope.day} notice={scope.notice} /> : null}
        {tab === "profile" ? (
          <>
            <h1>Профиль</h1>
            <article className="job"><b>{scope.actor?.name ?? session.name}</b><div className="quiet">Рабочий · {place}</div></article>
            <button className="ghost" type="button" onClick={onTheme}>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
            <button className="fill" type="button" onClick={onLogout}>Выйти</button>
          </>
        ) : null}
      </div>
      <nav className="tabs three">
        <button className={tab === "shift" ? "is-on" : ""} type="button" onClick={() => setTab("shift")}><Icon d={paths.play} /><span>Смена</span></button>
        <button className={tab === "task" ? "is-on" : ""} type="button" onClick={() => setTab("task")}><Icon d={paths.list} /><span>Задание</span></button>
        <button className={tab === "profile" ? "is-on" : ""} type="button" onClick={() => setTab("profile")}><Icon d={paths.user} /><span>Профиль</span></button>
      </nav>
    </div>
  );
}

export function ForemanPhone({
  session, data, theme, onTheme, onLogout, view, onRole, onCreate, onSubmit, onAccept,
}: {
  session: Session;
  data: Desk;
  theme: "light" | "dark";
  onTheme: () => void;
  onLogout: () => void;
  view: View;
  onRole: (view: View) => void;
  onCreate: (title: string, employeeId: string) => Promise<void>;
  onSubmit: (taskId: string, quantity: string) => void;
  onAccept: (reportId: string, acceptedQuantity: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<MasterTab>("today");
  const [filter, setFilter] = useState<"all" | "work" | "ready">("all");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [title, setTitle] = useState("Облицовка стен, зона 3-01");
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? "");
  const [creating, setCreating] = useState(false);
  const tasks = dayTasks(data);
  const project = data.projects[0]?.name ?? "Объект";
  const onShift = new Set(data.shifts.filter((shift) => shift.status === "open").map((shift) => shift.employee_id)).size;
  const shown = tasks.filter((task) => {
    const lane = laneOf(task.id, data);
    if (filter === "work") return lane === "assigned" || lane === "shift";
    if (filter === "ready") return lane === "submitted" || lane === "accepted";
    return true;
  });
  const review = tasks.find((task) => task.id === reviewId);

  if (review) {
    return (
      <Review
        session={session}
        data={data}
        task={review}
        onBack={() => setReviewId(null)}
        view={view}
        onRole={onRole}
        onSubmit={onSubmit}
        onAccept={onAccept}
      />
    );
  }

  return (
    <div className="phone">
      <div className="phone-body">
        {tab === "today" ? (
          <>
            <RoleSwitch view={view} onView={onRole} />
            <div className="rowline"><strong>GELIOS</strong><span className="quiet">{session.name.split(" ")[0]}</span></div>
            <h1>Сегодня</h1>
            <div className="quiet">{project}</div>
            <article className="job-card">
              <b>Бригада</b>
              <div className="quiet">{data.employees.length} человек · {onShift} на смене</div>
            </article>
            <div className="roles">
              <button className={filter === "all" ? "is-on" : ""} type="button" onClick={() => setFilter("all")}>Все</button>
              <button className={filter === "work" ? "is-on" : ""} type="button" onClick={() => setFilter("work")}>В работе</button>
              <button className={filter === "ready" ? "is-on" : ""} type="button" onClick={() => setFilter("ready")}>К сдаче</button>
            </div>
            {shown.map((task) => {
              const lane = laneOf(task.id, data);
              const report = data.reports.find((item) => item.task_id === task.id);
              return (
                <article className="job-card" key={task.id}>
                  <div className="rowline"><b>{task.title}</b><span className="status">{statusLabel(lane)}</span></div>
                  <div className="quiet">{personName(data, task.assignee_employee_id)}</div>
                  <div className="rowline"><b>{report ? amount(report.submitted_quantity) : "0"} из {amount(task.planned_quantity)} {task.unit}</b></div>
                  <div className="track"><span style={{ width: `${progress(task, report)}%` }} /></div>
                  <button className="ghost" type="button" onClick={() => setReviewId(task.id)}>{lane === "submitted" ? "Проверить" : "Открыть"}</button>
                </article>
              );
            })}
            {creating ? (
              <form className="job" onSubmit={async (event) => { event.preventDefault(); await onCreate(title, employeeId); setCreating(false); }}>
                <label className="field"><span>Задание</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label className="field"><span>Исполнитель</span>
                  <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                    {data.employees.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
                  </select>
                </label>
                <button className="fill" type="submit">Поставить</button>
              </form>
            ) : (
              <button className="fill wide" type="button" onClick={() => setCreating(true)}>+ Создать задание</button>
            )}
          </>
        ) : null}
        {tab === "crew" ? (
          <>
            <h1>Бригада</h1>
            {data.employees.map((person) => {
              const active = data.shifts.some((shift) => shift.employee_id === person.id && shift.status === "open");
              return <article className="job-card" key={person.id}><b>{person.full_name}</b><div className="quiet">{active ? "На смене" : "Не отмечен"} · {person.phone}</div></article>;
            })}
          </>
        ) : null}
        {tab === "accept" ? (
          <>
            <h1>Приёмка</h1>
            {tasks.filter((task) => laneOf(task.id, data) === "submitted").map((task) => (
              <button className="job-card" type="button" key={task.id} onClick={() => setReviewId(task.id)}>
                <b>{task.title}</b>
                <div className="quiet">К проверке</div>
              </button>
            ))}
          </>
        ) : null}
        {tab === "more" ? (
          <>
            <h1>Ещё</h1>
            <article className="job"><b>{project}</b><div className="quiet">{data.cabinet.name}</div></article>
            <button className="ghost" type="button" onClick={onTheme}>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
            <button className="fill" type="button" onClick={onLogout}>Выйти</button>
          </>
        ) : null}
      </div>
      <nav className="tabs">
        <button className={tab === "today" ? "is-on" : ""} type="button" onClick={() => setTab("today")}><Icon d={paths.home} /><span>Сегодня</span></button>
        <button className={tab === "crew" ? "is-on" : ""} type="button" onClick={() => setTab("crew")}><Icon d={paths.people} /><span>Бригада</span></button>
        <button className={tab === "accept" ? "is-on" : ""} type="button" onClick={() => setTab("accept")}><Icon d={paths.check} /><span>Приёмка</span></button>
        <button className={tab === "more" ? "is-on" : ""} type="button" onClick={() => setTab("more")}><Icon d={paths.list} /><span>Ещё</span></button>
      </nav>
    </div>
  );
}

function Review({
  session, data, task, onBack, view, onRole, onSubmit, onAccept,
}: {
  session: Session;
  data: Desk;
  task: Desk["tasks"][number];
  onBack: () => void;
  view: View;
  onRole: (view: View) => void;
  onSubmit: (taskId: string, quantity: string) => void;
  onAccept: (reportId: string, acceptedQuantity: string) => Promise<void>;
}) {
  const [check, setCheck] = useState(() => readCheck(session.tenantId, session.userId, task.id));
  const [quantity, setQuantity] = useState("");
  const report = data.reports.find((item) => item.task_id === task.id);
  const [taken, setTaken] = useState(report ? amount(report.submitted_quantity) : "");
  const ready = check.flat && check.seam && check.photo;

  function save(next: Check) {
    setCheck(next);
    writeCheck(session.tenantId, session.userId, task.id, next);
  }

  return (
    <div className="phone">
      <div className="phone-body">
        <RoleSwitch view={view} onView={onRole} />
        <button className="back" type="button" onClick={onBack}>← Проверка работы</button>
        <div className="rowline"><h1 style={{ fontSize: 28 }}>{task.title}</h1><b>{amount(task.planned_quantity)} {task.unit}</b></div>
        <div className="quiet">{personName(data, task.assignee_employee_id)}</div>
        {!report ? (
          <form className="job" onSubmit={(event) => { event.preventDefault(); onSubmit(task.id, quantity); }}>
            <label className="field"><span>Сдать объём, {task.unit}</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
            <button className="fill" type="submit">Сдать работу</button>
          </form>
        ) : (
          <>
            <p className="quiet">Сдано {amount(report.submitted_quantity)} {task.unit}{report.accepted_quantity ? ` · принято ${amount(report.accepted_quantity)}` : ""}</p>
            {report.accepted_quantity ? null : <label className="field"><span>Принять, {task.unit}</span><input value={taken} inputMode="decimal" onChange={(event) => setTaken(event.target.value)} /></label>}
          </>
        )}
        <h2>Самоконтроль</h2>
        <label className="check"><input type="checkbox" checked={check.flat} onChange={(event) => save({ ...check, flat: event.target.checked })} /> Ровность поверхности</label>
        <label className="check"><input type="checkbox" checked={check.seam} onChange={(event) => save({ ...check, seam: event.target.checked })} /> Толщина шва</label>
        <label className="check"><input type="checkbox" checked={check.photo} onChange={(event) => save({ ...check, photo: event.target.checked })} /> Фото результата</label>
        <div className="quiet">{ready ? "Готово к передаче" : "Отметьте три пункта. Сейчас они хранятся на этом телефоне."}</div>
        <button
          className="fill wide"
          type="button"
          disabled={!ready || !report || Boolean(report.accepted_quantity)}
          onClick={async () => {
            if (!report) return;
            const value = taken.trim().replace(",", ".");
            if (!value || Number(value) < 0 || Number(value) > Number(report.submitted_quantity)) return;
            await onAccept(report.id, value);
            save({ ...check, sent: true });
          }}
        >
          {report?.accepted_quantity ? "Передано" : "Передать на проверку"}
        </button>
      </div>
    </div>
  );
}
