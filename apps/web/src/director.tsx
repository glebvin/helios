import type { Desk, Session } from "./api";
import { WorkBoard } from "./board";
import { Inbox } from "./inbox";
import { Icon, paths } from "./icons";
import { RoleSwitch } from "./roles";
import { amount, dayTasks, laneOf, personName, progress, statusLabel, type Lane } from "./model";

type Section = "overview" | "mine" | "objects" | "people" | "tasks" | "quality" | "documents" | "settings";

const nav: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Обзор", icon: paths.home },
  { id: "mine", label: "Мои дела", icon: paths.check },
  { id: "objects", label: "Объекты", icon: paths.pin },
  { id: "people", label: "Сотрудники", icon: paths.people },
  { id: "tasks", label: "Задания", icon: paths.list },
  { id: "quality", label: "Качество", icon: paths.shield },
  { id: "documents", label: "Документы", icon: paths.file },
  { id: "settings", label: "Настройки", icon: paths.gear },
];

export function DirectorDesk({
  session,
  data,
  section,
  onSection,
  theme,
  onTheme,
  onLogout,
  onAccept,
  onRole,
  onStart,
  onSubmit,
  onCreate,
}: {
  session: Session;
  data: Desk;
  section: Section;
  onSection: (section: Section) => void;
  theme: "light" | "dark";
  onTheme: () => void;
  onLogout: () => void;
  onAccept: (reportId: string) => void;
  onRole: (role: "director" | "master" | "worker") => void;
  onStart: (taskId: string, employeeId: string) => void;
  onSubmit: (taskId: string, quantity: string) => void;
  onCreate: (title: string, employeeId: string) => Promise<void>;
}) {
  const tasks = dayTasks(data);
  const project = data.projects[0]?.name ?? "Объект";
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  const waiting = data.reports.filter((report) => tasks.some((task) => task.id === report.task_id) && !report.accepted_quantity);
  const onShift = new Set(data.shifts.filter((shift) => shift.status === "open").map((shift) => shift.employee_id).filter(Boolean));
  const accepted = tasks.filter((task) => laneOf(task.id, data) === "accepted").length;
  const attention = tasks.flatMap((task) => {
    const lane = laneOf(task.id, data);
    const report = data.reports.find((item) => item.task_id === task.id);
    if (lane === "submitted" && report) {
      return [{ title: "Ждёт приёмки", who: personName(data, task.assignee_employee_id), taskId: task.id, reportId: report.id }];
    }
    if (lane === "shift") {
      return [{ title: "Смена без сданного объёма", who: personName(data, task.assignee_employee_id), taskId: task.id, reportId: "" }];
    }
    return [];
  });

  return (
    <div className="desk">
      <aside className="side">
        <div className="wordmark">
          <span className="bars" aria-hidden><i /><i /><i /></span>
          <div>
            <strong>HELIOS</strong>
            <small>WORKFORCE</small>
          </div>
        </div>
        <nav>
          {nav.map((item) => (
            <button className={section === item.id ? "nav-item is-on" : "nav-item"} type="button" key={item.id} onClick={() => onSection(item.id)}>
              <Icon d={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">{session.name}</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="quiet">Объект</span>
          <select className="object-select" value={project} aria-label="Объект">
            <option>{project}</option>
          </select>
          <span className="grow" />
          <RoleSwitch role={session.role} onRole={onRole} />
          <button className="ghost" type="button" onClick={onTheme}>{theme === "dark" ? "Светлая" : "Тёмная"}</button>
          <div className="avatar" title={session.name}>{initials(session.name)}</div>
        </header>
        {section === "overview" ? (
          <Overview project={project} date={date} tasks={tasks} data={data} waiting={waiting.length} onShift={onShift.size} files={data.files.length} accepted={accepted} attention={attention} onOpen={() => onSection("mine")} />
        ) : null}
        {section === "mine" ? <Inbox data={data} onAccept={onAccept} onOpenBoard={() => onSection("tasks")} /> : null}
        {section === "objects" ? <Objects data={data} /> : null}
        {section === "people" ? <People data={data} /> : null}
        {section === "tasks" ? (
          <WorkBoard
            data={data}
            tasks={tasks}
            canAccept={session.role !== "worker"}
            onStart={onStart}
            onSubmit={onSubmit}
            onAccept={onAccept}
            onCreate={onCreate}
          />
        ) : null}
        {section === "quality" ? <Empty title="Качество" text="Чек-листы, замечания и передача в ПТО откроются на карточке работы. В этом кабинете таких записей ещё нет." /> : null}
        {section === "documents" ? <Documents data={data} /> : null}
        {section === "settings" ? (
          <section className="page">
            <h1>Настройки</h1>
            <p className="sub">Тема и выход. Цвет марки доведём отдельно, сейчас кабинет чёрно-белый.</p>
            <div className="rowline">
              <button className="ghost" type="button" onClick={onTheme}>{theme === "dark" ? "Включить светлую" : "Включить тёмную"}</button>
              <button className="fill" type="button" onClick={onLogout}>Выйти</button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Overview({
  project, date, tasks, data, waiting, onShift, files, accepted, attention, onOpen,
}: {
  project: string;
  date: string;
  tasks: Desk["tasks"];
  data: Desk;
  waiting: number;
  onShift: number;
  files: number;
  accepted: number;
  attention: { title: string; who: string; taskId: string; reportId: string }[];
  onOpen: () => void;
}) {
  const ratio = tasks.length ? Math.round((accepted / tasks.length) * 100) : 0;
  return (
    <section className="page">
      <div>
        <h1>Объект сегодня</h1>
        <p className="sub">{project} · {date}</p>
      </div>
      <div className="metrics">
        <article className="metric"><span className="ico"><Icon d={paths.people} /></span><div><b>{onShift}</b><span>на смене из {data.employees.length}</span></div></article>
        <article className="metric"><span className="ico"><Icon d={paths.check} /></span><div><b>{waiting}</b><span>ждут приёмки</span></div></article>
        <article className="metric"><span className="ico"><Icon d={paths.alert} /></span><div><b>{attention.length}</b><span>требуют внимания</span></div></article>
        <article className="metric"><span className="ico"><Icon d={paths.file} /></span><div><b>{files}</b><span>файлов объекта</span></div></article>
      </div>
      <div className="split">
        <section className="panel">
          <h2>Ход работ</h2>
          <div className="work-head"><span>Работа</span><span>Объём</span><span>Статус</span><span>Ответственный</span></div>
          {tasks.length === 0 ? <p className="quiet" style={{ padding: 12 }}>На сегодня заданий нет.</p> : null}
          {tasks.map((task) => {
            const lane = laneOf(task.id, data);
            const report = data.reports.find((item) => item.task_id === task.id);
            return (
              <div className="work-line" key={task.id}>
                <b>{task.title}</b>
                <span>{amount(task.planned_quantity)} {task.unit}</span>
                <span className="chip"><i />{statusLabel(lane)}</span>
                <span>{shortName(personName(data, task.assignee_employee_id))}</span>
                <div className="track"><span style={{ width: `${progress(task, report)}%` }} /></div>
              </div>
            );
          })}
        </section>
        <section className="panel">
          <h2>Требует внимания</h2>
          <div className="attention">
            {attention.length === 0 ? <p className="quiet" style={{ padding: 12 }}>Сейчас пусто.</p> : null}
            {attention.map((item) => (
              <button type="button" key={item.taskId + item.title} onClick={onOpen}>
                <span className="ico"><Icon d={item.reportId ? paths.check : paths.alert} /></span>
                <span><b>{item.title}</b><small>Ответственный: {item.who}</small></span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="daybar">
        <div>
          <b>Итоги дня</b>
          <div className="quiet">{accepted} из {tasks.length} заданий приняты</div>
        </div>
        <div className="track"><span style={{ width: `${ratio}%` }} /></div>
        <button className="fill" type="button" onClick={onOpen}>Открыть дела</button>
      </div>
    </section>
  );
}

function Objects({ data }: { data: Desk }) {
  return (
    <section className="page">
      <h1>Объекты</h1>
      {data.projects.map((project) => (
        <article className="task-row" key={project.id} style={{ padding: 16 }}>
          <b>{project.name}</b>
          <div className="quiet">{data.cabinet.name} · {data.organizations.map((item) => item.name).join(", ")}</div>
        </article>
      ))}
    </section>
  );
}

function People({ data }: { data: Desk }) {
  return (
    <section className="page">
      <h1>Сотрудники</h1>
      {data.employees.map((person) => (
        <article className="person" key={person.id} style={{ padding: 14, display: "flex", justifyContent: "space-between" }}>
          <b>{person.full_name}</b>
          <span className="quiet">{person.phone}</span>
        </article>
      ))}
    </section>
  );
}

function Documents({ data }: { data: Desk }) {
  return (
    <section className="page">
      <h1>Документы</h1>
      {data.files.length === 0 ? <p className="quiet">Файлов в этом кабинете нет.</p> : null}
      {data.files.map((file) => <article className="person" key={file.id} style={{ padding: 14 }}><b>{file.filename}</b></article>)}
    </section>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return <section className="page"><h1>{title}</h1><p className="sub">{text}</p></section>;
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase();
}

function shortName(name: string) {
  const [first, last] = name.split(" ").filter(Boolean);
  if (!last) return name;
  return `${first.slice(0, 1)}. ${last}`;
}

export type { Section, Lane };
