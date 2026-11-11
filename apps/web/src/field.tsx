import { useEffect, useState } from "react";
import type { Desk, Session } from "./api";
import { Icon, paths } from "./icons";
import { Mark } from "./mark";
import { minutesLabel, readCheck, useBook, writeCheck, type Check } from "./book";
import { DayFlow } from "./dayflow";
import { RoleSwitch, type View } from "./roles";
import { amount, clock, dayTasks, elapsed, laneOf, personName, progress, statusLabel, todayKey } from "./model";

type WorkerTab = "shift" | "task" | "profile";
type MasterTab = "today" | "crew" | "accept" | "more";

export function WorkerPhone({
  session, data, pending, theme, onTheme, onLogout, view, demo = false, preview = false, onRole, onDemoAccount, onStart, onEnd, onSubmit,
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
}) {
  const [tab, setTab] = useState<WorkerTab>("shift");
  const [now, setNow] = useState(Date.now());
  const [breakOn, setBreakOn] = useState(false);
  const [problem, setProblem] = useState("");
  const [problemOpen, setProblemOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [stopOpen, setStopOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const { book, update } = useBook();
  const tasks = dayTasks(data);
  const current = tasks.find((task) => laneOf(task.id, data) === "shift") ?? tasks.find((task) => laneOf(task.id, data) === "assigned") ?? tasks[0];
  const shift = current ? data.shifts.find((item) => item.task_id === current.id && item.status === "open") : undefined;
  const report = current ? data.reports.find((item) => item.task_id === current.id) : undefined;
  const project = data.projects[0]?.name ?? "Объект";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

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
        {tab === "shift" && !preview ? <DayFlow session={session} /> : null}
        {tab === "shift" && current ? (
          <>
            <h1>Моя смена</h1>
            <div className="kicker"><Icon d={paths.pin} size={16} /> {project}</div>
            <div className="shift-card">
              <div className="kicker">{shift ? "Смена идёт" : "Смена не начата"}</div>
              <div style={{ textAlign: "right" }}>
                <b>{shift ? elapsed(shift.started_at, now) || "только что" : "—"}</b>
                <div className="quiet">{shift?.started_at ? `Начало в ${clock(shift.started_at)}` : "Начните, когда вышли на работу"}</div>
              </div>
            </div>
            <article className="job">
              <div className="label">Моё задание</div>
              <h2 style={{ fontSize: 26, letterSpacing: "-0.04em" }}>{current.title}</h2>
              <div className="quiet">{personName(data, current.assignee_employee_id)}</div>
              <div className="track"><span style={{ width: `${progress(current, report)}%` }} /></div>
              <div className="rowline quiet"><span /><span>{report ? amount(report.submitted_quantity) : "0"} из {amount(current.planned_quantity)} {current.unit}</span></div>
            </article>
            <div className="pair">
              <button className="ghost" type="button" onClick={() => setBreakOn((value) => !value)}>{breakOn ? "Перерыв идёт" : "Перерыв"}</button>
              <button className="ghost" type="button" onClick={() => setProblemOpen(true)}>Сообщить о проблеме</button>
            </div>
            {preview ? null : <button className="ghost wide" type="button" onClick={() => setStopOpen(true)}>Записать простой на телефоне</button>}
            {current ? book.downtime.filter((item) => item.taskId === current.id).map((item) => (
              <p className="quiet" key={item.id}>Простой {minutesLabel(item.minutes)} · {item.cause}</p>
            )) : null}
            {pending ? <div className="alert-note"><Icon d={paths.alert} /><div><b>Старая очередь</b><div>Эти отметки не относятся к рабочему дню на сервере.</div></div></div> : null}
            {problem ? <p className="quiet">Проблема на телефоне: {problem}</p> : null}
          </>
        ) : null}
        {tab === "shift" && !current ? <><h1>Моя смена</h1><p className="quiet">На сегодня заданий нет. Их ставит прораб.</p></> : null}
        {tab === "task" ? (
          <>
            <h1>Задание</h1>
            {tasks.map((task) => {
              const itemReport = data.reports.find((item) => item.task_id === task.id);
              return (
                <article className="job-card" key={task.id}>
                  <b>{task.title}</b>
                  <div className="quiet">{statusLabel(laneOf(task.id, data))} · {amount(task.planned_quantity)} {task.unit}</div>
                  <div className="track"><span style={{ width: `${progress(task, itemReport)}%` }} /></div>
                </article>
              );
            })}
          </>
        ) : null}
        {tab === "profile" ? (
          <>
            <h1>Профиль</h1>
            <article className="job"><b>{session.name}</b><div className="quiet">Рабочий · {project}</div></article>
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
      {volumeOpen && current ? (
        <form className="dialog-back" onSubmit={(event) => { event.preventDefault(); onSubmit(current.id, quantity); setVolumeOpen(false); }}>
          <div className="dialog">
            <h2>Сколько сделано</h2>
            <label className="field"><span>Объём, {current.unit}</span><input value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" /></label>
            <button className="fill wide" type="submit">Сдать работу</button>
            <button className="ghost" type="button" onClick={() => setVolumeOpen(false)}>Закрыть</button>
          </div>
        </form>
      ) : null}
      {stopOpen && current ? (
        <form className="dialog-back" onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const cause = (form.elements.namedItem("cause") as HTMLInputElement).value.trim();
          const minutes = Number((form.elements.namedItem("minutes") as HTMLInputElement).value);
          if (!cause || !Number.isInteger(minutes) || minutes <= 0) return;
          update((item) => ({
            ...item,
            downtime: [{ id: crypto.randomUUID(), taskId: current.id, day: todayKey(), minutes, cause }, ...item.downtime],
          }));
          setStopOpen(false);
        }}>
          <div className="dialog">
            <h2>Простой</h2>
            <label className="field"><span>Минуты</span><input name="minutes" inputMode="numeric" /></label>
            <label className="field"><span>Причина</span><input name="cause" /></label>
            <button className="fill wide" type="submit">Записать</button>
            <button className="ghost" type="button" onClick={() => setStopOpen(false)}>Закрыть</button>
          </div>
        </form>
      ) : null}
      {problemOpen ? (
        <form className="dialog-back" onSubmit={(event) => { event.preventDefault(); setProblem((event.currentTarget.elements.namedItem("problem") as HTMLTextAreaElement).value); setProblemOpen(false); }}>
          <div className="dialog">
            <h2>Проблема</h2>
            <textarea className="note" name="problem" placeholder="Что мешает работе" defaultValue={problem} />
            <button className="fill wide" type="submit">Сохранить на телефоне</button>
            <button className="ghost" type="button" onClick={() => setProblemOpen(false)}>Закрыть</button>
          </div>
        </form>
      ) : null}
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
