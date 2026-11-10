import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import {InvitationDialog,InvitationList} from "./invitations";
import type { Desk, Session } from "./api";
import { Dialog } from "./dialog";
import { minutesLabel, useBook, type Book } from "./book";
import { DeskBadge, DeskCrumbs, DeskEmpty, DeskSelect, DeskTimeline, FluidTabs, SmoothButton, StatGrid } from "./kit";
import { amount, clock, laneOf, laneTone, permitState, personName, statusLabel, todayKey, type Admission } from "./model";
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
  session, data, onOpenTask, inviteWorker = false, inviteForeman = false, peopleTabs = ["people"], admitStep = "none", dayStep = "none", canExport = false, admissions = [], onAdmit, cards = [], onCard,
}: {
  session: Session;
  data: Desk;
  onOpenTask: (taskId: string) => void;
  inviteWorker?: boolean;
  inviteForeman?: boolean;
  peopleTabs?: Tab[];
  admitStep?: "prepare" | "none";
  dayStep?: "prepare" | "close" | "none";
  canExport?: boolean;
  admissions?: Admission[];
  onAdmit?: (employeeId: string, until: string) => void;
  cards?: PersonCard[];
  onCard?: (card: PersonCard) => void;
}) {
  const [rawTab, setTab] = useState<Tab>(peopleTabs[0] ?? "people");
  const tab = peopleTabs.includes(rawTab) ? rawTab : (peopleTabs[0] ?? "people");
  const workersOnly = peopleTabs.length === 1 && peopleTabs[0] === "people" && inviteWorker && !inviteForeman;
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [invitingForeman, setInvitingForeman] = useState(false);
  const person = data.employees.find((item) => item.id === personId) ?? null;
  const admission = admissions.find((item) => item.employeeId === personId);
  if (person) {
    return (
      <Profile
        person={person}
        data={data}
        until={admission?.until}
        card={cards.find((item) => item.employeeId === person.id) ?? emptyCard(person.id)}
        backLabel={workersOnly ? "Работники" : "Люди"}
        onBack={() => setPersonId(null)}
        onOpenTask={onOpenTask}
        admitStep={admitStep}
        onAdmit={(until) => onAdmit?.(person.id, until)}
        onCard={(card) => onCard?.(card)}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const people = data.employees.filter(item => item.role !== "master").filter((item) => `${item.full_name} ${item.phone}`.toLowerCase().includes(needle));
  const onShift = new Set(data.shifts.filter((shift) => shift.status === "open" && shift.employee_id).map((shift) => shift.employee_id));
  const review = new Set(data.shifts.filter((shift) => shift.clock_requires_review && shift.employee_id).map((shift) => shift.employee_id));
  const contractors = data.organizations.filter((item) => item.kind !== "own");

  return (
    <section className="page">
      <div className="passport-head">
        <div>
          <h1>{workersOnly ? "Работники" : tab === "sheet" ? "Табель и рабочее время" : "Люди"}</h1>
          <p className="sub">{workersOnly ? "Кого можно поставить на работу сегодня." : "Работник ставится в задание. Прораб задание ведёт."}</p>
        </div>
        <div className="panel-tools">
          {(tab === "people" && inviteWorker) ? <SmoothButton onClick={() => setInviting(true)}>Пригласить работника</SmoothButton> : null}
          {tab === "foremen" && inviteForeman ? <SmoothButton onClick={() => setInvitingForeman(true)}>Пригласить прораба</SmoothButton> : null}
          {canExport && tab === "people" ? <SmoothButton tone="ghost" onClick={() => save("sotrudniki.txt", people.map((item) => `${item.full_name}\t${item.phone}\t${item.document_number ?? ""}`))}>Выгрузить список</SmoothButton> : null}
        </div>
      </div>
      {peopleTabs.length > 1 ? <FluidTabs name="people-tabs" label="Разделы людей" value={tab} onChange={(id) => setTab(id as Tab)} tabs={peopleTabLabels.filter((item) => peopleTabs.includes(item.id))} /> : null}
      {tab === "people" ? (
        <>
          <StatGrid items={[
            { value: String(data.employees.filter(item => item.role !== "master").length), label: "работников" },
            { value: String(onShift.size), label: "на смене" },
            { value: String(review.size), label: "отметки на проверке" },
          ]} />
          <input className="object-search" type="search" value={query} placeholder="Найти работника" aria-label="Найти работника" onChange={(event) => setQuery(event.target.value)} />
          {people.length === 0 ? <DeskEmpty title={needle ? "Такого работника нет" : "Работников пока нет"} description={needle ? "Проверьте имя или телефон." : "Пригласите работника. Он отмечает смену и сдаёт объём."} /> : (
            <div className="sheet-wrap">
              <table className="sheet">
                <thead>
                  <tr><th>Сотрудник</th><th>Телефон</th><th>Документ</th><th>Смена</th></tr>
                </thead>
                <tbody>
                  {people.map((item) => (
                    <tr className="is-link" key={item.id} tabIndex={0} onClick={() => setPersonId(item.id)} onKeyDown={(event) => { if (event.key === "Enter") setPersonId(item.id); }}>
                      <td><span className="who"><i>{initials(item.full_name)}</i><b>{item.full_name}</b></span></td>
                      <td>{item.phone}</td>
                      <td>{item.document_number || "—"}</td>
                      <td><DeskBadge tone={onShift.has(item.id) ? "accent" : "neutral"}>{onShift.has(item.id) ? "На смене" : "Не на смене"}</DeskBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="quiet">После регистрации человек появится в списке. Допуск к работе и назначение оформляются отдельно.</p>
        </>
      ) : null}
      {(tab === 'people' && inviteWorker || tab === 'foremen' && inviteForeman) ? <InvitationList key={`${tab}-${inviting}-${invitingForeman}`} session={session} projectId={data.projectId} role={tab==='foremen'?'master':'worker'}/> : null}
      {inviting || invitingForeman ? <InvitationDialog session={session} projectId={data.projectId} organizationId={data.organizations.find(o=>o.kind==='own')?.id ?? ''} role={invitingForeman?'master':'worker'} onClose={()=>{setInviting(false);setInvitingForeman(false);}}/> : null}
      {tab === "crews" ? <DeskEmpty title="Бригад ещё нет" description="Состав и загрузка появятся, когда бригаду заведут. Сейчас люди числятся без бригады." /> : null}
      {tab === "contractors" ? (
        contractors.length === 0 ? <DeskEmpty title="Подрядчиков нет" description="В кабинете одна своя организация. Чужие компании сюда не попадают." /> : (
          <div className="object-list">
            {contractors.map((item) => <article className="panel" key={item.id} style={{ padding: 16 }}><b>{item.name}</b></article>)}
          </div>
        )
      ) : null}
      {tab === "sheet" ? <Timesheet data={data} dayStep={dayStep} onOpen={setPersonId} /> : null}
    </section>
  );
}


function Timesheet({ data, dayStep, onOpen }: { data: Desk; dayStep: "prepare" | "close" | "none"; onOpen: (id: string) => void }) {
  const { book, update } = useBook();
  const dates = [...new Set(data.shifts.map((shift) => dayOf(shift.started_at)).filter(Boolean))].sort().reverse();
  const [day, setDay] = useState(dates.includes(todayKey()) ? todayKey() : dates[0] ?? todayKey());
  const [selected, setSelected] = useState<string | null>(null);
  const rows = data.shifts.filter((shift) => dayOf(shift.started_at) === day);
  const current = rows.find((shift) => shift.id === selected) ?? rows.find((shift) => shift.clock_requires_review) ?? rows[0];
  const worked = new Set(rows.map((shift) => shift.employee_id).filter(Boolean));
  const checks = rows.filter((shift) => shift.clock_requires_review).length;
  return (
    <>
      <div className="object-tools">
        <DeskSelect label="Период" value={day} options={(dates.length ? dates : [todayKey()]).map((item) => ({ value: item, label: labelDay(item) }))} onChange={(value) => { setDay(value); setSelected(null); }} />
        {dayStep === "prepare" ? <SmoothButton onClick={() => update((item) => item.preparedDays.includes(day) ? item : { ...item, preparedDays: [...item.preparedDays, day] })}>{book.preparedDays.includes(day) ? "Закрытие подготовлено" : "Подготовить закрытие дня"}</SmoothButton> : null}
        {dayStep === "close" ? <SmoothButton onClick={() => update((item) => item.closedDays.includes(day) ? item : { ...item, closedDays: [...item.closedDays, day] })}>{book.closedDays.includes(day) ? "День закрыт в браузере" : "Закрыть день"}</SmoothButton> : null}
        {dayStep === "none" ? <DeskBadge>Утверждение табеля пока не реализовано</DeskBadge> : null}
        <SmoothButton tone="ghost" onClick={() => save(`tabel-${day}.txt`, timesheetLines(data, book, day, rows))}>Выгрузить смены</SmoothButton>
      </div>
      <StatGrid items={[
        { value: String(worked.size), label: "со сменой в этот день" },
        { value: String(checks), label: "отметки на проверке" },
        { value: String(rows.filter((shift) => shift.status === "open").length), label: "смены ещё открыты" },
      ]} />
      {book.downtime.filter((item) => item.day === day).length === 0 ? <p className="quiet">Простоя в этот день нет.</p> : book.downtime.filter((item) => item.day === day).map((item) => (
        <p className="quiet" key={item.id}>Простой {minutesLabel(item.minutes)} · {item.cause}</p>
      ))}
      {rows.length === 0 ? <DeskEmpty title="В этот день смен нет" description="Выберите другую дату или дождитесь отметки с телефона." /> : (
        <div className="sheet-split">
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr><th>Сотрудник</th><th>Начало</th><th>Окончание</th><th>Учтено</th><th>Статус</th></tr>
              </thead>
              <tbody>
                {rows.map((shift) => (
                  <tr key={shift.id} className={current?.id === shift.id ? "is-link is-on" : "is-link"} tabIndex={0} onClick={() => setSelected(shift.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelected(shift.id); }}>
                    <td><button type="button" className="linkish" onClick={(event) => { event.stopPropagation(); if (shift.employee_id) onOpen(shift.employee_id); }}>{short(personName(data, shift.employee_id ?? ""))}</button></td>
                    <td>{clock(shift.started_at) || "—"}</td>
                    <td>{clock(shift.finished_at) || "—"}</td>
                    <td>{span(shift.started_at, shift.finished_at)}</td>
                    <td><DeskBadge tone={shift.status === "open" || shift.clock_requires_review ? "accent" : "neutral"}>{shiftLabel(shift)}</DeskBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sheet-side">
            <AnimatePresence mode="wait" initial={false}>
              {current ? (
                <motion.section className="panel" key={current.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}>
                  <h2>История событий</h2>
                  <DeskTimeline events={shiftStory(data, current)} />
                </motion.section>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      )}
      <p className="quiet">Время смены и время задания считаются раздельно. Перерывы в эту таблицу ещё не пишутся.</p>
    </>
  );
}

function Profile({
  person, data, until, card, backLabel, onBack, onOpenTask, admitStep, onAdmit, onCard,
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
}) {
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
            <button className="ghost" type="button" onClick={() => photoInput.current?.click()}>{card.photoUrl ? "Заменить фото" : "Добавить фото"}</button>
            <input ref={photoInput} type="file" accept="image/*" hidden onChange={(event) => { setPhoto(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          <div>
            <h1>{person.full_name}</h1>
            <p className="person-meta">
              <span>{person.phone}</span>
              <span>{person.document_number || "документ не указан"}</span>
              {card.trade.trim() ? <span>{card.trade.trim()}</span> : null}
            </p>
            {photoError ? <p role="alert">{photoError}</p> : null}
          </div>
        </div>
        <div className="person-badges">
          <DeskBadge tone={open ? "accent" : "neutral"}>{open ? "На смене" : "Не на смене"}</DeskBadge>
          <DeskBadge tone={permitWords(until).tone}>{permitWords(until).label}</DeskBadge>
        </div>
      </div>
      <FluidTabs name="person-tabs" label="Карточка сотрудника" value={tab} onChange={(id) => setTab(id as ProfileTab)} tabs={tabs.map(([id, label]) => ({ id, label }))} />
      {tab === "overview" ? (
        <>
          <div className="person-card">
            <section className="panel">
              <h2>Сегодня</h2>
              <div className="day-facts">
                <div><b>{todayShift ? clock(todayShift.started_at) || "—" : "—"}</b><span>Начало</span></div>
                <div><b>—</b><span>Перерыв</span></div>
                <div><b>—</b><span>Простой</span></div>
              </div>
              <p className="quiet person-note">{todayShift?.clock_requires_review ? "Отметка ждёт проверки. Учтённое время подтверждается после неё." : "Перерыв и простой в смену ещё не пишутся. Учтённое время — это начало и окончание."}</p>
              {todayTask ? (
                <div className="person-job">
                  <div>
                    <span className="quiet">Текущее задание</span>
                    <b>{todayTask.title}</b>
                    <span className="quiet">{labelDay(todayTask.work_date.slice(0, 10))} · {amount(todayTask.planned_quantity)} {todayTask.unit} · {statusLabel(laneOf(todayTask.id, data))}</span>
                  </div>
                  <button className="ghost" type="button" onClick={() => onOpenTask(todayTask.id)}>Открыть задание</button>
                </div>
              ) : <p className="quiet person-note">На сегодня задания нет.</p>}
            </section>
            <Questionnaire person={person} card={card} onCard={onCard} />
          </div>
          <History data={data} personId={person.id} />
        </>
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
          <Permits person={person} until={until} scans={card.files.length} admitStep={admitStep} onAdmit={onAdmit} />
          <PersonFiles card={card} onCard={onCard} />
        </>
      ) : null}
      {tab === "history" ? <History data={data} personId={person.id} /> : null}
    </section>
  );
}

function Questionnaire({ person, card, onCard }: { person: Desk["employees"][number]; card: PersonCard; onCard: (card: PersonCard) => void }) {
  return (
    <section className="panel">
      <h2>Анкета</h2>
      <dl className="kv">
        <div><dt>Имя</dt><dd>{person.full_name}</dd></div>
        <div><dt>Телефон</dt><dd>{person.phone || "—"}</dd></div>
        <div><dt>Документ</dt><dd>{person.document_number?.trim() || "не указан"}</dd></div>
      </dl>
      <div className="anketa">
        <label className="field"><span>Дата рождения</span><input type="date" value={card.born} onChange={(event) => onCard({ ...card, born: event.target.value })} /></label>
        <label className="field"><span>Специальность</span><input value={card.trade} onChange={(event) => onCard({ ...card, trade: event.target.value })} /></label>
        <label className="field"><span>Заметка</span><input value={card.note} onChange={(event) => onCard({ ...card, note: event.target.value })} /></label>
      </div>
      <p className="quiet person-note">Дата рождения, специальность и заметка остаются на странице. Сервер их пока не хранит.</p>
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
      <button className="ghost" type="button" onClick={() => input.current?.click()}>Выбрать файлы</button>
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
          <SmoothButton tone="ghost" onClick={() => save("istoriya.txt", rows.map((row) => `${labelDay(row.at.slice(0, 10))}\t${row.title}\t${row.detail}`))}>Экспорт</SmoothButton>
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

function shiftStory(data: Desk, shift: Desk["shifts"][number]) {
  const rows = [{ id: `${shift.id}-start`, title: "Начало смены", detail: taskTitle(data, shift.task_id), when: clock(shift.started_at) || "—" }];
  if (shift.finished_at) rows.push({ id: `${shift.id}-end`, title: "Окончание смены", detail: "", when: clock(shift.finished_at) || "—" });
  return rows;
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

function span(start?: string | null, end?: string | null) {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  if (hours === 0) return `${minutes} мин`;
  return `${hours} ч ${minutes} мин`;
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part.slice(0, 1)).join("").toUpperCase();
}

function short(name: string) {
  const [first, last] = name.split(" ").filter(Boolean);
  if (!last) return name;
  return `${first.slice(0, 1)}. ${last}`;
}

function timesheetLines(data: Desk, book: Book, day: string, rows: Desk["shifts"]) {
  const stops = book.downtime.filter((item) => item.day === day);
  return [
    "Выгрузка смен. Это не утверждённый табель.",
    ...rows.map((shift) => `${personName(data, shift.employee_id ?? "")}\t${clock(shift.started_at) || "—"}\t${clock(shift.finished_at) || "—"}\t${span(shift.started_at, shift.finished_at)}\t${shift.status}`),
    ...stops.map((item) => `простой\t${minutesLabel(item.minutes)}\t${item.cause}`),
  ];
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
