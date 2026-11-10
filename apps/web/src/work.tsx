import { useEffect, useState } from "react";
import type { Session } from "./api";
import { DeskBadge, DeskEmpty, DeskStepper } from "./kit";
import { reasonLabel, useCabinetScope } from "./staff";
import {
  ApiError,
  apiText,
  civilInstant,
  clockIn,
  collectPages,
  isAbort,
  releaseRequest,
  requestId,
  v1,
  type FrontCheck,
  type FrontTemplate,
  type ProjectMembership,
  type Readiness,
  type V1Employee,
  type V1Task,
  type WorkType,
  type Zone,
} from "./v1";

const planName: Record<string, string> = {
  draft: "Черновик",
  pending_approval: "На согласовании",
  published: "Опубликовано",
  cancelled: "Отменено",
};
const executionName: Record<string, string> = {
  in_progress: "Смена на сервере начата",
  submitted: "Объём сдан на сервере",
  in_review: "Объём на проверке",
  accepted: "Объём принят на сервере",
  partially_accepted: "Объём принят частично",
  needs_fix: "Нужна переделка",
  suspended: "Работа приостановлена",
  closed: "Работа закрыта",
};
const blockName: Record<string, string> = {
  material_control_unsupported: "Контроль материалов для этого вида ещё не поддерживается. Публикация закрыта.",
  predecessor_acceptance_unsupported: "Приёмка предшественника для этого вида ещё не поддерживается. Публикация закрыта.",
  id_unsupported: "Исполнительная документация для этого вида ещё не поддерживается. Публикация закрыта.",
  front_missing: "Чек-лист фронта ещё не записан",
  front_failed: "Чек-лист фронта не пройден",
  front_template_changed: "Шаблон фронта изменился, нужна новая проверка",
  front_plan_changed: "План изменился после проверки фронта",
  front_catalog_changed: "Зона или вид работ изменились после проверки фронта",
  assignment_inactive: "Нет действующего производственного назначения",
  employee_unlinked: "У сотрудника нет входа в кабинет",
  employee_member_inactive: "Вход сотрудника в кабинет не активен",
  employee_project_inactive: "У сотрудника нет доступа к этому объекту",
  responsible_inactive: "Ответственный не может вести этот объект",
  rd_required: "Нужна ссылка на рабочую документацию",
  task_not_ready: "Сервер не публикует: готовность не пройдена",
  stale_version: "Запись уже изменил другой человек",
  invalid_task_state: "Это действие не подходит текущему состоянию",
  assignment_overlap: "У сотрудника уже есть опубликованное задание на это время",
  front_template_required: "Сначала нужен шаблон фронта",
};

async function optionalPage<T>(session: Session, path: string, signal: AbortSignal) {
  try { return await collectPages<T>(session, path, signal); }
  catch (reason) {
    if (reason instanceof ApiError && reason.status === 403) return { items: [] as T[], total: 0, truncated: false };
    throw reason;
  }
}

function makeFrontTemplate(session: Session, projectId: string) {
  const payload = { code: "front", title: "Фронт работ", items: [{ id: "front", label: "Фронт готов к работе", critical: true }] };
  const key = `front-template.${projectId}`;
  return v1(session, `/projects/${projectId}/front-template`, { ...payload, requestId: requestId(key, payload) }, "POST").then((result) => {
    releaseRequest(key);
    return result;
  });
}

function explain(code: string) {
  if (blockName[code]) return blockName[code];
  if (code.startsWith("admission:")) return `Допуск: ${reasonLabel(code.slice("admission:".length))}`;
  return reasonLabel(code);
}

function failText(error: unknown) {
  if (error instanceof ApiError && blockName[error.message]) return blockName[error.message];
  return apiText(error);
}

export function TaskDesk({
  session, projectId, day, timeZone, canPrepare, canDirect,
}: {
  session: Session;
  projectId: string;
  day: string;
  timeZone: string;
  canPrepare: boolean;
  canDirect: boolean;
}) {
  const [tasks, setTasks] = useState<V1Task[] | null>(null);
  const [people, setPeople] = useState<V1Employee[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [types, setTypes] = useState<WorkType[]>([]);
  const [members, setMembers] = useState<ProjectMembership[]>([]);
  const [template, setTemplate] = useState<FrontTemplate | null>(null);
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const staffPath = session.role === "director" ? "/employees" : `/employees?projectId=${projectId}`;
        const list = await collectPages<V1Task>(session, `/projects/${projectId}/tasks?workDate=${day}`, ac.signal);
        const staff = await optionalPage<V1Employee>(session, staffPath, ac.signal);
        const zonePage = await optionalPage<Zone>(session, `/projects/${projectId}/zones`, ac.signal);
        const typePage = await optionalPage<WorkType>(session, `/projects/${projectId}/work-types`, ac.signal);
        let access: ProjectMembership[] = [];
        if (session.role === "director") {
          access = (await collectPages<ProjectMembership>(session, `/projects/${projectId}/memberships`, ac.signal)).items;
        }
        let front: FrontTemplate | null = null;
        try { front = await v1<FrontTemplate>(session, `/projects/${projectId}/front-template`, undefined, { signal: ac.signal }); }
        catch (reason) { if (!(reason instanceof ApiError && (reason.status === 404 || reason.status === 403))) throw reason; }
        if (ac.signal.aborted) return;
        setTasks(list.items);
        setPeople(staff.items);
        setZones(zonePage.items.filter((item) => item.status === "active"));
        setTypes(typePage.items.filter((item) => item.status === "active"));
        setMembers(access.filter((item) => item.status === "active" && (item.role === "director" || item.role === "master")));
        setTemplate(front);
        setError(list.truncated ? "Показаны первые 2000 заданий." : "");
      } catch (reason) {
        if (!isAbort(reason)) setError(apiText(reason));
      }
    })();
    return () => ac.abort();
  }, [session, projectId, day, tick]);
  const needle = query.trim().toLowerCase();
  const visible = (tasks ?? []).filter((task) => !needle || task.title.toLowerCase().includes(needle));
  const nameOf = (id: string) => people.find((item) => item.id === id)?.fullName ?? "Сотрудник";
  return (
    <section className="staff">
      <div className="staff-list">
        <h1>Задания</h1>
        <p className="quiet">План на {day}. Смена и приёмка качества этим списком не запускаются.</p>
        {canDirect && !template && tasks ? <button className="ghost" type="button" onClick={() => void makeFrontTemplate(session, projectId).then(() => setTick((value) => value + 1)).catch((reason) => setError(failText(reason)))}>Создать шаблон фронта</button> : null}
        <label className="field"><span>Поиск</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        {tasks === null && !error ? <p className="quiet">Загружаем задания.</p> : null}
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {tasks && visible.length === 0 ? <DeskEmpty title={tasks.length === 0 ? "На этот день заданий нет" : "Такого задания нет"} description={tasks.length === 0 ? "Черновик появится в списке после сохранения." : "Измените поиск."} /> : null}
        {canPrepare ? <button className={selected === "new" ? "staff-row is-on" : "staff-row"} type="button" onClick={() => setSelected("new")}>Новое задание</button> : null}
        {visible.map((task) => (
          <button className={selected === task.id ? "staff-row is-on" : "staff-row"} type="button" key={task.id} onClick={() => setSelected(task.id)}>
            <b>{task.title}</b>
            <span className="quiet">{nameOf(task.assigneeEmployeeId)} · {planName[task.status] ?? task.status}</span>
          </button>
        ))}
      </div>
      {selected === "new" ? (
        <TaskEditor key="new" session={session} projectId={projectId} day={day} timeZone={timeZone} task={null} people={people} zones={zones} types={types} members={members} template={template} canPrepare={canPrepare} canDirect={canDirect} onChanged={(id) => { if (id) setSelected(id); setTick((value) => value + 1); }} onTemplate={() => setTick((value) => value + 1)} />
      ) : selected ? (
        <TaskEditor key={selected} session={session} projectId={projectId} day={day} timeZone={timeZone} taskId={selected} people={people} zones={zones} types={types} members={members} template={template} canPrepare={canPrepare} canDirect={canDirect} onChanged={() => setTick((value) => value + 1)} onTemplate={() => setTick((value) => value + 1)} />
      ) : <div className="panel"><p className="quiet">Выберите задание. Карточка остаётся на этой странице.</p></div>}
    </section>
  );
}

export function WorkerTasks({ session }: { session: Session }) {
  const scope = useCabinetScope(session);
  if (!scope.projectId || !scope.day) return <p className="quiet">{scope.loading ? "Загружаем объект." : scope.error || "Нет доступного объекта."}</p>;
  return <TaskDesk session={session} projectId={scope.projectId} day={scope.day} timeZone={scope.timezone || "Europe/Moscow"} canPrepare={false} canDirect={false} />;
}

function TaskEditor({
  session, projectId, day, timeZone, task, taskId, people, zones, types, members, template, canPrepare, canDirect, onChanged, onTemplate,
}: {
  session: Session;
  projectId: string;
  day: string;
  timeZone: string;
  task?: V1Task | null;
  taskId?: string;
  people: V1Employee[];
  zones: Zone[];
  types: WorkType[];
  members: ProjectMembership[];
  template: FrontTemplate | null;
  canPrepare: boolean;
  canDirect: boolean;
  onChanged: (id?: string) => void;
  onTemplate: () => void;
}) {
  const [current, setCurrent] = useState<V1Task | null>(task ?? null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [check, setCheck] = useState<FrontCheck | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reset, setReset] = useState(0);
  useEffect(() => {
    if (!taskId) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const row = await v1<V1Task>(session, `/projects/${projectId}/tasks/${taskId}`, undefined, { signal: ac.signal });
        let ready: Readiness | null = null;
        let latest: FrontCheck | null = null;
        if (row.workflowKind === "managed02b" && session.role !== "worker") {
          ready = await v1<Readiness>(session, `/projects/${projectId}/tasks/${taskId}/readiness`, undefined, { signal: ac.signal });
          const page = await v1<{ items: FrontCheck[] }>(session, `/projects/${projectId}/tasks/${taskId}/front-checks?limit=1&offset=0`, undefined, { signal: ac.signal });
          latest = page.items[0] ?? null;
        }
        if (ac.signal.aborted) return;
        setCurrent(row);
        setReadiness(ready);
        setCheck(latest);
      } catch (reason) {
        if (!isAbort(reason)) setLoadError(apiText(reason));
      }
    })();
    return () => ac.abort();
  }, [session, projectId, taskId, reset]);
  if (taskId && !current && !loadError) return <div className="panel"><p className="quiet">Загружаем карточку.</p></div>;
  if (loadError) return <div className="panel"><p className="alert" role="alert">{loadError}</p></div>;
  return (
    <EditorBody
      key={`${current?.id ?? "new"}:${current?.version ?? 0}:${reset}`}
      session={session}
      projectId={projectId}
      day={day}
      timeZone={timeZone}
      task={current}
      people={people}
      zones={zones}
      types={types}
      members={members}
      template={template}
      readiness={readiness}
      check={check}
      canPrepare={canPrepare}
      canDirect={canDirect}
      onChanged={onChanged}
      onTemplate={onTemplate}
      onReload={() => setReset((value) => value + 1)}
    />
  );
}

function EditorBody({
  session, projectId, day, timeZone, task, people, zones, types, members, template, readiness, check, canPrepare, canDirect, onChanged, onTemplate, onReload,
}: {
  session: Session;
  projectId: string;
  day: string;
  timeZone: string;
  task: V1Task | null;
  people: V1Employee[];
  zones: Zone[];
  types: WorkType[];
  members: ProjectMembership[];
  template: FrontTemplate | null;
  readiness: Readiness | null;
  check: FrontCheck | null;
  canPrepare: boolean;
  canDirect: boolean;
  onChanged: (id?: string) => void;
  onTemplate: () => void;
  onReload: () => void;
}) {
  const managed = !task || task.workflowKind === "managed02b";
  const editable = canPrepare && managed && (!task || task.status === "draft");
  const [zoneId, setZoneId] = useState(task?.zoneId ?? zones[0]?.id ?? "");
  const [workTypeId, setWorkTypeId] = useState(task?.workTypeId ?? types[0]?.id ?? "");
  const [title, setTitle] = useState(task?.title ?? "");
  const [date, setDate] = useState(task?.workDate ?? day);
  const [start, setStart] = useState(task?.plannedStart ? clockIn(task.plannedStart, timeZone) : "09:00");
  const [end, setEnd] = useState(task?.plannedEnd ? clockIn(task.plannedEnd, timeZone) : "18:00");
  const [quantity, setQuantity] = useState(task ? String(Number(task.plannedQuantity)) : "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeEmployeeId ?? "");
  const [responsibleId, setResponsibleId] = useState(task?.responsibleUserId ?? (session.role === "director" || session.role === "master" ? session.userId : ""));
  const [rd, setRd] = useState(task?.rdReference ?? "");
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState<{ sent: number; server: number; title: string } | null>(null);
  const workType = types.find((item) => item.id === workTypeId);
  const zoneName = zones.find((item) => item.id === (task?.zoneId ?? zoneId))?.name;
  const responsibles = [
    ...(session.role === "director" || session.role === "master" ? [{ id: session.userId, label: session.name }] : []),
    ...members.filter((item) => item.userId !== session.userId).map((item) => ({ id: item.userId, label: people.find((person) => person.userId === item.userId)?.fullName ?? (item.role === "master" ? "Прораб" : "Руководитель") })),
  ];
  const step = !task || task.status === "draft" || task.status === "cancelled" ? 0 : task.status === "pending_approval" ? 1 : 2;
  const returned = task ? sessionStorage.getItem(`helios.task-reason.${task.id}`) : "";

  async function command<T>(path: string, payload: object, key: string, method: string) {
    return v1<T>(session, path, { ...payload, requestId: requestId(key, payload) }, method);
  }

  async function save() {
    const plannedQuantity = quantity.trim().replace(",", ".");
    if (!zoneId || !workTypeId || !title.trim() || !assigneeId || !responsibleId) { setError("Заполните зону, вид работ, название, исполнителя и ответственного."); return; }
    if (!/^\d{1,11}(?:\.\d{1,3})?$/.test(plannedQuantity) || !/[1-9]/.test(plannedQuantity)) { setError("Объём — число больше нуля, до трёх знаков после точки."); return; }
    if (start >= end) { setError("Окончание позже начала, в тот же гражданский день."); return; }
    if (workType?.requiresRd && !rd.trim()) { setError("Для этого вида нужна ссылка на рабочую документацию."); return; }
    const payload = {
      zoneId, workTypeId, title: title.trim(), workDate: date, plannedQuantity, assigneeEmployeeId: assigneeId, responsibleUserId: responsibleId,
      plannedStart: civilInstant(date, start, timeZone), plannedEnd: civilInstant(date, end, timeZone), rdReference: rd.trim() || null,
      ...(task ? { expectedVersion: task.version } : {}),
    };
    const key = task ? `task.${task.id}.save` : `task.${projectId}.create.${JSON.stringify(payload)}`;
    setBusy(task ? "Сохраняем…" : "Создаём черновик…");
    setError("");
    setNote("");
    try {
      const saved = await command<V1Task>(task ? `/projects/${projectId}/tasks/${task.id}` : `/projects/${projectId}/tasks`, payload, key, task ? "PUT" : "POST");
      releaseRequest(key);
      setNote("Черновик сохранён.");
      onChanged(saved.id);
      onReload();
    } catch (reason) {
      if (task && reason instanceof ApiError && reason.status === 409 && reason.message === "stale_version") {
        const fresh = await v1<V1Task>(session, `/projects/${projectId}/tasks/${task.id}`);
        setConflict({ sent: task.version, server: fresh.version, title: fresh.title });
      } else setError(failText(reason));
    } finally { setBusy(""); }
  }

  async function act(action: "submit" | "publish" | "reject" | "reopen" | "cancel" | "front") {
    if (!task) return;
    if (action === "front" && !template) return;
    if ((action === "reject" || action === "reopen" || action === "cancel") && !reason.trim()) { setError("Напишите причину."); return; }
    const payload = action === "front"
      ? { expectedVersion: task.version, templateVersion: template?.version, answers: template?.items.map((item) => ({ itemId: item.id, value: Boolean(marks[item.id]) })) ?? [] }
      : { expectedVersion: task.version, ...((action === "reject" || action === "reopen" || action === "cancel") ? { reason: reason.trim() } : {}) };
    const key = `task.${task.id}.${action}`;
    setBusy("Отправляем…");
    setError("");
    setNote("");
    try {
      await command(action === "front" ? `/projects/${projectId}/tasks/${task.id}/front-checks` : `/projects/${projectId}/tasks/${task.id}/${action}`, payload, key, "POST");
      releaseRequest(key);
      if (action === "reject" || action === "reopen" || action === "cancel") sessionStorage.setItem(`helios.task-reason.${task.id}`, reason.trim());
      setNote(action === "publish" ? "Задание опубликовано." : action === "submit" ? "Отправлено на согласование." : action === "front" ? "Чек-лист записан." : "Состояние обновлено.");
      onChanged(task.id);
      onReload();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.message === "stale_version") {
        const fresh = await v1<V1Task>(session, `/projects/${projectId}/tasks/${task.id}`);
        setConflict({ sent: task.version, server: fresh.version, title: fresh.title });
      } else setError(failText(reason));
    } finally { setBusy(""); }
  }

  async function makeTemplate() {
    setBusy("Сохраняем шаблон…");
    try {
      await makeFrontTemplate(session, projectId);
      setNote("Шаблон фронта создан.");
      onTemplate();
    } catch (reason) { setError(failText(reason)); }
    finally { setBusy(""); }
  }

  return (
    <div className="panel staff-card">
      <h2>{task?.title ?? "Новое задание"}</h2>
      {task && managed && task.status !== "cancelled" ? <DeskStepper label="План задания" current={step} done={[step > 0, step > 1, false]} steps={[{ label: "Черновик" }, { label: "Согласование" }, { label: "Опубликовано" }]} /> : null}
      {task?.status === "cancelled" ? <DeskBadge tone="warn">Отменено</DeskBadge> : null}
      {task && executionName[task.status] ? <p className="quiet">{executionName[task.status]}. Этот экран смену и приёмку не выполняет.</p> : null}
      {!managed && task ? <p className="quiet">Прежняя запись кабинета. Новый план для неё не собирается.</p> : null}
      <p className="quiet">Одно задание назначается одному сотруднику. Бригада целиком исполнителем не ставится.</p>
      {editable || !task ? (
        <div className="staff-form">
          <label className="field"><span>Зона</span><select value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{zones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Вид работ</span><select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)}>{types.map((item) => <option key={item.id} value={item.id}>{item.name}, {item.unit}</option>)}</select></label>
          {workType?.requiresMaterialControl ? <p className="staff-note">Контроль материалов для этого вида сервер ещё не закрывает.</p> : null}
          {workType?.requiresPredecessorAcceptance ? <p className="staff-note">Приёмка предшественника для этого вида сервер ещё не закрывает.</p> : null}
          {workType?.requiresId ? <p className="staff-note">Исполнительная документация для этого вида сервер ещё не закрывает.</p> : null}
          <label className="field"><span>Название</span><input value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="field"><span>Дата</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="field"><span>Начало</span><input type="time" value={start} onChange={(event) => setStart(event.target.value)} /></label>
          <label className="field"><span>Окончание</span><input type="time" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
          <label className="field"><span>Объём, {workType?.unit ?? task?.unit ?? "единица вида работ"}</span><input value={quantity} inputMode="decimal" onChange={(event) => setQuantity(event.target.value)} /></label>
          <label className="field"><span>Исполнитель</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Не выбран</option>{people.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
          <label className="field"><span>Ответственный</span><select value={responsibleId} onChange={(event) => setResponsibleId(event.target.value)}>{responsibles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="field"><span>Рабочая документация{workType?.requiresRd ? "" : ", если нужна"}</span><input value={rd} maxLength={500} onChange={(event) => setRd(event.target.value)} /></label>
          <button className="fill" type="button" disabled={Boolean(busy)} onClick={() => void save()}>{busy || (task ? "Сохранить черновик" : "Создать черновик")}</button>
        </div>
      ) : task ? (
        <dl className="kv">
          {zoneName ? <div><dt>Зона</dt><dd>{zoneName}</dd></div> : null}
          {workType ? <div><dt>Вид</dt><dd>{workType.name}, {task.unit}</dd></div> : null}
          <div><dt>Дата</dt><dd>{task.workDate}</dd></div>
          <div><dt>Время</dt><dd>{task.plannedStart ? `${clockIn(task.plannedStart, timeZone)}–${clockIn(task.plannedEnd ?? task.plannedStart, timeZone)}` : "—"}</dd></div>
          <div><dt>Объём</dt><dd>{task.plannedQuantity} {task.unit}</dd></div>
          <div><dt>Исполнитель</dt><dd>{people.find((item) => item.id === task.assigneeEmployeeId)?.fullName ?? "—"}</dd></div>
          <div><dt>Документация</dt><dd>{task.rdReference || "не указана"}</dd></div>
        </dl>
      ) : null}
      {task && managed && !canPrepare && !canDirect ? <p className="quiet">Опубликованный план. Смена и приёмка с этого экрана не начинаются.</p> : null}
      {task && managed && (canPrepare || canDirect) ? (
        <>
          <h3>Готовность</h3>
          {readiness ? <p role="status">{readiness.ready ? "Сервер разрешает публикацию." : "Сервер публикацию пока запрещает."}</p> : <p className="quiet">Готовность ещё не получена.</p>}
          {readiness?.reasons.map((code) => <p className="staff-note" key={code}>{explain(code)}</p>)}
          {readiness?.warnings.map((code) => <p className="quiet" key={code}>{explain(code)}</p>)}
          {canDirect && !template ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void makeTemplate()}>Создать шаблон фронта</button> : null}
          {(canPrepare || canDirect) && !template ? <p className="quiet">Шаблона фронта нет. Его создаёт руководитель.</p> : null}
          {template && canPrepare && (task.status === "draft" || task.status === "pending_approval") ? (
            <div className="staff-form">
              {template.items.map((item) => (
                <label className="check-row" key={item.id}><input type="checkbox" checked={Boolean(marks[item.id])} onChange={(event) => setMarks((currentMarks) => ({ ...currentMarks, [item.id]: event.target.checked }))} /><span>{item.label}{item.critical ? " · критичный" : ""}</span></label>
              ))}
              <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void act("front")}>Записать чек-лист</button>
            </div>
          ) : null}
          {check ? <p className="quiet">{readiness?.reasons.some((code) => code === "front_plan_changed" || code === "front_template_changed" || code === "front_catalog_changed") ? "Записанный чек-лист к текущему плану не подходит." : check.passed ? "Последний чек-лист пройден." : "Последний чек-лист не пройден."}</p> : null}
          {returned ? <p className="staff-note">Причина прошлого возврата: {returned}</p> : null}
          <div className="panel-tools">
            {canPrepare && task.status === "draft" ? <button className="fill" type="button" disabled={Boolean(busy)} onClick={() => void act("submit")}>На согласование</button> : null}
            {canDirect && task.status === "pending_approval" ? <button className="fill" type="button" disabled={Boolean(busy)} onClick={() => void act("publish")}>Опубликовать</button> : null}
            {canPrepare && task.status === "pending_approval" ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void act("reopen")}>Вернуть в черновик</button> : null}
            {canDirect && task.status === "pending_approval" ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void act("reject")}>Вернуть с причиной</button> : null}
            {((canDirect && ["draft", "pending_approval", "published"].includes(task.status)) || (canPrepare && !canDirect && ["draft", "pending_approval"].includes(task.status))) ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => void act("cancel")}>Отменить</button> : null}
          </div>
          {canPrepare && ["pending_approval", "draft", "published"].includes(task.status) ? <label className="field"><span>Причина возврата или отмены</span><input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label> : null}
        </>
      ) : null}
      {conflict ? (
        <div className="staff-note">
          <p>Вы отправили версию {conflict.sent}. На сервере уже версия {conflict.server}: «{conflict.title}». Запись другого человека не заменена.</p>
          <button className="ghost" type="button" onClick={() => { setConflict(null); onChanged(); onReload(); }}>Взять версию {conflict.server}</button>
        </div>
      ) : null}
      {note ? <p className="quiet" role="status">{note}</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}
