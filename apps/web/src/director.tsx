import { useState } from "react";
import type { Desk, NewTask, Session } from "./api";
import { WorkBoard } from "./board";
import { Inbox } from "./inbox";
import { Icon, paths } from "./icons";
import { DeskBadge, DeskEmpty, DeskProgress, DeskSelect, PageShift, ProfileMenu, StatGrid, ThemeButton } from "./kit";
import { Documents } from "./documents";
import { Materials } from "./materials";
import { Objects } from "./objects";
import { Quality } from "./quality";
import { Settings } from "./settings";
import { Mark } from "./mark";
import { People, type ForemanInvite, type PersonCard, type WorkerInvite } from "./people";
import { RoleSwitch, accessOf, roleTitle, serverRights, type Section, type View } from "./roles";
import { minutesLabel, useBook } from "./book";
import { amount, dayTasks, laneOf, laneTone, personName, progress, statusLabel, todayKey, type Admission, type Lane, type Remark } from "./model";

const icons: Record<Section, string> = {
  overview: paths.home,
  mine: paths.check,
  people: paths.people,
  tasks: paths.list,
  quality: paths.shield,
  materials: paths.box,
  documents: paths.file,
  objects: paths.pin,
  settings: paths.gear,
};

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
  onEnd,
  onSubmit,
  onCreate,
  onSavePlace,
  view,
  preview,
  demo,
  onDemoAccount,
}: {
  session: Session;
  data: Desk;
  section: Section;
  onSection: (section: Section) => void;
  theme: "light" | "dark";
  onTheme: () => void;
  onLogout: () => void;
  onAccept: (reportId: string, acceptedQuantity: string) => void;
  onRole: (view: View) => void;
  onStart: (taskId: string, employeeId: string) => void;
  onEnd: (taskId: string) => void;
  onSubmit: (taskId: string, quantity: string) => void;
  onCreate: (input: NewTask) => Promise<string>;
  onSavePlace: (projectId: string, place: { address: string; latitude: number; longitude: number }) => Promise<void>;
  view: View;
  preview: boolean;
  demo: boolean;
  onDemoAccount: (email: string, password: string) => void;
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

  const [invites, setInvites] = useState<WorkerInvite[]>([]);
  const [foremen, setForemen] = useState<ForemanInvite[]>([]);
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [cards, setCards] = useState<PersonCard[]>([]);
  const [remarks, setRemarks] = useState<Remark[]>([]);
  const [openTask, setOpenTask] = useState<{ id: string; token: number } | null>(null);
  const access = accessOf(view);
  const rights = serverRights(session.role);
  const canCreate = !preview && rights.createTask && access.createTask;
  const canAccept = !preview && rights.acceptReport && access.acceptVolume;
  const canPlace = !preview && rights.savePlace && access.editPlace;
  const canInviteWorker = !preview && access.inviteWorker;
  const canInviteForeman = !preview && access.inviteForeman;
  const canRecordSupply = !preview && access.recordSupply;
  const canDraftAct = !preview && access.draftAct;
  const canPrepareAdmit = !preview && access.prepareAdmit;
  const canPrepareDay = !preview && access.prepareDay;
  const canCloseDay = !preview && access.closeDay;
  const canResubmit = !preview && access.resubmit;
  const canEditCheck = !preview && access.editCheck;
  const menu = access.sections;
  const page = menu.some((item) => item.id === section) ? section : (menu[0]?.id ?? "overview");
  const foreman = access.shell === "foreman";
  const crew = foreman
    ? data.employees.map((person) => ({
      id: person.id,
      name: person.full_name,
      phone: person.phone,
      on: data.shifts.some((shift) => shift.employee_id === person.id && shift.status === "open"),
    }))
    : undefined;

  return (
    <div className={foreman ? "desk is-foreman" : "desk"}>
      <aside className="side">
        <Mark />
        <nav>
          {menu.map((item) => (
            <button className={page === item.id ? "nav-item is-on" : "nav-item"} type="button" key={item.id} aria-current={page === item.id ? "page" : undefined} onClick={() => onSection(item.id)}>
              <Icon d={icons[item.id]} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">{session.name}</div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <DeskSelect label="Объект" value={project} options={[{ value: project, label: project }]} onChange={() => {}} />
          <span className="grow" />
          {demo ? <RoleSwitch view={view} onView={onRole} /> : null}
          {demo ? <DemoAccounts email={session.email} onAccount={onDemoAccount} /> : null}
          <ThemeButton theme={theme} onTheme={onTheme} />
          <ProfileMenu name={session.name} role={roleTitle(session.role)} onLogout={onLogout} />
        </header>
        {preview ? <p className="quiet preview-note">Просмотр кабинета: {access.hint} Вход не меняется: {session.name}, {roleTitle(session.role)}. Запись от выбранного вида не выполняется.</p> : null}
        <PageShift pageKey={page}>
          {page === "overview" ? (
            <Overview
              title={access.overviewTitle}
              project={project}
              date={date}
              tasks={tasks}
              data={data}
              waiting={waiting.length}
              onShift={onShift.size}
              files={data.files.length}
              accepted={accepted}
              attention={attention}
              remarks={remarks}
              crew={crew}
              openLabel={access.sections.some((item) => item.id === "mine") ? "Открыть дела" : "К приёмке"}
              onOpen={() => onSection(access.sections.some((item) => item.id === "mine") ? "mine" : "quality")}
            />
          ) : null}
          {page === "mine" ? (
            <Inbox
              data={data}
              remarks={remarks}
              canAccept={canAccept}
              canApprove={canCloseDay}
              canOpenBoard={access.sections.some((item) => item.id === "tasks")}
              canOpenQuality={access.sections.some((item) => item.id === "quality")}
              canOpenDocuments={access.sections.some((item) => item.id === "documents")}
              onAccept={onAccept}
              onOpenBoard={() => onSection("tasks")}
              onOpenQuality={() => onSection("quality")}
              onOpenDocuments={() => onSection("documents")}
            />
          ) : null}
          {page === "objects" ? <Objects data={data} canEdit={canPlace} normsNote={access.normsNote} onSavePlace={onSavePlace} onTasks={() => onSection("tasks")} /> : null}
          {page === "people" ? (
            <People
              key={view}
              data={data}
              onOpenTask={(id) => { setOpenTask({ id, token: Date.now() }); onSection("tasks"); }}
              inviteWorker={canInviteWorker}
              inviteForeman={canInviteForeman}
              peopleTabs={access.peopleTabs}
              admitStep={canPrepareAdmit ? "prepare" : "none"}
              dayStep={canPrepareDay ? "prepare" : canCloseDay ? "close" : "none"}
              canExport={access.exportPeople}
              invites={invites}
              onInvite={(item) => setInvites((list) => [...list, item])}
              foremen={foremen}
              onInviteForeman={(item) => setForemen((list) => [...list, item])}
              admissions={admissions}
              onAdmit={(employeeId, until) => setAdmissions((list) => [...list.filter((item) => item.employeeId !== employeeId), { employeeId, until }])}
              cards={cards}
              onCard={(card) => setCards((list) => [...list.filter((item) => item.employeeId !== card.employeeId), card])}
            />
          ) : null}
          {page === "tasks" ? (
            <WorkBoard
              data={data}
              tasks={tasks}
              canAccept={canAccept}
              canCreate={canCreate}
              onStart={onStart}
              onEnd={onEnd}
              onSubmit={onSubmit}
              onAccept={onAccept}
              onCreate={onCreate}
              openTask={openTask}
              admissions={admissions}
              remarks={remarks}
              onResubmit={(id) => setRemarks((list) => list.map((item) => item.id === id ? { ...item, resubmitted: true } : item))}
            />
          ) : null}
          {page === "materials" ? <Materials canEdit={canRecordSupply} /> : null}
          {page === "quality" ? (
            <Quality
              key={view}
              data={data}
              tabs={access.qualityTabs}
              first={access.qualityFirst}
              canAccept={canAccept}
              writeCheck={false}
              writeCustomer={false}
              writeRemark={false}
              canResubmit={canResubmit}
              editCheck={canEditCheck}
              onAccept={onAccept}
              remarks={remarks}
              onRemark={(item) => setRemarks((list) => [item, ...list])}
              onResubmit={(id) => setRemarks((list) => list.map((item) => item.id === id ? { ...item, resubmitted: true } : item))}
            />
          ) : null}
          {page === "documents" ? <Documents data={data} canConfirm={false} canDraft={canDraftAct} checklistNote={access.checklistNote} /> : null}
          {page === "settings" ? <Settings session={session} data={data} theme={theme} onTheme={onTheme} onLogout={onLogout} invites={invites} foremen={foremen} viewLabel={roleTitle(session.role)} viewHint={preview ? access.hint : "Этот вход видит только свои серверные действия."} showAccess={!preview && access.showAccess} slim={access.settingsSlim || preview} /> : null}
        </PageShift>
      </div>
    </div>
  );
}

function Overview({
  title, project, date, tasks, data, waiting, onShift, files, accepted, attention, remarks, crew, openLabel, onOpen,
}: {
  title: string;
  project: string;
  date: string;
  tasks: Desk["tasks"];
  data: Desk;
  waiting: number;
  onShift: number;
  files: number;
  accepted: number;
  attention: { title: string; who: string; taskId: string; reportId: string }[];
  remarks: Remark[];
  crew?: { id: string; name: string; phone: string; on: boolean }[];
  openLabel: string;
  onOpen: () => void;
}) {
  const { book } = useBook();
  const late = remarks.filter((item) => !item.resubmitted && item.due < todayKey()).length;
  const stop = book.downtime.filter((item) => item.day === todayKey());
  const stopLabel = stop.length === 0 ? "—" : minutesLabel(stop.reduce((sum, item) => sum + item.minutes, 0));
  const ratio = tasks.length ? Math.round((accepted / tasks.length) * 100) : 0;
  return (
    <section className="page">
      <div>
        <h1>{title}</h1>
        <p className="sub">{project} · {date}</p>
      </div>
      <StatGrid
        items={[
          { value: String(onShift), label: `на смене из ${data.employees.length}`, tone: onShift > 0 ? "accent" : undefined },
          { value: String(waiting), label: "ждут приёмки", tone: waiting > 0 ? "warn" : undefined },
          { value: String(attention.length), label: "требуют внимания", tone: attention.length > 0 ? "warn" : undefined },
          { value: String(files), label: "файлов объекта" },
        ]}
      />
      <section className="panel">
        <h2>Сводка дня</h2>
        <div className="summary-facts">
          <div><b>{planFact(tasks, data)}</b><span>принято из плана</span></div>
          <div><b>{closedHours(data)}</b><span>закрытые часы</span></div>
          <div><b>{stopLabel}</b><span>простой</span></div>
          <div><b>{String(late)}</b><span>просроченных замечаний</span></div>
        </div>
        <p className="quiet person-note">{stop.length === 0 ? "Простоя за сегодня нет. Отметка пишется на телефоне рабочего." : `Простой за сегодня: ${stopLabel}.`} Файлов в кабинете: {files}. Принято заданий сегодня: {accepted}.</p>
      </section>
      <div className="split">
        <section className="panel">
          <h2>Ход работ</h2>
          <div className="work-head"><span>Работа</span><span>Объём</span><span>Статус</span><span>Ответственный</span></div>
          {tasks.length === 0 ? <DeskEmpty title="На сегодня заданий нет" description="Поставленные на этот день появятся здесь." /> : null}
          {tasks.map((task) => {
            const lane = laneOf(task.id, data);
            const tone = laneTone(lane);
            const report = data.reports.find((item) => item.task_id === task.id);
            return (
              <div className={lane === "assigned" ? "work-line" : `work-line is-${lane}`} key={task.id}>
                <b>{task.title}</b>
                <span>{amount(task.planned_quantity)} {task.unit}</span>
                <DeskBadge tone={tone}>{statusLabel(lane)}</DeskBadge>
                <span>{shortName(personName(data, task.assignee_employee_id))}</span>
                <DeskProgress compact tone={tone === "neutral" ? "ink" : tone} value={progress(task, report)} label={`Ход: ${task.title}`} />
              </div>
            );
          })}
        </section>
        <section className="panel">
          <h2>Требует внимания {attention.length > 0 ? <span className="count">{attention.length}</span> : null}</h2>
          <div className="attention">
            {attention.length === 0 ? <DeskEmpty title="Сейчас пусто" description="Приёмка и открытая смена без объёма появятся здесь." /> : null}
            {attention.map((item) => (
              <div className="attention-row" key={item.taskId + item.title}>
                <span className={item.reportId ? "ico is-warn" : "ico is-accent"}><Icon d={item.reportId ? paths.check : paths.alert} /></span>
                <span><b>{item.title}</b><small>Ответственный: {item.who}</small></span>
                <button className="ghost" type="button" onClick={onOpen}>Открыть</button>
              </div>
            ))}
          </div>
        </section>
      </div>
      {crew ? (
        <section className="panel">
          <h2>Кто на объекте</h2>
          {crew.length === 0 ? <DeskEmpty title="Людей на объекте нет" description="Когда в кабинете появится работник, он будет здесь." /> : null}
          <div className="crew">
            {crew.map((person) => (
              <div className="crew-row" key={person.id}>
                <b>{person.name}</b>
                <span className="quiet">{person.phone || "Телефона нет"}</span>
                <DeskBadge tone={person.on ? "accent" : "neutral"}>{person.on ? "На смене" : "Не на смене"}</DeskBadge>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <div className="daybar">
        <div>
          <b>Итоги дня</b>
          <div className="quiet">{accepted} из {tasks.length} заданий приняты</div>
        </div>
        <DeskProgress compact value={ratio} label="Доля принятых заданий" />
        <button className="fill" type="button" onClick={onOpen}>{openLabel}</button>
      </div>
    </section>
  );
}

function planFact(tasks: Desk["tasks"], data: Desk) {
  if (!tasks.length) return "—";
  const units = new Set(tasks.map((task) => task.unit));
  if (units.size !== 1) return "разные единицы";
  const unit = [...units][0];
  const plan = tasks.reduce((sum, task) => sum + Number(task.planned_quantity), 0);
  const fact = tasks.reduce((sum, task) => sum + Number(data.reports.find((item) => item.task_id === task.id)?.accepted_quantity ?? 0), 0);
  return `${amount(String(fact))} из ${amount(String(plan))} ${unit}`;
}

function closedHours(data: Desk) {
  const key = todayKey();
  let ms = 0;
  for (const shift of data.shifts) {
    if (!shift.started_at || !shift.finished_at) continue;
    const start = new Date(shift.started_at);
    const local = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (local !== key) continue;
    const span = new Date(shift.finished_at).getTime() - start.getTime();
    if (span > 0) ms += span;
  }
  if (!ms) return "0 ч";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

const demoAccounts = [
  { label: "Анна", email: "director@pilot.helios", password: "pilot-director" },
  { label: "Павел", email: "master@pilot.helios", password: "pilot-master" },
  { label: "Иван", email: "worker@pilot.helios", password: "pilot-worker" },
];

function DemoAccounts({ email, onAccount }: { email: string; onAccount: (email: string, password: string) => void }) {
  return (
    <div className="roles" role="group" aria-label="Учебный вход">
      <span className="roles-label">Учебный вход</span>
      {demoAccounts.map((item) => (
        <button key={item.email} type="button" className={email === item.email ? "is-on" : ""} onClick={() => onAccount(item.email, item.password)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

function shortName(name: string) {
  const [first, last] = name.split(" ").filter(Boolean);
  if (!last) return name;
  return `${first.slice(0, 1)}. ${last}`;
}

export type { Section, Lane };
