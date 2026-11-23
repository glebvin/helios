import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import {InvitationDialog,InvitationList} from "./invitations";
import { searchStaff, staffNotice, type ServerEmployee } from "./staff-list";
import { useStaffCard, useStaffList } from "./staff-read";
import { hasV1ProjectScope } from "./scope";
import type { Desk, Session } from "./api";
import { Dialog } from "./dialog";
import { ProjectAccessPanel } from "./project-access-panel";
import { AdmissionChecksPanel } from "./admission-check-panel";
import { QualificationsPanel } from "./qualifications-panel";
import { EmployeeForm } from "./employee-form";
import { canImportStaff, canWriteStaff } from "./staff-form";
import { CrewPanel } from "./crew-panel";
import { StaffImportPanel } from "./staff-import-panel";
import { TimeSheet } from "./time-sheet";
import { PrimaryDay } from "./primary-day";
import { Flash } from "./flash";
import { DeskBadge, DeskCrumbs, DeskEmpty, DeskSelect, DeskTimeline, FluidTabs, SmoothButton, StatGrid } from "./kit";
import { amount, clock, laneOf, laneTone, permitState, statusLabel, todayKey, type Admission } from "./model";
import { personIntervalFacts } from "./person-intervals";
import { useServerRead } from "./server-read";
import { ApiError, v1 } from "./v1";
import type { PeopleTab } from "./roles";

export type PersonFile = { id: string; name: string; size: number; url: string };
export type PersonCard = { employeeId: string; photoUrl?: string; born: string; trade: string; note: string; files: PersonFile[] };

export function emptyCard(employeeId: string): PersonCard {
  return { employeeId, born: "", trade: "", note: "", files: [] };
}

type Tab = PeopleTab;
type ProfileTab = "overview" | "shifts" | "tasks" | "documents" | "history";

const peopleTabLabels: { id: Tab; label: string }[] = [
  { id: "people", label: "Работники" },
  { id: "foremen", label: "Прорабы" },
  { id: "crews", label: "Бригады" },
  { id: "sheet", label: "Табель" },
  { id: "contractors", label: "Подрядчики" },
];

export function People({
  session, projectId = "", data, onOpenTask, inviteWorker = false, inviteForeman = false, peopleTabs = ["people"], admitStep = "none", canExport = false, canDecideHours = false, admissions = [], onAdmit, cards = [], onCard, openSheet = 0, sheetDay = "", primaryDay = "", primaryWritable = false,
}: {
  session: Session;
  projectId?: string;
  data: Desk;
  onOpenTask: (taskId: string) => void;
  inviteWorker?: boolean;
  inviteForeman?: boolean;
  peopleTabs?: Tab[];
  admitStep?: "prepare" | "none";
  canExport?: boolean;
  canDecideHours?: boolean;
  admissions?: Admission[];
  onAdmit?: (employeeId: string, until: string) => void;
  cards?: PersonCard[];
  onCard?: (card: PersonCard) => void;
  openSheet?: number;
  sheetDay?: string;
  primaryDay?: string;
  primaryWritable?: boolean;
}) {
  const [rawTab, setTab] = useState<Tab>(peopleTabs[0] ?? "people");
  useEffect(() => { if (openSheet > 0 && peopleTabs.includes("sheet")) setTab("sheet"); }, [openSheet, peopleTabs]);
  const tab = peopleTabs.includes(rawTab) ? rawTab : (peopleTabs[0] ?? "people");
  const workersOnly = peopleTabs.length === 1 && peopleTabs[0] === "people" && inviteWorker && !inviteForeman;
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [invitingForeman, setInvitingForeman] = useState(false);
  const [creating, setCreating] = useState(false);
  const serverList = hasV1ProjectScope(session.role) || session.role === "hr" || session.role === "safety";
  const remote = useStaffList(session, serverList);
  const list = serverList ? remote : { ...remote, loading: false, error: "", offset: 0, limit: data.employees.length,
    total: data.employees.length, items: data.employees.map(item => ({ id: item.id, fullName: item.full_name,
      phone: item.phone, userId: item.user_id, organizationId: "", version: 0, status: "active" as const })) };
  const opened = useStaffCard(session, personId, serverList);
  const admission = admissions.find((item) => item.employeeId === personId);
  const legacyPerson = !serverList ? data.employees.find(item => item.id === personId) : null;
  if (legacyPerson) return <Profile person={legacyPerson} data={data} until={admission?.until}
    card={cards.find(item => item.employeeId === personId) ?? emptyCard(legacyPerson.id)}
    backLabel={workersOnly ? "Работники" : "Люди"} onBack={() => setPersonId(null)} onOpenTask={onOpenTask}
    admitStep={admitStep} onAdmit={until => onAdmit?.(legacyPerson.id, until)} onCard={card => onCard?.(card)} />;
  if (personId) {
    return (
      <ServerProfile
        day={primaryDay}
        projectId={projectId}
        loading={opened.loading}
        error={opened.error}
        employee={opened.employee}
        data={data}
        until={admission?.until}
        card={cards.find((item) => item.employeeId === personId) ?? emptyCard(personId)}
        backLabel={workersOnly ? "Работники" : "Люди"}
        onBack={() => setPersonId(null)}
        onOpenTask={onOpenTask}
        admitStep={admitStep}
        onAdmit={(until) => onAdmit?.(personId, until)}
        onCard={(card) => onCard?.(card)}
        session={session}
        onReload={() => { list.reload(); opened.reload(); }}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const people = searchStaff(list.items, query);
  const loaded = new Set(list.items.map((item) => item.id));
  const onShift = new Set(data.shifts.filter((shift) => shift.status === "open" && shift.employee_id && loaded.has(shift.employee_id)).map((shift) => shift.employee_id));
  const review = new Set(data.shifts.filter((shift) => shift.clock_requires_review && shift.employee_id && loaded.has(shift.employee_id)).map((shift) => shift.employee_id));
  const notice = staffNotice({ error: list.error, total: list.total, loaded: list.items.length, shown: people.length, needle: query });
  const contractors = data.organizations.filter((item) => item.kind !== "own");

  return (
    <section className="page">
      <div className="passport-head">
        <div>
          <h1>{workersOnly ? "Работники" : tab === "sheet" ? "Табель и рабочее время" : "Люди"}</h1>
          <p className="sub">{tab === "sheet" ? "Записанные дни сервера. Пустая дата не означает подтверждённое отсутствие." : workersOnly ? "Кого можно поставить на работу сегодня." : "Работник ставится в задание. Прораб задание ведёт."}</p>
        </div>
        <div className="panel-tools">
          {(tab === "people" && canWriteStaff(session.role)) ? <SmoothButton onClick={() => setCreating(true)}>Добавить сотрудника</SmoothButton> : null}
          {(tab === "people" && inviteWorker) ? <SmoothButton onClick={() => setInviting(true)}>Пригласить работника</SmoothButton> : null}
          {tab === "foremen" && inviteForeman ? <SmoothButton onClick={() => setInvitingForeman(true)}>Пригласить прораба</SmoothButton> : null}
          {canExport && tab === "people" ? <SmoothButton tone="ghost" onClick={() => save("sotrudniki.txt", ["Выгрузка этой страницы сервера. Документ в ответе списка не приходит.", ...people.map((item) => `${item.fullName}\t${item.phone ?? ""}`)])}>Выгрузить список</SmoothButton> : null}
        </div>
      </div>
      {peopleTabs.length > 1 ? <FluidTabs name="people-tabs" label="Разделы людей" value={tab} onChange={(id) => setTab(id as Tab)} tabs={peopleTabLabels.filter((item) => peopleTabs.includes(item.id))} /> : null}
      {tab === "people" ? (
        <>
          <StatGrid items={[
            { value: list.error ? "—" : String(list.total), label: "сотрудников" },
            { value: list.error ? "—" : String(onShift.size), label: "на смене на этой странице" },
            { value: list.error ? "—" : String(review.size), label: "проверка на этой странице" },
          ]} />
          {canImportStaff(session.role) ? <StaffImportPanel key={`${session.tenantId}:${session.userId}:${session.token}`} session={session} organizations={data.organizations} onImported={() => list.reload()} /> : null}
          <input className="object-search" type="search" value={query} placeholder="Найти работника" aria-label="Найти работника" onChange={(event) => setQuery(event.target.value)} />
          {list.loading && list.items.length === 0 ? <p className="quiet">Читаем список сотрудников на сервере.</p> : null}
          {list.error ? <DeskEmpty title="Список не прочитан" description={list.error} /> : null}
          {list.error ? <button className="ghost" type="button" onClick={list.reload}>Повторить загрузку</button> : null}
          {!list.loading && !list.error && list.total === 0 ? <DeskEmpty title="Работников пока нет" description="Сервер вернул пустой список. Пригласите работника. Он отмечает смену и сдаёт объём." /> : null}
          {!list.error && needle && people.length === 0 && list.total > 0 ? <DeskEmpty title="Такого работника нет" description={notice || "Проверьте имя или телефон."} /> : null}
          {!list.error && people.length > 0 ? (
            <div className="sheet-wrap">
              <table className="sheet">
                <thead>
                  <tr><th>Сотрудник</th><th>Телефон</th><th>Документ</th><th>Смена</th></tr>
                </thead>
                <tbody>
                  {people.map((item) => (
                    <tr className="is-link" key={item.id} tabIndex={0} onClick={() => setPersonId(item.id)} onKeyDown={(event) => { if (event.key === "Enter") setPersonId(item.id); }}>
                      <td><span className="who"><i>{initials(item.fullName)}</i><b>{item.fullName}</b>{item.status === "archived" ? <DeskBadge>В архиве</DeskBadge> : null}</span></td>
                      <td>{item.phone || "—"}</td>
                      <td>{data.employees.find((row) => row.id === item.id)?.document_number || "—"}</td>
                      <td><DeskBadge tone={onShift.has(item.id) ? "accent" : "neutral"}>{onShift.has(item.id) ? "На смене" : "Не на смене"}</DeskBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!list.error && list.total > list.limit ? (
            <div className="panel-tools">
              <button className="ghost" type="button" disabled={list.offset === 0} onClick={() => list.setOffset(Math.max(0, list.offset - list.limit))}>Назад</button>
              <button className="ghost" type="button" disabled={list.offset + list.items.length >= list.total} onClick={() => list.setOffset(list.offset + list.limit)}>Дальше</button>
            </div>
          ) : null}
          {notice && people.length > 0 ? <p className="quiet">{notice}</p> : null}
          <p className="quiet">{session.role === "director" ? "Список сотрудников компании, включая ещё не назначенных на объект. " : "Показаны сотрудники, доступные этому входу. "}Имя и телефон получены с сервера. Допуск и назначение на объект оформляются отдельно.</p>
        </>
      ) : null}
      {(tab === 'people' && inviteWorker || tab === 'foremen' && inviteForeman) ? <InvitationList key={`${tab}-${inviting}-${invitingForeman}`} session={session} projectId={data.projectId} role={tab==='foremen'?'master':'worker'}/> : null}
      {creating ? <Dialog title="Сотрудник" onClose={() => setCreating(false)}><EmployeeForm session={session} organizations={data.organizations} employee={null} onSaved={() => list.reload()} /><button className="ghost" type="button" onClick={() => setCreating(false)}>Закрыть</button></Dialog> : null}
      {inviting || invitingForeman ? <InvitationDialog session={session} projectId={data.projectId} organizationId={data.organizations.find(o=>o.kind==='own')?.id ?? ''} role={invitingForeman?'master':'worker'} onClose={()=>{setInviting(false);setInvitingForeman(false);}}/> : null}
      {tab === "crews" ? <CrewPanel session={session} projectId={projectId} /> : null}
      {tab === "contractors" ? (
        contractors.length === 0 ? <DeskEmpty title="Подрядчиков нет" description="В кабинете одна своя организация. Чужие компании сюда не попадают." /> : (
          <div className="object-list">
            {contractors.map((item) => <article className="panel" key={item.id} style={{ padding: 16 }}><b>{item.name}</b></article>)}
          </div>
        )
      ) : null}
      {tab === "sheet" ? <>
        {session.role === "master" || session.role === "hr" ? <PrimaryDay key={`${session.tenantId}:${session.userId}:${projectId}`} session={session} projectId={projectId} organizations={data.organizations} serverDay={primaryDay} readOnly={!primaryWritable} /> : null}
        {session.role === "hr" ? null : <TimeSheet key={`${session.tenantId}:${session.userId}:${projectId}`} session={session} projectId={projectId} canDecide={canDecideHours} day={sheetDay} />}
      </> : null}
    </section>
  );
}


function PersonIntervals({ session, projectId, employeeId, day }: { session: Session; projectId: string; employeeId: string; day: string }) {
  const read = useServerRead(session, `${projectId}:${employeeId}:${day}`, "", () => v1<{ recorded: boolean; source: { totals: { breakMs: string; downtimeMs: string }; hasOpenIntervals: boolean } }>(session, `/projects/${projectId}/time/employees/${employeeId}/days/${day}`), (reason) => reason instanceof ApiError && reason.status === 404 ? "Этот день входу не виден." : reason instanceof ApiError && reason.status === 403 ? "Этому входу табель не разрешён." : "Интервалы дня прочитать не удалось.");
  const facts = read.body ? personIntervalFacts(read.body) : null;
  return <div aria-busy={read.loading}>
    {read.loading ? <p className="quiet task-hold" role="status">Читаем интервалы…</p> : null}
    {read.error ? <p role="alert">{read.error} <button className="ghost desk-action" type="button" onClick={read.retry}>Повторить чтение</button></p> : null}
    {facts ? <>
      <div className="day-facts">
        <div><b>{facts.breakLabel}</b><span>Перерыв</span></div>
        <div><b>{facts.downtimeLabel}</b><span>Простой</span></div>
      </div>
      <p className="quiet person-note">{facts.note}</p>
    </> : null}
  </div>;
}

function ServerProfile({
  day = "", projectId, loading, error, employee, data, until, card, backLabel, onBack, onOpenTask, admitStep, onAdmit, onCard, session, onReload,
}: {
  day?: string;
  projectId: string;
  loading: boolean;
  error: string;
  employee: ServerEmployee | null;
  data: Desk;
  until?: string;
  card: PersonCard;
  backLabel: string;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  admitStep: "prepare" | "none";
  onAdmit: (until: string) => void;
  onCard: (card: PersonCard) => void;
  session: Session;
  onReload: () => void;
}) {
  const [written, setWritten] = useState<ServerEmployee | null>(null);
  const shown = written && employee && written.id === employee.id && written.version >= employee.version ? written : employee;
  if (!shown) {
    return (
      <section className="page">
        <DeskCrumbs items={[{ label: backLabel, onClick: onBack }, { label: "Карточка" }]} />
        {error ? <DeskEmpty title="Карточка не прочитана" description={error} /> : <p className="quiet">{loading ? "Читаем карточку на сервере." : "Сервер не показал эту карточку."}</p>}
      </section>
    );
  }
  return (
    <>
    {error ? <p className="quiet" role="alert">{error} Показана последняя прочитанная версия.</p> : null}
    <Profile
      person={{ id: shown.id, full_name: shown.fullName, phone: shown.phone ?? "", user_id: shown.userId, document_number: data.employees.find((row) => row.id === shown.id)?.document_number ?? null, role: shown.status === "archived" ? "archived" : null }}
      projectAccess={<ProjectAccessPanel key={`${session.token}:${session.tenantId}:${shown.id}:${projectId}:${shown.userId}`} session={session} employeeId={shown.id} userId={shown.userId} projectId={projectId} archived={shown.status === "archived"} />}
      admissionChecks={<AdmissionChecksPanel key={`${session.token}:${session.tenantId}:${shown.id}:${projectId}`} session={session} employeeId={shown.id} projectId={projectId} archived={shown.status === "archived"} />}
      qualifications={<QualificationsPanel key={`${session.token}:${shown.id}`} session={session} employeeId={shown.id} archived={shown.status === "archived"} />}
      organization={data.organizations.find((item) => item.id === shown.organizationId)?.name}
      workStatus={shown.status}
      intervals={["director", "master", "pto"].includes(session.role) && projectId && day ? <PersonIntervals session={session} projectId={projectId} employeeId={shown.id} day={day} /> : undefined}
      editor={canWriteStaff(session.role) ? <EmployeeForm session={session} organizations={data.organizations} employee={shown} toast={false} onSaved={(row) => { setWritten(row); onReload(); }} /> : null}
      data={data}
      until={until}
      card={card}
      backLabel={backLabel}
      onBack={onBack}
      onOpenTask={onOpenTask}
      admitStep={admitStep}
      onAdmit={onAdmit}
      onCard={onCard}
    />
    </>
  );
}

function Profile({
  person, data, until, card, backLabel, onBack, onOpenTask, admitStep, onAdmit, onCard, editor = null, qualifications = null, admissionChecks = null, projectAccess = null, organization, workStatus, intervals = null,
}: {
  person: Desk["employees"][number];
  data: Desk;
  until?: string;
  card: PersonCard;
  backLabel: string;
  onBack: () => void;
  onOpenTask: (taskId: string) => void;
  admitStep: "prepare" | "none";
  onAdmit: (until: string) => void;
  onCard: (card: PersonCard) => void;
  editor?: ReactNode;
  qualifications?: ReactNode;
  admissionChecks?: ReactNode;
  projectAccess?: ReactNode;
  organization?: string;
  workStatus?: "active" | "archived";
  intervals?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [photoError, setPhotoError] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  const shifts = data.shifts.filter((shift) => shift.employee_id === person.id);
  const tasks = data.tasks.filter((task) => task.assignee_employee_id === person.id);
  const open = shifts.find((shift) => shift.status === "open");
  const today = todayKey();
  const todayShift = shifts.find((shift) => dayOf(shift.started_at) === today) ?? open;
  const todayTask = (open ? tasks.find((task) => task.id === open.task_id) : undefined) ?? tasks.find((task) => task.work_date.slice(0, 10) === today);
  const tabs = [
    ["overview", "Обзор"],
    ["shifts", "Смены"],
    ["tasks", "Задания"],
    ["documents", "Документы"],
    ["history", "История"],
  ] as const;
  function setPhoto(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Нужна фотография: jpg, png или webp.");
      return;
    }
    if (card.photoUrl) URL.revokeObjectURL(card.photoUrl);
    onCard({ ...card, photoUrl: URL.createObjectURL(file) });
    setPhotoError("");
  }
  return (
    <section className="page">
      <DeskCrumbs items={[{ label: backLabel, onClick: onBack }, { label: person.full_name }]} />
      <div className="person-head">
        <div className="who">
          <div className="portrait">
            {card.photoUrl ? <img src={card.photoUrl} alt="" /> : <i aria-hidden="true">{initials(person.full_name)}</i>}
            <button className="ghost desk-action" type="button" onClick={() => photoInput.current?.click()}>{card.photoUrl ? "Заменить фото" : "Добавить фото"}</button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={(event) => { setPhoto(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          <div>
            <h1>{person.full_name}</h1>
            <p className="person-meta">
              <span>{person.phone || "—"}</span>
              <span>{person.document_number || "документ не указан"}</span>
              {card.trade.trim() ? <span>{card.trade.trim()}</span> : null}
            </p>
            {photoError ? <p role="alert">{photoError}</p> : null}
          </div>
        </div>
        <div className="person-badges">
          <DeskBadge tone={open ? "accent" : "neutral"}>{open ? "На смене" : "Не на смене"}</DeskBadge>
          {admissionChecks ? <DeskBadge>Проверки — в документах</DeskBadge> : <DeskBadge tone={permitWords(until).tone}>{permitWords(until).label}</DeskBadge>}
        </div>
      </div>
      <FluidTabs name="person-tabs" label="Карточка сотрудника" value={tab} onChange={(id) => setTab(id as ProfileTab)} tabs={tabs.map(([id, label]) => ({ id, label }))} />
      <AnimatePresence mode="wait" initial={false}>
      <motion.div key={tab} className="person-pane" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.26 }}>
      {tab === "overview" ? (
          <div className="person-card">
            <div className="person-column">
            <section className="panel">
              <h2>Сегодня</h2>
              {intervals ? <div className="day-facts"><div><b>{todayShift ? clock(todayShift.started_at) || "—" : "—"}</b><span>Начало</span></div></div> : null}
              {intervals && todayShift?.clock_requires_review ? <p className="quiet person-note">Отметка ждёт проверки. Учтённое время подтверждается после неё.</p> : null}
              {intervals ?? <>
              <div className="day-facts">
                <div><b>{todayShift ? clock(todayShift.started_at) || "—" : "—"}</b><span>Начало</span></div>
                <div><b>—</b><span>Перерыв</span></div>
                <div><b>—</b><span>Простой</span></div>
              </div>
              <p className="quiet person-note">{todayShift?.clock_requires_review ? "Отметка ждёт проверки. Учтённое время подтверждается после неё." : workStatus ? "Интервалы этого дня читаются во входе с табелем." : "Перерыв и простой в смену ещё не пишутся. Учтённое время — это начало и окончание."}</p>
              </>}
              {todayTask ? (
                <div className="person-job">
                  <div>
                    <span className="quiet">Текущее задание</span>
                    <b>{todayTask.title}</b>
                    <span className="quiet">{labelDay(todayTask.work_date.slice(0, 10))} · {amount(todayTask.planned_quantity)} {todayTask.unit} · {statusLabel(laneOf(todayTask.id, data))}</span>
                  </div>
                  <button className="ghost desk-action" type="button" onClick={() => onOpenTask(todayTask.id)}>Открыть задание</button>
                </div>
              ) : <p className="quiet person-note">На сегодня задания нет.</p>}
            </section>
            <History data={data} personId={person.id} />
            </div>
            <Questionnaire person={person} card={card} onCard={onCard} editor={editor} organization={organization} workStatus={workStatus} />
          </div>
      ) : null}
      {tab === "shifts" ? (
        <>
          <section className="panel">
            <h2>Явка за {monthTitle()}</h2>
            <MonthAttendance shifts={shifts} />
          </section>
          <ShiftTable data={data} rows={shifts} />
        </>
      ) : null}
      {tab === "tasks" ? (
        tasks.length === 0 ? <DeskEmpty title="Заданий нет" description="Назначенные работы появятся в этом списке." /> : (
          <div className="person-list">
            {tasks.map((task) => {
              const lane = laneOf(task.id, data);
              return (
                <article className="panel person-row" key={task.id}>
                  <div>
                    <b>{task.title}</b>
                    <span className="quiet">{labelDay(task.work_date.slice(0, 10))} · {amount(task.planned_quantity)} {task.unit}</span>
                  </div>
                  <DeskBadge tone={laneTone(lane)}>{statusLabel(lane)}</DeskBadge>
                  <button className="ghost" type="button" onClick={() => onOpenTask(task.id)}>Открыть</button>
                </article>
              );
            })}
          </div>
        )
      ) : null}
      {tab === "documents" ? (
        <>
          {qualifications || projectAccess ? <div className="documents-top">{qualifications}{projectAccess}</div> : null}
          {admissionChecks ?? <Permits person={person} until={until} scans={card.files.length} admitStep={admitStep} onAdmit={onAdmit} />}
          <PersonFiles card={card} onCard={onCard} />
        </>
      ) : null}
      {tab === "history" ? <History data={data} personId={person.id} /> : null}
      </motion.div>
      </AnimatePresence>
    </section>
  );
}

function Questionnaire({ person, card, onCard, editor = null, organization, workStatus }: { person: Desk["employees"][number]; card: PersonCard; onCard: (card: PersonCard) => void; editor?: ReactNode; organization?: string; workStatus?: "active" | "archived" }) {
  const [editing, setEditing] = useState(false);
  const [toast, setToast] = useState("");
  const [pulse, setPulse] = useState(0);
  const form = editing && isValidElement(editor)
    ? cloneElement(editor as ReactElement<{ onSaved?: (row: ServerEmployee) => void; onRead?: (row: ServerEmployee) => void; toast?: boolean; extra?: ReactNode }>, {
        toast: false,
        extra: (
          <div className="anketa">
            <label className="field"><span>Дата рождения</span><input type="date" value={card.born} onChange={(event) => onCard({ ...card, born: event.target.value })} /></label>
            <label className="field"><span>Специальность</span><input value={card.trade} onChange={(event) => onCard({ ...card, trade: event.target.value })} /></label>
            <label className="field"><span>Заметка</span><input value={card.note} onChange={(event) => onCard({ ...card, note: event.target.value })} /></label>
          </div>
        ),
        onRead: (row: ServerEmployee) => {
          (editor as ReactElement<{ onSaved?: (row: ServerEmployee) => void }>).props.onSaved?.(row);
        },
        onSaved: (row: ServerEmployee) => {
          (editor as ReactElement<{ onSaved?: (row: ServerEmployee) => void }>).props.onSaved?.(row);
          setEditing(false);
          setToast(`Сервер записал «${row.fullName}».`);
          setPulse(value => value + 1);
        },
      })
    : null;
  const born = card.born ? card.born.split("-").reverse().join(".") : "не указана";
  return (
    <section className="panel anketa-card">
      <div className="documents-heading">
        <h2>Анкета</h2>
        {editor ? <button className="ghost desk-action" type="button" onClick={() => setEditing(value => !value)}>{editing ? "Отмена" : "Изменить"}</button> : null}
      </div>
      {form}
      {editing ? null : (
        <dl className="profile-facts">
          <div><dt>Имя</dt><dd>{person.full_name}</dd></div>
          <div><dt>Телефон</dt><dd>{person.phone || "—"}</dd></div>
          <div><dt>Документ</dt><dd>{person.document_number?.trim() || "не указан"}</dd></div>
          {organization !== undefined ? <div><dt>Организация</dt><dd>{organization || "—"}</dd></div> : null}
          {workStatus ? <div><dt>Состояние</dt><dd>{workStatus === "archived" ? "В архиве" : "Работает"}</dd></div> : null}
          <div><dt>Дата рождения</dt><dd>{born}</dd></div>
          <div><dt>Специальность</dt><dd>{card.trade.trim() || "не указана"}</dd></div>
          <div><dt>Заметка</dt><dd>{card.note.trim() || "нет"}</dd></div>
        </dl>
      )}
      <p className="quiet person-note">Имя, телефон, организация и состояние пишутся на сервер. Дата рождения, специальность и заметка остаются в этом браузере.</p>
      <Flash message={toast} pulse={pulse} />
    </section>
  );
}

function Permits({ person, until, scans, admitStep, onAdmit }: { person: Desk["employees"][number]; until?: string; scans: number; admitStep: "prepare" | "none"; onAdmit: (until: string) => void }) {
  const number = person.document_number?.trim();
  const permit = permitWords(until);
  const [date, setDate] = useState(until ?? "");
  const [error, setError] = useState("");
  return (
    <section className="panel">
      <h2>Документы и допуски</h2>
      <ul className="permit">
        <li><span>Документ</span><b>{number || "не указан"}</b></li>
        <li><span>Допуск</span><DeskBadge tone={permit.tone}>{permit.short}</DeskBadge></li>
        <li><span>Срок</span>{until ? <b>{labelDay(until)}</b> : <DeskBadge>Не задан</DeskBadge>}</li>
        <li><span>Сканы</span>{scans ? <b>{scans}</b> : <DeskBadge>Не загружены</DeskBadge>}</li>
      </ul>
      <ul className="permit">
        <li><span>Готовит</span><b>Мастер СМО</b></li>
        <li><span>Согласует</span><b>Охрана труда</b></li>
        <li><span>Утверждает</span><b>Руководитель проекта</b></li>
      </ul>
      {admitStep === "prepare" ? (
        <form className="person-note" onSubmit={(event) => {
          event.preventDefault();
          if (!date) { setError("Укажите дату подготовки."); return; }
          onAdmit(date);
          setError("");
        }}>
          <label className="field"><span>Подготовить до</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setError(""); }} /></label>
          {error ? <p role="alert">{error}</p> : null}
          <button className="fill" type="submit">Подготовить допуск</button>
        </form>
      ) : <p className="quiet person-note">Согласование охраны труда и утверждение руководителя проекта сервер этому входу не отдаёт.</p>}
      <p className="quiet person-note">Подготовка остаётся в браузере этого входа и не считается серверным допуском. Назначение по-прежнему требует записанный срок, сервер дату не хранит.</p>
    </section>
  );
}

function PersonFiles({ card, onCard }: { card: PersonCard; onCard: (card: PersonCard) => void }) {
  function add(list: File[]) {
    const next = list.filter((file) => file.size > 0).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      url: URL.createObjectURL(file),
    }));
    if (!next.length) return;
    onCard({ ...card, files: [...next, ...card.files] });
  }
  return (
    <section className="panel">
      <h2>Файлы</h2>
      <FileDrop onFiles={add} />
      {card.files.length === 0 ? <p className="quiet person-note">Сканов пока нет. Перетащите файл или выберите его кнопкой.</p> : (
        <ul className="permit">
          {card.files.map((file) => (
            <li key={file.id}>
              <span className="file-name">{file.name}<small>{sizeLabel(file.size)}</small></span>
              <button className="ghost" type="button" onClick={() => { URL.revokeObjectURL(file.url); onCard({ ...card, files: card.files.filter((item) => item.id !== file.id) }); }}>Убрать</button>
            </li>
          ))}
        </ul>
      )}
      <p className="quiet person-note">Файл остаётся на этой странице. Сервер байты пока не хранит.</p>
    </section>
  );
}

function FileDrop({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={over ? "drop is-over" : "drop"}
      onDragEnter={(event) => { event.preventDefault(); setOver(true); }}
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFiles([...event.dataTransfer.files]);
      }}
    >
      <p>Перетащите файлы сюда</p>
      <button className="ghost desk-action" type="button" onClick={() => input.current?.click()}>Выбрать файлы</button>
      <input ref={input} type="file" multiple hidden onChange={(event) => { onFiles([...(event.target.files ?? [])]); event.target.value = ""; }} />
    </div>
  );
}

function sizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function permitWords(until?: string) {
  const state = permitState(until);
  if (state === "ok") return { tone: "done" as const, label: `Допуск до ${labelDay(until ?? "")}`, short: "Действует" };
  if (state === "expired") return { tone: "warn" as const, label: "Допуск истёк", short: "Истёк" };
  return { tone: "warn" as const, label: "Допуск не проверен", short: "Не проверен" };
}

function ShiftTable({ data, rows }: { data: Desk; rows: Desk["shifts"] }) {
  if (!rows.length) return <DeskEmpty title="Смен нет" description="Отметка с телефона появится здесь." />;
  return (
    <div className="sheet-wrap">
      <table className="sheet">
        <thead><tr><th>День</th><th>Начало</th><th>Окончание</th><th>Задание</th><th>Статус</th></tr></thead>
        <tbody>
          {rows.map((shift) => (
            <tr key={shift.id}>
              <td>{labelDay(dayOf(shift.started_at))}</td>
              <td>{clock(shift.started_at) || "—"}</td>
              <td>{clock(shift.finished_at) || "—"}</td>
              <td>{taskTitle(data, shift.task_id)}</td>
              <td><DeskBadge tone={shift.status === "open" || shift.clock_requires_review ? "accent" : "neutral"}>{shiftLabel(shift)}</DeskBadge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function History({ data, personId }: { data: Desk; personId: string }) {
  const [days, setDays] = useState("7");
  const rows = story(data, personId).filter((row) => within(row.at, Number(days)));
  return (
    <section className="panel">
      <div className="panel-bar">
        <h2>История</h2>
        <div className="panel-tools">
          <DeskSelect label="Период" value={days} options={[{ value: "7", label: "За 7 дней" }, { value: "30", label: "За 30 дней" }, { value: "0", label: "Всё время" }]} onChange={setDays} />
          <button className="ghost desk-action" type="button" onClick={() => save("istoriya.txt", rows.map((row) => `${labelDay(row.at.slice(0, 10))}\t${row.title}\t${row.detail}`))}>Экспорт</button>
        </div>
      </div>
      {rows.length === 0 ? <DeskEmpty title="За этот срок событий нет" description="Смены, назначения и сданный объём появятся здесь." /> : (
        <DeskTimeline events={rows.map((row) => ({ id: row.id, title: row.title, detail: row.detail, when: `${labelDay(row.at.slice(0, 10))}${row.at.length > 10 ? ` ${clock(row.at)}` : ""}` }))} />
      )}
    </section>
  );
}

function story(data: Desk, personId: string) {
  const rows: { id: string; at: string; title: string; detail: string }[] = [];
  for (const shift of data.shifts.filter((item) => item.employee_id === personId)) {
    if (shift.started_at) rows.push({ id: `${shift.id}-start`, at: shift.started_at, title: "Начало смены", detail: taskTitle(data, shift.task_id) });
    if (shift.finished_at) rows.push({ id: `${shift.id}-end`, at: shift.finished_at, title: "Окончание смены", detail: "" });
  }
  for (const task of data.tasks.filter((item) => item.assignee_employee_id === personId)) {
    rows.push({ id: `${task.id}-set`, at: task.work_date, title: "Назначено задание", detail: task.title });
    const report = data.reports.find((item) => item.task_id === task.id);
    if (!report) continue;
    rows.push({ id: `${report.id}-in`, at: task.work_date, title: "Сдан объём", detail: `${amount(report.submitted_quantity)} ${task.unit}` });
    if (report.accepted_quantity) rows.push({ id: `${report.id}-ok`, at: task.work_date, title: "Принят объём", detail: `${amount(report.accepted_quantity)} ${task.unit}` });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

function within(at: string, days: number) {
  if (!days) return true;
  const time = new Date(at).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= days * 86_400_000;
}

function shiftLabel(shift: Desk["shifts"][number]) {
  if (shift.clock_requires_review) return "На проверке";
  if (shift.status === "open") return "На смене";
  if (shift.status === "finished") return "Закрыта";
  return shift.status;
}

function taskTitle(data: Desk, taskId: string) {
  return data.tasks.find((task) => task.id === taskId)?.title ?? "Задание";
}

function MonthAttendance({ shifts }: { shifts: Desk["shifts"] }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const counts = new Map<string, number>();
  for (const shift of shifts) {
    const key = dayOf(shift.started_at);
    if (!key) continue;
    const date = new Date(`${key}T00:00:00`);
    if (date.getFullYear() !== year || date.getMonth() !== month) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, index) => index + 1)];
  return (
    <div className="month">
      <div className="month-grid" aria-hidden="true">
        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((day) => <i key={day}>{day}</i>)}
      </div>
      <div className="month-grid">
        {cells.map((day, index) => {
          if (!day) return <b key={`empty-${index}`} />;
          const key = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const count = counts.get(key) ?? 0;
          const level = count === 0 ? "" : count === 1 ? "is-1" : "is-2";
          return (
            <button className={level ? `day-cell ${level}` : "day-cell"} type="button" key={key}>
              <span>{labelDay(key)} · {count === 0 ? "нет отметки" : `${count} ${shiftWord(count)}`}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function shiftWord(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "смена";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "смены";
  return "смен";
}

function monthTitle() {
  return new Date().toLocaleDateString("ru-RU", { month: "long" });
}

function dayOf(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function labelDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase();
}

function save(name: string, lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
