import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { InvitationDialog, InvitationList } from "./invitations";
import { DeskEmpty } from "./kit";
import {
  ApiError,
  apiText,
  collectPages,
  isAbort,
  pagePath,
  releaseRequest,
  requestId,
  v1,
  type AdmissionCheck,
  type AdmissionTemplate,
  type Assignment,
  type Crew,
  type CurrentAdmission,
  type OverviewClock,
  type Page,
  type Qualification,
  type V1Employee,
  type V1Project,
  type WorkType,
  type Zone,
} from "./v1";

type Organization = { id: string; name: string };
type Conflict = { sent: number; server: number | null; code: string };
type Pref = { projectId: string; day: string };

const reasonText: Record<string, string> = {
  employee_archived: "Карточка в архиве",
  no_check: "Чек-лист допуска ещё не записан",
  check_failed: "Последняя проверка не пройдена",
  not_latest_check: "Назначение ссылается не на последнюю проверку",
  template_changed: "Шаблон допуска изменился, нужна новая проверка",
};

function reasonLabel(code: string) {
  if (reasonText[code]) return reasonText[code];
  const [kind, rest] = code.split(":");
  const named: Record<string, string> = {
    qualification_missing: "Нет действующей квалификации",
    qualification_revoked: "Квалификация отозвана",
    qualification_expired: "Срок квалификации истёк",
    qualification_expired_on_work_date: "Квалификация не действует на дату работы",
    qualification_changed: "Квалификация изменилась после проверки",
    critical_failed: "Критичный пункт не подтверждён",
    noncritical_failed: "Некритичный пункт не подтверждён",
  };
  return rest ? `${named[kind] ?? kind}: ${rest}` : (named[kind] ?? code);
}

function prefKey(session: Session) {
  return `helios.scope.${session.tenantId}.${session.userId}`;
}

function readPref(session: Session): Pref | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(prefKey(session)) ?? "") as Pref;
    if (parsed.projectId && /^\d{4}-\d{2}-\d{2}$/.test(parsed.day)) return parsed;
  } catch { /* preference is optional */ }
  return null;
}

function writePref(session: Session, projectId: string, day: string) {
  localStorage.setItem(prefKey(session), JSON.stringify({ projectId, day }));
}

export function labelDay(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}

export function useCabinetScope(session: Session) {
  const [projects, setProjects] = useState<V1Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [day, setDay] = useState("");
  const [timezone, setTimezone] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const flight = useRef(0);

  useEffect(() => {
    const ac = new AbortController();
    const mine = ++flight.current;
    setLoading(true);
    setError("");
    setProjects([]);
    setProjectId("");
    setDay("");
    setTimezone("");
    setEpoch((value) => value + 1);
    void (async () => {
      try {
        const list = await collectPages<V1Project>(session, "/projects", ac.signal);
        if (ac.signal.aborted || mine !== flight.current) return;
        setProjects(list.items);
        setTruncated(list.truncated);
        const pref = readPref(session);
        const allowed = list.items.some((item) => item.id === pref?.projectId);
        const chosen = allowed ? pref!.projectId : list.items[0]?.id ?? "";
        if (!chosen) return;
        const clock = await v1<OverviewClock>(session, `/overview?projectId=${chosen}`, undefined, { signal: ac.signal });
        if (ac.signal.aborted || mine !== flight.current) return;
        const nextDay = allowed && pref ? pref.day : clock.day;
        setProjectId(chosen);
        setTimezone(clock.timezone);
        setDay(nextDay);
        writePref(session, chosen, nextDay);
      } catch (reason) {
        if (isAbort(reason) || mine !== flight.current) return;
        setError(apiText(reason));
      } finally {
        if (!ac.signal.aborted && mine === flight.current) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [session.token, session.tenantId, session.userId]);

  async function chooseProject(id: string) {
    const mine = ++flight.current;
    setEpoch((value) => value + 1);
    setProjectId(id);
    setError("");
    try {
      const clock = await v1<OverviewClock>(session, `/overview?projectId=${id}`);
      if (mine !== flight.current) return;
      setTimezone(clock.timezone);
      setDay((current) => {
        const next = current || clock.day;
        writePref(session, id, next);
        return next;
      });
    } catch (reason) {
      if (mine !== flight.current) return;
      setProjectId("");
      setError(apiText(reason));
    }
  }

  function chooseDay(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    setDay(value);
    if (projectId) writePref(session, projectId, value);
  }

  return { projects, projectId, day, timezone, epoch, error, loading, truncated, chooseProject, chooseDay };
}

function Pager({ offset, total, onPage }: { offset: number; total: number; onPage: (offset: number) => void }) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + 100, total);
  return (
    <div className="panel-tools">
      <p className="quiet">Показаны {from}–{to} из {total}</p>
      <button className="ghost" type="button" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - 100))}>Назад</button>
      <button className="ghost" type="button" disabled={offset + 100 >= total} onClick={() => onPage(offset + 100)}>Дальше</button>
    </div>
  );
}

function ConflictNote({ conflict, onTake }: { conflict: Conflict; onTake: () => void }) {
  return (
    <p className="staff-note" role="alert">
      Конфликт {conflict.code}. Отправлена версия {conflict.sent}
      {conflict.server == null ? ". Текущую версию сервер в ответе не прислал." : `, на сервере сейчас ${conflict.server}.`}
      {" "}Форма сама версию не увеличивает.
      {conflict.server != null ? <button className="ghost" type="button" onClick={onTake}>Взять версию {conflict.server}</button> : null}
    </p>
  );
}

async function serverVersion(load: () => Promise<number | null>) {
  try { return await load(); } catch { return null; }
}

export function StaffDesk({
  session, projectId, epoch, organizations, canManage, inviteWorker, inviteForeman,
}: {
  session: Session;
  projectId: string;
  epoch: number;
  organizations: Organization[];
  canManage: boolean;
  inviteWorker: boolean;
  inviteForeman: boolean;
}) {
  const [employees, setEmployees] = useState<Page<V1Employee> | null>(null);
  const [offset, setOffset] = useState(0);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<"worker" | "master" | null>(null);
  const [mode, setMode] = useState<"people" | "crews">("people");
  const [tick, setTick] = useState(0);
  const organizationId = organizations[0]?.id ?? "";

  useEffect(() => {
    setOffset(0);
    setSelected("");
    setEmployees(null);
    setAssignments([]);
    setCrews([]);
  }, [projectId, epoch]);

  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const path = session.role === "director" ? "/employees" : `/employees?projectId=${projectId}`;
        const page = await v1<Page<V1Employee>>(session, pagePath(path, offset), undefined, { signal: ac.signal });
        const assigned = await collectPages<Assignment>(session, `/projects/${projectId}/assignments`, ac.signal);
        const crewPage = await collectPages<Crew>(session, `/projects/${projectId}/crews`, ac.signal);
        if (ac.signal.aborted) return;
        setEmployees(page);
        setAssignments(assigned.items);
        setCrews(crewPage.items);
        setError(assigned.truncated || crewPage.truncated ? "Часть назначений или бригад не поместилась в первые 2000 строк." : "");
      } catch (reason) {
        if (isAbort(reason)) return;
        setError(apiText(reason));
      }
    })();
    return () => ac.abort();
  }, [session, projectId, offset, epoch, tick]);

  const person = employees?.items.find((item) => item.id === selected) ?? null;
  const assignment = assignments.find((item) => item.employeeId === selected);
  const crew = crews.find((item) => item.members.some((member) => member.employeeId === selected && member.status === "active"));

  return (
    <section className="panel">
      <div className="panel-bar">
        <h2>Люди объекта</h2>
        <div className="panel-tools">
          <button className={mode === "people" ? "ghost is-accent" : "ghost"} type="button" onClick={() => setMode("people")}>Реестр</button>
          <button className={mode === "crews" ? "ghost is-accent" : "ghost"} type="button" onClick={() => setMode("crews")}>Бригады</button>
          {inviteWorker ? <button className="fill" type="button" disabled={!organizationId} onClick={() => setInvite("worker")}>Пригласить работника</button> : null}
          {inviteForeman ? <button className="ghost" type="button" disabled={!organizationId} onClick={() => setInvite("master")}>Пригласить прораба</button> : null}
        </div>
      </div>
      {!organizationId && (inviteWorker || inviteForeman) ? <p className="quiet">Приглашение ждёт организацию из кабинета: в v1 справочника организаций нет.</p> : null}
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {mode === "crews" ? (
        <Crews session={session} projectId={projectId} crews={crews} employees={employees?.items ?? []} canManage={canManage} onChanged={() => setTick((value) => value + 1)} />
      ) : (
        <div className="staff">
          <div className="staff-list">
            {canManage ? <EmployeeCreate session={session} organizations={organizations} onCreated={() => { setOffset(0); setTick((value) => value + 1); }} /> : null}
            {!employees ? <p className="quiet">Загрузка списка…</p> : null}
            {employees && employees.total === 0 ? <DeskEmpty title="Сотрудников не видно" description="Новая карточка появится здесь после создания. Назначение на объект — отдельный шаг." /> : null}
            {employees?.items.map((item) => {
              const rowAssignment = assignments.find((entry) => entry.employeeId === item.id);
              const rowCrew = crews.find((entry) => entry.members.some((member) => member.employeeId === item.id && member.status === "active"));
              return (
                <button className={selected === item.id ? "staff-row is-on" : "staff-row"} type="button" key={item.id} onClick={() => setSelected(item.id)}>
                  <b>{item.fullName}</b>
                  <span className="quiet">{item.userId ? "Вход есть" : "Входа нет"} · {item.status === "archived" ? "архив" : "активен"}</span>
                  <span className="quiet">{rowAssignment?.status === "active" ? "Назначен на объект" : "На объект не назначен"}{rowCrew ? ` · ${rowCrew.name}` : ""}</span>
                </button>
              );
            })}
            {employees ? <Pager offset={employees.offset} total={employees.total} onPage={setOffset} /> : null}
          </div>
          {person ? (
            <PersonCard
              session={session}
              projectId={projectId}
              person={person}
              organizations={organizations}
              assignment={assignment}
              crewName={crew?.name ?? ""}
              canManage={canManage}
              onChanged={() => setTick((value) => value + 1)}
            />
          ) : <DeskEmpty title="Карточка" description="Выберите человека слева. Скан и фото сервер не хранит." />}
        </div>
      )}
      {inviteWorker ? <InvitationList session={session} projectId={projectId} role="worker" /> : null}
      {invite ? <InvitationDialog session={session} projectId={projectId} organizationId={organizationId} role={invite} onClose={() => setInvite(null)} /> : null}
    </section>
  );
}

function EmployeeCreate({ session, organizations, onCreated }: { session: Session; organizations: Organization[]; onCreated: () => void }) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (busy) return;
    const payload = { fullName: fullName.trim(), organizationId, phone: phone.trim() || null };
    if (!payload.fullName || !payload.organizationId) { setError("Нужны имя и организация."); return; }
    setBusy(true);
    setError("");
    const key = `employee.create.${payload.organizationId}.${payload.fullName}`;
    try {
      await v1(session, "/employees", { ...payload, requestId: requestId(key, payload) });
      releaseRequest(key);
      setFullName("");
      setPhone("");
      onCreated();
    } catch (reason) {
      setError(apiText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="staff-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="field"><span>Новый сотрудник</span><input value={fullName} maxLength={200} onChange={(event) => setFullName(event.target.value)} /></label>
      <label className="field"><span>Телефон</span><input value={phone} maxLength={500} onChange={(event) => setPhone(event.target.value)} /></label>
      <label className="field"><span>Организация</span>
        <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
          {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      {!organizations.length ? <p className="field-error">В v1 нет справочника организаций. Создание сотрудника ждёт организацию из текущего кабинета.</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      <button className="fill" type="submit" disabled={busy || !organizations.length}>{busy ? "Сохраняем…" : "Создать карточку"}</button>
    </form>
  );
}

function PersonCard({
  session, projectId, person, organizations, assignment, crewName, canManage, onChanged,
}: {
  session: Session;
  projectId: string;
  person: V1Employee;
  organizations: Organization[];
  assignment?: Assignment;
  crewName: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<"about" | "qualification" | "admission" | "assignment">("about");
  const organization = organizations.find((item) => item.id === person.organizationId)?.name ?? "Организация не из списка кабинета";
  const admission = assignment?.currentAdmission;
  return (
    <article className="staff-card panel">
      <h2>{person.fullName}</h2>
      <p className="quiet">{person.userId ? "Вход привязан к карточке" : "Входа нет: приглашение создаёт учётную запись, эта форма её не создаёт."} {crewName ? `Бригада: ${crewName}.` : "Бригада не выбрана."}</p>
      <div className="staff-tabs" role="tablist">
        {(["about", "qualification", "admission", "assignment"] as const).map((item) => (
          <button className={tab === item ? "ghost is-on" : "ghost"} type="button" key={item} onClick={() => setTab(item)}>
            {item === "about" ? "Кто это" : item === "qualification" ? "Квалификация" : item === "admission" ? "Допуск" : "Назначение"}
          </button>
        ))}
      </div>
      {tab === "about" ? <AboutForm session={session} person={person} organization={organization} organizations={organizations} canManage={canManage} onChanged={onChanged} /> : null}
      {tab === "qualification" ? <Qualifications session={session} person={person} canManage={canManage} /> : null}
      {tab === "admission" ? <AdmissionPanel session={session} projectId={projectId} person={person} canManage={canManage} /> : null}
      {tab === "assignment" ? <AssignmentPanel session={session} projectId={projectId} person={person} assignment={assignment} admission={admission} canManage={canManage} onChanged={onChanged} /> : null}
    </article>
  );
}

function AboutForm({ session, person, organization, organizations, canManage, onChanged }: { session: Session; person: V1Employee; organization: string; organizations: Organization[]; canManage: boolean; onChanged: () => void }) {
  const [fullName, setFullName] = useState(person.fullName);
  const [phone, setPhone] = useState(person.phone ?? "");
  const [organizationId, setOrganizationId] = useState(person.organizationId);
  const [status, setStatus] = useState(person.status);
  const [expectedVersion, setExpectedVersion] = useState(person.version);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFullName(person.fullName);
    setPhone(person.phone ?? "");
    setOrganizationId(person.organizationId);
    setStatus(person.status);
    setExpectedVersion(person.version);
    setConflict(null);
  }, [person]);
  async function submit() {
    if (busy) return;
    const payload = { expectedVersion, fullName: fullName.trim(), organizationId, phone: phone.trim() || null, userId: person.userId, status };
    setBusy(true);
    setError("");
    const key = `employee.update.${person.id}`;
    try {
      await v1(session, `/employees/${person.id}`, { ...payload, requestId: requestId(key, payload) }, "PUT");
      releaseRequest(key);
      setConflict(null);
      onChanged();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const server = await serverVersion(async () => (await v1<V1Employee>(session, `/employees/${person.id}`)).version);
        setConflict({ sent: expectedVersion, server, code: reason.message });
      } else setError(apiText(reason));
    } finally { setBusy(false); }
  }
  return (
    <form className="staff-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="quiet">{organization}. Версия карточки {expectedVersion}.</p>
      <label className="field"><span>Имя</span><input value={fullName} maxLength={200} disabled={!canManage} onChange={(event) => setFullName(event.target.value)} /></label>
      <label className="field"><span>Телефон</span><input value={phone} maxLength={500} disabled={!canManage} onChange={(event) => setPhone(event.target.value)} /></label>
      <label className="field"><span>Организация</span>
        <select value={organizationId} disabled={!canManage} onChange={(event) => setOrganizationId(event.target.value)}>
          {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          {organizations.some((item) => item.id === organizationId) ? null : <option value={organizationId}>{organization}</option>}
        </select>
      </label>
      <label className="field"><span>Статус</span>
        <select value={status} disabled={!canManage} onChange={(event) => setStatus(event.target.value as V1Employee["status"])}>
          <option value="active">Активен</option>
          <option value="archived">Архив, назначения снимаются</option>
        </select>
      </label>
      {conflict ? <ConflictNote conflict={conflict} onTake={() => { if (conflict.server != null) { setExpectedVersion(conflict.server); setConflict(null); } }} /> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {canManage ? <button className="fill" type="submit" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить карточку"}</button> : <p className="quiet">Правка карточки доступна руководителю.</p>}
    </form>
  );
}

function Qualifications({ session, person, canManage }: { session: Session; person: V1Employee; canManage: boolean }) {
  const [page, setPage] = useState<Page<Qualification> | null>(null);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [reference, setReference] = useState("");
  const [validUntil, setValidUntil] = useState("");
  useEffect(() => { setOffset(0); }, [person.id]);
  useEffect(() => {
    const ac = new AbortController();
    setPage(null);
    void v1<Page<Qualification>>(session, pagePath(`/employees/${person.id}/qualifications`, offset), undefined, { signal: ac.signal })
      .then((value) => { if (!ac.signal.aborted) setPage(value); })
      .catch((reason) => { if (!isAbort(reason)) setError(apiText(reason)); });
    return () => ac.abort();
  }, [session, person.id, offset, tick]);
  async function create() {
    const payload = { code: code.trim(), title: title.trim(), documentReference: reference.trim() || null, validUntil: validUntil || null };
    if (!payload.code || !payload.title) { setError("Нужны код и название."); return; }
    const key = `qualification.${person.id}.${payload.code}`;
    try {
      await v1(session, `/employees/${person.id}/qualifications`, { ...payload, requestId: requestId(key, payload) });
      releaseRequest(key);
      setCode(""); setTitle(""); setReference(""); setValidUntil("");
      setError("");
      setOffset(0);
      setPage(await v1(session, pagePath(`/employees/${person.id}/qualifications`, 0)));
    } catch (reason) { setError(apiText(reason)); }
  }
  return (
    <div className="staff-form">
      <p className="quiet">Скан не загружается. Поле ниже — реквизиты документа, не файл.</p>
      {page?.items.map((item) => <QualificationRow session={session} personId={person.id} item={item} canManage={canManage} key={item.id} onChanged={() => setTick((value) => value + 1)} />)}
      {page ? <Pager offset={page.offset} total={page.total} onPage={setOffset} /> : <p className="quiet">Загрузка квалификаций…</p>}
      {canManage ? (
        <>
          <label className="field"><span>Код</span><input value={code} maxLength={80} onChange={(event) => setCode(event.target.value)} /></label>
          <label className="field"><span>Название</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="field"><span>Реквизиты документа</span><input value={reference} maxLength={500} onChange={(event) => setReference(event.target.value)} /></label>
          <label className="field"><span>Действует до</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
          <button className="fill" type="button" onClick={() => void create()}>Добавить квалификацию</button>
        </>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

function QualificationRow({ session, personId, item, canManage, onChanged }: { session: Session; personId: string; item: Qualification; canManage: boolean; onChanged: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [reference, setReference] = useState(item.documentReference ?? "");
  const [validUntil, setValidUntil] = useState(item.validUntil ?? "");
  const [status, setStatus] = useState(item.status);
  const [expectedVersion, setExpectedVersion] = useState(item.version);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setTitle(item.title); setReference(item.documentReference ?? ""); setValidUntil(item.validUntil ?? ""); setStatus(item.status); setExpectedVersion(item.version); setConflict(null);
  }, [item]);
  async function save() {
    const payload = { expectedVersion, title: title.trim(), documentReference: reference.trim() || null, validUntil: validUntil || null, status };
    const key = `qualification.update.${item.id}`;
    try {
      await v1(session, `/employees/${personId}/qualifications/${item.id}`, { ...payload, requestId: requestId(key, payload) }, "PUT");
      releaseRequest(key);
      setConflict(null);
      onChanged();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const server = await serverVersion(async () => {
          const page = await v1<Page<Qualification>>(session, pagePath(`/employees/${personId}/qualifications`, 0));
          return page.items.find((row) => row.id === item.id)?.version ?? null;
        });
        setConflict({ sent: expectedVersion, server, code: reason.message });
      } else setError(apiText(reason));
    }
  }
  return (
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p><b>{item.code}</b> · версия {expectedVersion} · {item.status === "active" ? "действует" : "отозвана"}</p>
      <label className="field"><span>Название</span><input value={title} disabled={!canManage || item.status === "revoked"} onChange={(event) => setTitle(event.target.value)} /></label>
      <label className="field"><span>Реквизиты</span><input value={reference} disabled={!canManage || item.status === "revoked"} onChange={(event) => setReference(event.target.value)} /></label>
      <label className="field"><span>До</span><input type="date" value={validUntil} disabled={!canManage || item.status === "revoked"} onChange={(event) => setValidUntil(event.target.value)} /></label>
      {canManage && item.status === "active" ? <label className="field"><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value as Qualification["status"])}><option value="active">Действует</option><option value="revoked">Отозвать</option></select></label> : null}
      {conflict ? <ConflictNote conflict={conflict} onTake={() => { if (conflict.server != null) { setExpectedVersion(conflict.server); setConflict(null); } }} /> : null}
      {error ? <p className="field-error">{error}</p> : null}
      {canManage && item.status === "active" ? <button className="ghost" type="submit">Сохранить квалификацию</button> : null}
      {item.status === "revoked" ? <p className="quiet">Отзыв окончательный. Продление — новая строка с тем же кодом.</p> : null}
    </form>
  );
}

function AdmissionPanel({ session, projectId, person, canManage }: { session: Session; projectId: string; person: V1Employee; canManage: boolean }) {
  const [template, setTemplate] = useState<AdmissionTemplate | null>(null);
  const [missing, setMissing] = useState(false);
  const [checks, setChecks] = useState<AdmissionCheck[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    setTemplate(null);
    setMissing(false);
    setChecks([]);
    void (async () => {
      try {
        const current = await v1<AdmissionTemplate>(session, `/projects/${projectId}/admission-template`, undefined, { signal: ac.signal });
        const page = await v1<Page<AdmissionCheck>>(session, pagePath(`/employees/${person.id}/admission-checks?projectId=${projectId}`, 0), undefined, { signal: ac.signal });
        if (ac.signal.aborted) return;
        setTemplate(current);
        setAnswers(Object.fromEntries(current.items.map((item) => [item.id, false])));
        setChecks(page.items);
      } catch (reason) {
        if (isAbort(reason)) return;
        if (reason instanceof ApiError && reason.status === 404) setMissing(true);
        else setError(apiText(reason));
      }
    })();
    return () => ac.abort();
  }, [session, projectId, person.id]);
  async function record() {
    if (!template || busy) return;
    const payload = { projectId, templateVersion: template.version, answers: template.items.map((item) => ({ itemId: item.id, value: answers[item.id] === true })) };
    const key = `admission.${person.id}.${template.version}`;
    setBusy(true);
    try {
      await v1(session, `/employees/${person.id}/admission-checks`, { ...payload, requestId: requestId(key, payload) });
      releaseRequest(key);
      const page = await v1<Page<AdmissionCheck>>(session, pagePath(`/employees/${person.id}/admission-checks?projectId=${projectId}`, 0));
      setChecks(page.items);
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409 ? `${reason.message}. Повторите проверку по текущему шаблону, версия сама не поднимается.` : apiText(reason));
    } finally { setBusy(false); }
  }
  const latest = checks[0];
  return (
    <div className="staff-form">
      <p className="quiet">Дата в локальной карточке допуск не заменяет. Здесь только ответы шаблона.</p>
      {missing ? <p>Шаблона допуска на объекте нет. Его задаёт руководитель в справочнике объекта.</p> : null}
      {template ? <p>{template.title}, версия {template.version}. Коды квалификаций: {template.requiredQualificationCodes.join(", ") || "не требуются"}.</p> : null}
      {latest ? <p>{latest.passed ? "Последняя проверка пройдена" : "Последняя проверка не пройдена"} · {latest.civilDate}. {latest.reasons.map(reasonLabel).join(" ")}</p> : null}
      {template && canManage ? template.items.map((item) => (
        <label className="check-row" key={item.id}>
          <input type="checkbox" checked={answers[item.id] === true} onChange={(event) => setAnswers((current) => ({ ...current, [item.id]: event.target.checked }))} />
          <span>{item.label}{item.critical ? " · критичный" : ""}</span>
        </label>
      )) : null}
      {canManage && template ? <button className="fill" type="button" disabled={busy} onClick={() => void record()}>{busy ? "Записываем…" : "Записать проверку"}</button> : null}
      {!canManage ? <p className="quiet">Запись чек-листа доступна руководителю.</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

function AssignmentPanel({
  session, projectId, person, assignment, admission, canManage, onChanged,
}: {
  session: Session;
  projectId: string;
  person: V1Employee;
  assignment?: Assignment;
  admission?: CurrentAdmission;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [expectedVersion, setExpectedVersion] = useState(assignment?.version ?? 0);
  const [latestCheck, setLatestCheck] = useState<string | null>(admission?.checkId ?? null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { setExpectedVersion(assignment?.version ?? 0); setLatestCheck(admission?.checkId ?? null); setConflict(null); }, [assignment, admission, person.id]);
  useEffect(() => {
    const ac = new AbortController();
    void v1<Page<AdmissionCheck>>(session, pagePath(`/employees/${person.id}/admission-checks?projectId=${projectId}`, 0), undefined, { signal: ac.signal })
      .then((page) => { if (!ac.signal.aborted && page.items[0]?.passed) setLatestCheck(page.items[0].id); })
      .catch(() => {});
    return () => ac.abort();
  }, [session, person.id, projectId]);
  const checkId = admission?.checkId ?? latestCheck;
  const eligible = Boolean(checkId) && admission?.eligible !== false;
  async function send(status: "active" | "revoked") {
    const payload = status === "active"
      ? { expectedVersion, status, admissionCheckId: checkId }
      : { expectedVersion, status };
    const key = `assignment.${projectId}.${person.id}.${status}`;
    try {
      await v1(session, `/projects/${projectId}/assignments/${person.id}`, { ...payload, requestId: requestId(key, payload) }, "PUT");
      releaseRequest(key);
      setConflict(null);
      onChanged();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        const server = await serverVersion(async () => {
          const page = await v1<Page<Assignment>>(session, pagePath(`/projects/${projectId}/assignments`, 0));
          return page.items.find((item) => item.employeeId === person.id)?.version ?? null;
        });
        setConflict({ sent: expectedVersion, server, code: reason.message });
      } else setError(apiText(reason));
    }
  }
  return (
    <div className="staff-form">
      <p>{assignment?.status === "active" ? "Назначение действует" : "На этот объект не назначен"}. Версия {expectedVersion || "ещё нет"}.</p>
      {admission ? <p>{admission.eligible ? "Допуск сейчас позволяет назначение." : "Назначение закрыто."} {admission.reasons.map(reasonLabel).join(" ")}</p> : <p className="quiet">Состояние допуска появится вместе со строкой назначения.</p>}
      {conflict ? <ConflictNote conflict={conflict} onTake={() => { if (conflict.server != null) { setExpectedVersion(conflict.server); setConflict(null); } }} /> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {canManage ? (
        <div className="panel-tools">
          <button className="fill" type="button" disabled={!eligible} onClick={() => void send("active")}>Назначить</button>
          <button className="ghost" type="button" disabled={!assignment} onClick={() => void send("revoked")}>Снять</button>
        </div>
      ) : <p className="quiet">Назначение меняет руководитель.</p>}
    </div>
  );
}

function Crews({ session, projectId, crews, employees, canManage, onChanged }: { session: Session; projectId: string; crews: Crew[]; employees: V1Employee[]; canManage: boolean; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function create() {
    const payload = { name: name.trim() };
    if (!payload.name) return;
    const key = `crew.${projectId}.${payload.name}`;
    try {
      await v1(session, `/projects/${projectId}/crews`, { ...payload, requestId: requestId(key, payload) });
      releaseRequest(key);
      setName("");
      setError("");
      onChanged();
    } catch (reason) { setError(apiText(reason)); }
  }
  return (
    <div className="staff-form">
      {crews.map((crew) => <CrewRow session={session} projectId={projectId} crew={crew} employees={employees} canManage={canManage} key={crew.id} onChanged={onChanged} />)}
      {!crews.length ? <p className="quiet">Бригад на объекте нет.</p> : null}
      {canManage ? (
        <div className="panel-tools">
          <label className="field"><span>Новая бригада</span><input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
          <button className="fill" type="button" onClick={() => void create()}>Создать</button>
        </div>
      ) : <p className="quiet">Состав бригады меняет руководитель.</p>}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

function CrewRow({ session, projectId, crew, employees, canManage, onChanged }: { session: Session; projectId: string; crew: Crew; employees: V1Employee[]; canManage: boolean; onChanged: () => void }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [error, setError] = useState("");
  async function put(memberId: string, status: "active" | "revoked", expectedVersion: number) {
    const payload = { expectedVersion, status };
    const key = `crew-member.${crew.id}.${memberId}.${status}`;
    try {
      await v1(session, `/projects/${projectId}/crews/${crew.id}/members/${memberId}`, { ...payload, requestId: requestId(key, payload) }, "PUT");
      releaseRequest(key);
      setError("");
      onChanged();
    } catch (reason) {
      setError(reason instanceof ApiError && reason.status === 409
        ? `${reason.message}. Состав не перезаписан, версия не увеличена.`
        : apiText(reason));
    }
  }
  const names = new Map(employees.map((item) => [item.id, item.fullName]));
  return (
    <article>
      <h3>{crew.name}</h3>
      {crew.members.filter((member) => member.status === "active").map((member) => (
        <p key={member.employeeId}>{names.get(member.employeeId) ?? "Сотрудник вне этой страницы списка"} · допуск {member.currentAdmission.eligible ? "открыт" : "закрыт"}
          {canManage ? <button className="ghost" type="button" onClick={() => void put(member.employeeId, "revoked", member.version)}>Убрать</button> : null}
        </p>
      ))}
      {canManage ? (
        <div className="panel-tools">
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {employees.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}
          </select>
          <button className="ghost" type="button" disabled={!employeeId} onClick={() => void put(employeeId, "active", crew.members.find((member) => member.employeeId === employeeId)?.version ?? 0)}>Добавить</button>
        </div>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </article>
  );
}

export function CatalogDesk({ session, projectId, canManage }: { session: Session; projectId: string; canManage: boolean }) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [types, setTypes] = useState<WorkType[]>([]);
  const [template, setTemplate] = useState<AdmissionTemplate | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!projectId) return;
    const ac = new AbortController();
    setZones([]);
    setTypes([]);
    setTemplate(null);
    void (async () => {
      try {
        const zonePage = await collectPages<Zone>(session, `/projects/${projectId}/zones`, ac.signal);
        const typePage = await collectPages<WorkType>(session, `/projects/${projectId}/work-types`, ac.signal);
        let current: AdmissionTemplate | null = null;
        try { current = await v1<AdmissionTemplate>(session, `/projects/${projectId}/admission-template`, undefined, { signal: ac.signal }); }
        catch (reason) { if (!(reason instanceof ApiError && reason.status === 404)) throw reason; }
        if (ac.signal.aborted) return;
        setZones(zonePage.items);
        setTypes(typePage.items);
        setTemplate(current);
        setError(zonePage.truncated || typePage.truncated ? "Показаны первые 2000 строк справочника." : "");
      } catch (reason) {
        if (!isAbort(reason)) setError(apiText(reason));
      }
    })();
    return () => ac.abort();
  }, [session, projectId, reload]);
  if (session.role === "worker") return <p className="quiet">Справочник объекта этому входу не показывается.</p>;
  return (
    <section className="panel">
      <h2>Справочник объекта</h2>
      <p className="quiet">Зоны, виды работ и шаблон допуска. Требования к материалам и ИД остаются включёнными: модуля, который их закрывает, ещё нет.</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <CatalogNames session={session} projectId={projectId} kind="zones" title="Зоны" rows={zones} canManage={canManage} onChanged={() => setReload((value) => value + 1)} />
      <WorkTypes session={session} projectId={projectId} rows={types} canManage={canManage} onChanged={() => setReload((value) => value + 1)} />
      <TemplateEditor session={session} projectId={projectId} template={template} canManage={canManage} onChanged={() => setReload((value) => value + 1)} />
    </section>
  );
}

function CatalogNames({ session, projectId, kind, title, rows, canManage, onChanged }: { session: Session; projectId: string; kind: "zones"; title: string; rows: Zone[]; canManage: boolean; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  async function create() {
    const payload = { name: name.trim() };
    if (!payload.name) return;
    const key = `${kind}.${projectId}.${payload.name}`;
    try {
      await v1(session, `/projects/${projectId}/${kind}`, { ...payload, requestId: requestId(key, payload) });
      releaseRequest(key);
      setName("");
      onChanged();
    } catch (reason) { setError(apiText(reason)); }
  }
  return (
    <div className="staff-form">
      <h3>{title}</h3>
      {rows.map((row) => <p key={row.id}>{row.name} · {row.status === "active" ? "активна" : "архив"} · версия {row.version}</p>)}
      {canManage ? <div className="panel-tools"><label className="field"><span>Название</span><input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label><button className="ghost" type="button" onClick={() => void create()}>Добавить</button></div> : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function WorkTypes({ session, projectId, rows, canManage, onChanged }: { session: Session; projectId: string; rows: WorkType[]; canManage: boolean; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("м2");
  const [requiresRd, setRequiresRd] = useState(true);
  const [requiresPredecessor, setRequiresPredecessor] = useState(true);
  const [error, setError] = useState("");
  async function create() {
    const payload = { name: name.trim(), unit: unit.trim(), requiresRd, requiresMaterialControl: true, requiresPredecessorAcceptance: requiresPredecessor, requiresId: true };
    if (!payload.name || !payload.unit) { setError("Нужны название и единица."); return; }
    const key = `work-type.${projectId}.${payload.name}`;
    try {
      await v1(session, `/projects/${projectId}/work-types`, { ...payload, requestId: requestId(key, payload) });
      releaseRequest(key);
      setName("");
      onChanged();
    } catch (reason) { setError(apiText(reason)); }
  }
  return (
    <div className="staff-form">
      <h3>Виды работ</h3>
      {rows.map((row) => <p key={row.id}>{row.name}, {row.unit}. Материалы {row.requiresMaterialControl ? "блокируют" : "на сервере выключены"}, ИД {row.requiresId ? "блокирует" : "на сервере выключен"}.</p>)}
      {canManage ? (
        <>
          <label className="field"><span>Название</span><input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
          <label className="field"><span>Единица</span><input value={unit} maxLength={40} onChange={(event) => setUnit(event.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={requiresRd} onChange={(event) => setRequiresRd(event.target.checked)} /><span>Нужна рабочая документация</span></label>
          <label className="check-row"><input type="checkbox" checked={requiresPredecessor} onChange={(event) => setRequiresPredecessor(event.target.checked)} /><span>Нужна приёмка предшественника</span></label>
          <p className="quiet">Контроль материалов и ИД включены и этой формой не снимаются.</p>
          <button className="ghost" type="button" onClick={() => void create()}>Добавить вид работ</button>
        </>
      ) : null}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function TemplateEditor({ session, projectId, template, canManage, onChanged }: { session: Session; projectId: string; template: AdmissionTemplate | null; canManage: boolean; onChanged: () => void }) {
  const [code, setCode] = useState(template?.code ?? "admission");
  const [title, setTitle] = useState(template?.title ?? "");
  const [codes, setCodes] = useState(template?.requiredQualificationCodes.join(", ") ?? "");
  const [items, setItems] = useState(template?.items ?? [{ id: "briefing", label: "Инструктаж проведён", critical: true }]);
  const [expectedVersion, setExpectedVersion] = useState(template?.version ?? 0);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setCode(template?.code ?? "admission");
    setTitle(template?.title ?? "");
    setCodes(template?.requiredQualificationCodes.join(", ") ?? "");
    setItems(template?.items ?? [{ id: "briefing", label: "Инструктаж проведён", critical: true }]);
    setExpectedVersion(template?.version ?? 0);
    setConflict(null);
  }, [template]);
  async function save() {
    const payload = {
      code: code.trim(),
      title: title.trim(),
      items: items.filter((item) => item.id.trim() && item.label.trim()).map((item) => ({ id: item.id.trim(), label: item.label.trim(), critical: item.critical })),
      requiredQualificationCodes: codes.split(",").map((item) => item.trim()).filter(Boolean),
    };
    if (!payload.title || !payload.items.length) { setError("Нужны название и хотя бы один пункт."); return; }
    const key = `template.${projectId}`;
    try {
      if (template) {
        const { code: _code, ...rest } = payload;
        const body = { ...rest, expectedVersion };
        await v1(session, `/projects/${projectId}/admission-template`, { ...body, requestId: requestId(key, body) }, "PUT");
      } else {
        await v1(session, `/projects/${projectId}/admission-template`, { ...payload, requestId: requestId(key, payload) });
      }
      releaseRequest(key);
      setConflict(null);
      onChanged();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && template) {
        const server = await serverVersion(async () => (await v1<AdmissionTemplate>(session, `/projects/${projectId}/admission-template`)).version);
        setConflict({ sent: expectedVersion, server, code: reason.message });
      } else setError(apiText(reason));
    }
  }
  return (
    <div className="staff-form">
      <h3>Шаблон допуска {template ? `· версия ${expectedVersion}` : ""}</h3>
      <p className="quiet">Новая версия делает прошлый допуск недействительным, пока проверка не записана заново. Пункты — только да или нет.</p>
      {canManage ? (
        <>
          <label className="field"><span>Код</span><input value={code} maxLength={80} disabled={Boolean(template)} onChange={(event) => setCode(event.target.value)} /></label>
          <label className="field"><span>Название</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="field"><span>Коды квалификаций через запятую</span><input value={codes} onChange={(event) => setCodes(event.target.value)} /></label>
          {items.map((item, index) => (
            <div className="panel-tools" key={`${item.id}-${index}`}>
              <input aria-label="Код пункта" value={item.id} maxLength={80} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, id: event.target.value } : row))} />
              <input aria-label="Текст пункта" value={item.label} maxLength={500} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))} />
              <label className="check-row"><input type="checkbox" checked={item.critical} onChange={(event) => setItems((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, critical: event.target.checked } : row))} /><span>Критичный</span></label>
            </div>
          ))}
          <button className="ghost" type="button" onClick={() => setItems((current) => [...current, { id: "", label: "", critical: false }])}>Пункт</button>
          {conflict ? <ConflictNote conflict={conflict} onTake={() => { if (conflict.server != null) { setExpectedVersion(conflict.server); setConflict(null); } }} /> : null}
          <button className="fill" type="button" onClick={() => void save()}>{template ? "Опубликовать новую версию" : "Создать шаблон"}</button>
        </>
      ) : template ? <p>{template.title}. Пунктов: {template.items.length}.</p> : <p className="quiet">Шаблона нет.</p>}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
