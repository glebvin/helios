import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { reasonLabel } from "./staff";
import {
  ApiError, apiText, collectPages, isAbort, v1,
  type Assignment, type OverviewClock, type V1Employee, type V1Project, type V1Task,
} from "./v1";
import {
  captureGeo, commitShiftDrafts, decimalQuantity, deliverShiftQueue, deliveryLabel, failureLabel,
  isShiftEvent, prepareDrafts, preparePhoto, queueCode, readShiftRows, retryShiftRow, rowLabel,
  shiftStorage, showQuantity, thousandths, versionHead,
  type GeoAttempt, type GeoCapture, type ShiftDraft, type ShiftRow,
} from "./shift-queue";
import type { EventPayload, EvidenceInput } from "@helios/offline";
import { OwnDayStatus } from "./timesheet";

type ShiftRowServer = {
  id: string;
  projectId: string;
  employeeId: string;
  startedAt: string;
  endedAt: string | null;
  startEvent: { requestId: string; occurredAt: string; reviewFlags?: { geoTimeMismatch?: boolean } } | null;
  endEvent: { requestId: string; occurredAt: string; reviewFlags?: { geoTimeMismatch?: boolean } } | null;
};
type Segment = {
  id: string;
  shiftId: string;
  employeeId: string;
  mode: "idle" | "work" | "break" | "downtime";
  taskId: string | null;
  reasonCode: string | null;
  comment: string | null;
  startedAt: string;
  endedAt: string | null;
};
type Report = {
  reportId: string;
  employeeId: string;
  shiftId: string;
  taskId: string;
  submittedQuantity: string;
  unit: string;
  acceptedQuantity: null;
  reviewFlags?: { abovePlannedQuantity?: boolean };
};
type EvidenceFile = {
  id: string;
  employeeId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  state: string;
  reservedAt: string;
  attachment: { target: { kind: string; requestId?: string; reportId?: string } } | null;
};
type Span = {
  shiftId: string;
  mode: Segment["mode"];
  taskId: string | null;
  reasonCode: string | null;
  startedAt: string;
  endedAt: string | null;
  local: boolean;
};
type LocalPhoto = {
  fileId: string;
  reserveRequestId: string;
  attachRequestId: string;
  blob: Blob;
  filename: string;
  contentType: "image/jpeg" | "image/png";
  url: string;
};
type DayData = {
  employee: V1Employee | null;
  projects: V1Project[];
  projectId: string;
  day: string;
  timeZone: string;
  assignment: Assignment | null;
  shifts: ShiftRowServer[];
  segments: Segment[];
  tasks: V1Task[];
  zones: Map<string, string>;
  reports: Report[];
  rows: ShiftRow[];
  version: number;
  totals: { presenceMs: string; idleMs: string; workMs: string; breakMs: string; downtimeMs: string };
  error: string;
};

const downtimeLabels = {
  materials: "Материалы",
  equipment: "Оборудование",
  front: "Фронт не готов",
  safety: "Безопасность",
  weather: "Погода",
  other: "Другое",
} as const;

function admissionText(code: string) {
  const named: Record<string, string> = {
    employee_archived: "Карточка сотрудника закрыта",
    no_check: "Чек-лист допуска ещё не записан",
    check_failed: "Чек-лист допуска не пройден",
    not_latest_check: "Назначение указывает не на последнюю проверку",
    template_changed: "Шаблон допуска изменился после проверки",
  };
  return named[code] ?? reasonLabel(code);
}

function clock(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(iso));
}

function civilOf(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
}

function duration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} ч ${minutes % 60} мин` : `${minutes} мин`;
}

async function optionalList<T>(session: Session, path: string, signal: AbortSignal) {
  try {
    return await collectPages<T>(session, path, signal);
  } catch (error) {
    if (isAbort(error)) throw error;
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return { items: [] as T[], total: 0, truncated: false };
    throw error;
  }
}

function spansOf(shiftId: string, segments: Segment[], rows: ShiftRow[]): Span[] {
  const spans: Span[] = segments.filter((item) => item.shiftId === shiftId).map((item) => ({
    shiftId, mode: item.mode, taskId: item.taskId, reasonCode: item.reasonCode, startedAt: item.startedAt, endedAt: item.endedAt, local: false,
  }));
  const extras = rows.filter(isShiftEvent).filter((row) => row.state !== "synced" && row.event.shiftId === shiftId && row.event.kind !== "submit_volume")
    .sort((a, b) => a.event.expectedVersion - b.event.expectedVersion);
  for (const row of extras) {
    const event = row.event;
    const open = [...spans].reverse().find((item) => !item.endedAt);
    if (event.kind === "shift_start") {
      spans.push({ shiftId, mode: "idle", taskId: null, reasonCode: null, startedAt: event.occurredAt, endedAt: null, local: true });
    } else if (open && event.kind === "shift_end") {
      open.endedAt = event.occurredAt;
    } else if (open && event.kind === "segment_change") {
      open.endedAt = event.occurredAt;
      spans.push({
        shiftId,
        mode: event.mode,
        taskId: event.mode === "work" ? event.taskId : event.mode === "downtime" ? event.taskId ?? null : null,
        reasonCode: event.mode === "downtime" ? event.reasonCode : null,
        startedAt: event.occurredAt,
        endedAt: null,
        local: true,
      });
    }
  }
  return spans;
}

function photoEvidence(event: EventPayload, photo: LocalPhoto, actorUserId: string, reportId?: string): EvidenceInput {
  return {
    projectId: event.projectId,
    employeeId: event.employeeId,
    filename: photo.filename,
    contentType: photo.contentType,
    blob: photo.blob,
    dependencyRequestId: event.requestId,
    target: reportId ? { kind: "final_report", reportId } : { kind: "execution_event", actorUserId, requestId: event.requestId },
    fileId: photo.fileId,
    reserveRequestId: photo.reserveRequestId,
    attachRequestId: photo.attachRequestId,
  };
}

function newPhoto(blob: Blob, filename: string, contentType: LocalPhoto["contentType"]): LocalPhoto {
  return {
    fileId: crypto.randomUUID(),
    reserveRequestId: crypto.randomUUID(),
    attachRequestId: crypto.randomUUID(),
    blob, filename, contentType, url: URL.createObjectURL(blob),
  };
}

export function WorkerShift({
  session, theme, onTheme, onLogout, preview = false,
}: {
  session: Session;
  theme: "light" | "dark";
  onTheme: () => void;
  onLogout: () => void;
  preview?: boolean;
}) {
  const [tab, setTab] = useState<"day" | "tasks" | "profile">("day");
  const [planDay, setPlanDay] = useState("");
  const [projectChoice, setProjectChoice] = useState("");
  const [data, setData] = useState<DayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const reduce = useReducedMotion();

  async function reload(signal?: AbortSignal) {
    const ac = signal ? null : new AbortController();
    const used = signal ?? ac!.signal;
    try {
      const people = await collectPages<V1Employee>(session, "/employees", used);
      const employee = people.items.find((item) => item.userId === session.userId) ?? null;
      const projects = employee ? (await collectPages<V1Project>(session, "/projects", used)).items : [];
      let rows: ShiftRow[] = [];
      if (!preview) rows = await readShiftRows().catch(() => []);
      const localOpen = rows.find((row) => isShiftEvent(row) && row.state !== "synced" && row.event.kind === "shift_start" && row.employeeId === employee?.id);
      const preferred = localOpen && isShiftEvent(localOpen) ? localOpen.event.projectId : projectChoice;
      const projectId = projects.some((item) => item.id === preferred) ? preferred : projects[0]?.id ?? "";
      if (!employee || !projectId) {
        setData({
          employee, projects, projectId, day: "", timeZone: "Europe/Moscow", assignment: null, shifts: [], segments: [],
          tasks: [], zones: new Map(), reports: [], rows, version: 0, totals: { presenceMs: "0", idleMs: "0", workMs: "0", breakMs: "0", downtimeMs: "0" }, error: "",
        });
        setLoading(false);
        return;
      }
      const clockInfo = await v1<OverviewClock>(session, `/overview?projectId=${projectId}`, undefined, { signal: used });
      const shifts: ShiftRowServer[] = [];
      for (const project of projects) {
        const page = await collectPages<ShiftRowServer>(session, `/projects/${project.id}/execution/shifts?employeeId=${employee.id}`, used);
        shifts.push(...page.items);
      }
      shifts.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
      const open = shifts.find((item) => !item.endedAt);
      const activeProject = open?.projectId ?? projectId;
      const [assignmentPage, taskPage, zonePage, reportPage, day] = await Promise.all([
        optionalList<Assignment>(session, `/projects/${activeProject}/assignments`, used),
        collectPages<V1Task>(session, `/projects/${activeProject}/tasks?workDate=${planDay || clockInfo.day}`, used),
        optionalList<{ id: string; name: string }>(session, `/projects/${activeProject}/zones`, used),
        optionalList<Report>(session, `/projects/${activeProject}/execution/reports?employeeId=${employee.id}&day=${clockInfo.day}`, used),
        v1<DayData["totals"] & { version: number }>(session, `/projects/${activeProject}/execution/employees/${employee.id}/day?day=${clockInfo.day}`, undefined, { signal: used }),
      ]);
      const focus = open ?? [...shifts].reverse().find((item) => item.projectId === activeProject);
      const segments = focus ? (await optionalList<Segment>(session, `/projects/${focus.projectId}/execution/shifts/${focus.id}/segments`, used)).items : [];
      if (used.aborted) return;
      if (!planDay) setPlanDay(clockInfo.day);
      setProjectChoice(activeProject);
      setData({
        employee, projects, projectId: activeProject, day: clockInfo.day, timeZone: clockInfo.timezone,
        assignment: assignmentPage.items.find((item) => item.employeeId === employee.id && item.status === "active") ?? null,
        shifts, segments, tasks: taskPage.items, zones: new Map(zonePage.items.map((item) => [item.id, item.name])),
        reports: reportPage.items, rows, version: day.version, totals: day, error: "",
      });
    } catch (error) {
      if (isAbort(error)) return;
      setData((current) => current ? { ...current, error: apiText(error) } : null);
    } finally {
      if (!used.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    void reload(ac.signal);
    return () => ac.abort();
  }, [session.token, planDay, projectChoice]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 15000);
    const onFocus = () => { if (document.visibilityState === "visible") void reload(); };
    const onLine = () => { if (!preview) void deliverShiftQueue().then(() => reload()).catch(() => undefined); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onLine);
    return () => { window.clearInterval(tick); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onLine); };
  }, [session.token, preview]);

  return (
    <div className="phone">
      <div className="phone-body">
        {loading && !data ? <p className="quiet">Загружаем день.</p> : null}
        {data ? (
          <motion.div key={tab} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: reduce ? 0 : 0.2 }}>
            {tab === "day" ? <DayScreen session={session} data={data} now={now} planDay={planDay || data.day} preview={preview} onReload={() => void reload()} onPlanDay={setPlanDay} onProject={setProjectChoice} /> : null}
            {tab === "tasks" ? <TaskScreen session={session} data={data} planDay={planDay || data.day} preview={preview} onPlanDay={setPlanDay} onReload={() => void reload()} /> : null}
            {tab === "profile" ? <ProfileScreen session={session} data={data} theme={theme} onTheme={onTheme} onLogout={onLogout} preview={preview} onReload={() => void reload()} /> : null}
          </motion.div>
        ) : null}
        {!loading && !data ? <p className="alert" role="alert">День не загрузился.</p> : null}
      </div>
      <nav className="tabs three" aria-label="Разделы рабочего">
        <button className={tab === "day" ? "is-on" : ""} type="button" onClick={() => setTab("day")}>Мой день</button>
        <button className={tab === "tasks" ? "is-on" : ""} type="button" onClick={() => setTab("tasks")}>Задания</button>
        <button className={tab === "profile" ? "is-on" : ""} type="button" onClick={() => setTab("profile")}>Профиль</button>
      </nav>
    </div>
  );
}

function DayScreen({
  session, data, now, planDay, preview, onReload, onPlanDay, onProject,
}: {
  session: Session;
  data: DayData;
  now: number;
  planDay: string;
  preview: boolean;
  onReload: () => void;
  onPlanDay: (day: string) => void;
  onProject: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [geo, setGeo] = useState<GeoAttempt | null>(null);
  const [seeking, setSeeking] = useState(false);
  const [sheet, setSheet] = useState<"" | "tasks" | "downtime" | "close" | "transfer">("");
  const [downtimeTask, setDowntimeTask] = useState(false);
  const [reason, setReason] = useState<keyof typeof downtimeLabels>("materials");
  const [comment, setComment] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [startPhotos, setStartPhotos] = useState<LocalPhoto[]>([]);
  const [endPhotos, setEndPhotos] = useState<LocalPhoto[]>([]);
  const [reportPhotos, setReportPhotos] = useState<Record<string, LocalPhoto[]>>({});
  const [frozen, setFrozen] = useState<ShiftDraft[] | null>(null);
  const draftKind = useRef("");
  const employee = data.employee;
  const openServer = data.shifts.find((item) => !item.endedAt && item.employeeId === employee?.id);
  const localStart = data.rows.find((row) => isShiftEvent(row) && row.employeeId === employee?.id && row.state !== "synced" && row.event.kind === "shift_start");
  const latest = [...data.shifts].reverse().find((item) => item.employeeId === employee?.id && item.projectId === data.projectId);
  const shiftId = openServer?.id ?? (localStart && isShiftEvent(localStart) ? localStart.event.shiftId : latest?.id ?? "");
  const projectId = openServer?.projectId ?? (localStart && isShiftEvent(localStart) ? localStart.event.projectId : data.projectId);
  const startedAt = openServer?.startedAt ?? (localStart && isShiftEvent(localStart) ? localStart.event.occurredAt : latest?.startedAt ?? "");
  const spans = shiftId ? spansOf(shiftId, data.segments, data.rows) : [];
  const openSpan = [...spans].reverse().find((item) => !item.endedAt);
  const endedLocal = data.rows.some((row) => isShiftEvent(row) && row.event.kind === "shift_end" && row.event.shiftId === shiftId);
  const open = Boolean(openSpan && !endedLocal && (openServer ? !openServer.endedAt : Boolean(localStart)));
  const head = employee ? versionHead(data.rows, employee.id, data.version) : null;
  const projectName = data.projects.find((item) => item.id === projectId)?.name ?? "Объект";
  const taskName = (id: string | null) => data.tasks.find((item) => item.id === id)?.title ?? (id ? "Задание вне этого списка" : "");

  async function save(specs: Parameters<typeof prepareDrafts>[3], kind: string) {
    if (!employee || preview || busy) return;
    setBusy(true);
    setError("");
    try {
      const rows = await readShiftRows();
      const drafts = frozen && draftKind.current === kind ? frozen : prepareDrafts(rows, employee.id, data.version, specs);
      draftKind.current = kind;
      setFrozen(drafts);
      await commitShiftDrafts(employee.id, data.version, drafts);
      const delivered = await deliverShiftQueue();
      setNotice(deliveryLabel(delivered.delivery.state));
      setFrozen(null);
      setSheet("");
      onReload();
    } catch (reason) {
      setError(failureLabel(queueCode(reason) || (reason instanceof Error ? reason.message : "")));
      setSheet("transfer");
    } finally {
      setBusy(false);
    }
  }

  function base(kind: EventPayload, expectedVersion: number, previous: string | undefined): EventPayload {
    return { ...kind, expectedVersion, ...(previous ? { previousEventId: previous } : {}) };
  }

  async function seek() {
    setSeeking(true);
    setGeo(await captureGeo());
    setSeeking(false);
  }

  const blocked = !employee
    ? "Карточка сотрудника не связана с этим аккаунтом."
    : !data.projects.length
      ? "Нет назначения на объект."
      : !data.assignment
        ? "Назначения на этот объект нет."
        : !data.assignment.currentAdmission.eligible && !open
          ? data.assignment.currentAdmission.reasons.map(admissionText).join(". ")
          : "";

  const mode = openSpan?.mode ?? "idle";
  const worked = spans.filter((item) => item.mode === "work" && item.taskId && item.endedAt && item.endedAt > item.startedAt);
  const liveWork = open && mode === "work" && openSpan?.startedAt && new Date(openSpan.startedAt).getTime() < now ? [openSpan] : [];
  const reportTasks = [...worked, ...liveWork].filter((item, index, list) => item.taskId && list.findIndex((other) => other.taskId === item.taskId) === index);
  const missingReports = reportTasks.filter((item) => !data.reports.some((report) => report.shiftId === shiftId && report.taskId === item.taskId)
    && !data.rows.some((row) => isShiftEvent(row) && row.event.kind === "submit_volume" && row.event.shiftId === shiftId && row.event.taskId === item.taskId));
  const closed = !open && Boolean(shiftId);
  const sending = data.rows.some((row) => row.employeeId === employee?.id && row.state !== "synced");

  let primary = "Начать смену";
  if (blocked) primary = "Обновить статус";
  else if (head?.diverged || head?.blocked) primary = "Посмотреть отправку";
  else if (open && mode === "idle") primary = "Выбрать задание";
  else if (open && mode === "work") primary = "Завершить смену";
  else if (open && mode === "break") primary = "Вернуться к работе";
  else if (open && mode === "downtime") primary = "Завершить простой";
  else if (closed && missingReports.length) primary = "Указать результат";
  else if (sending) primary = "Посмотреть отправку";
  else if (closed) primary = "Посмотреть итоги";

  async function resume(taskId: string | null) {
    if (!employee || !taskId) { setSheet("tasks"); return; }
    try {
      const task = await v1<V1Task>(session, `/projects/${projectId}/tasks/${taskId}`);
      if (task.status !== "published" || task.assigneeEmployeeId !== employee.id) { setSheet("tasks"); return; }
    } catch { setSheet("tasks"); return; }
    const requestId = crypto.randomUUID();
    await save([{
      projectId,
      build: (expectedVersion, previous) => base({ kind: "segment_change", mode: "work", taskId, requestId, employeeId: employee.id, projectId, shiftId, occurredAt: new Date().toISOString(), expectedVersion: 0 }, expectedVersion, previous),
    }], "work");
  }

  async function primaryAction() {
    if (blocked) { onReload(); return; }
    if (head?.diverged || head?.blocked || sending && !open) { setSheet("transfer"); return; }
    if (!open && !closed) { if (!geo) void seek(); else await start(geo.fix); return; }
    if (open && mode === "idle") { setSheet("tasks"); return; }
    if (open && (mode === "work" || (closed && missingReports.length))) { setSheet("close"); return; }
    if (open && mode === "break") {
      const previous = [...spans].reverse().find((item) => item.mode === "work" && item.taskId);
      await resume(previous?.taskId ?? null);
      return;
    }
    if (open && mode === "downtime") {
      const named = openSpan?.taskId ?? null;
      if (!named) {
        await save([{ projectId, build: (expectedVersion, previous) => base({ kind: "segment_change", mode: "idle", requestId: crypto.randomUUID(), employeeId: employee!.id, projectId, shiftId, occurredAt: new Date().toISOString(), expectedVersion: 0 }, expectedVersion, previous) }], "idle");
        return;
      }
      await resume(named);
      return;
    }
    setSheet(closed ? "close" : "transfer");
  }

  async function start(fix: GeoCapture | null) {
    if (!employee) return;
    const requestId = crypto.randomUUID();
    const nextShift = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const photos = startPhotos;
    await save([{
      projectId,
      build: (expectedVersion, previous) => base({
        kind: "shift_start", requestId, employeeId: employee.id, projectId, shiftId: nextShift, occurredAt, expectedVersion: 0,
        ...(fix ? { geo: fix } : {}),
      }, expectedVersion, previous),
      evidence: photos.length ? (event) => photos.map((photo) => photoEvidence(event, photo, session.userId)) : undefined,
    }], "start");
  }

  async function confirmClose() {
    if (!employee) return;
    if (!open && !missingReports.length) { setSheet(""); return; }
    const occurredAt = new Date().toISOString();
    const invalid = reportTasks.some((item) => quantities[item.taskId ?? ""]?.trim() && !decimalQuantity(quantities[item.taskId ?? ""]));
    if (invalid) { setError("Укажите положительный объём не больше чем с тремя знаками или оставьте поле пустым."); return; }
    const fix = geo?.fix ?? null;
    const endId = crypto.randomUUID();
    const specs: Parameters<typeof prepareDrafts>[3] = [];
    if (open) specs.push({
      projectId,
      build: (expectedVersion, previous) => base({
        kind: "shift_end", requestId: endId, employeeId: employee.id, projectId, shiftId, occurredAt, expectedVersion: 0,
        ...(fix ? { geo: fix } : {}),
      }, expectedVersion, previous),
      evidence: endPhotos.length ? (event) => endPhotos.map((photo) => photoEvidence(event, photo, session.userId)) : undefined,
    });
    for (const item of missingReports) {
      const quantity = decimalQuantity(quantities[item.taskId ?? ""] ?? "");
      if (!quantity || !item.taskId) continue;
      const reportId = crypto.randomUUID();
      const photos = reportPhotos[item.taskId] ?? [];
      specs.push({
        projectId,
        build: (expectedVersion, previous) => base({
          kind: "submit_volume", requestId: crypto.randomUUID(), reportId, taskId: item.taskId!, submittedQuantity: quantity,
          employeeId: employee.id, projectId, shiftId, occurredAt, expectedVersion: 0,
        }, expectedVersion, previous),
        evidence: photos.length ? (event) => photos.map((photo) => photoEvidence(event, photo, session.userId, reportId)) : undefined,
      });
    }
    await save(specs, "close");
  }

  const workMs = spans.filter((item) => item.mode === "work").reduce((sum, item) => sum + Math.max(0, new Date(item.endedAt ?? new Date(now).toISOString()).getTime() - new Date(item.startedAt).getTime()), 0);
  const presenceMs = startedAt && open ? now - new Date(startedAt).getTime() : Number(data.totals.presenceMs);
  const geoLine = localGeo(data.rows, shiftId);

  return (
    <>
      <p className="kicker">{session.name}</p>
      <h1>Мой день</h1>
      <p className="day-copy">{projectName}<br />{data.day ? civilLabel(data.day) : "Дата кабинета ещё не получена"} · {transferWord(data.rows)}</p>
      {data.projects.length > 1 && !open ? (
        <label className="field"><span>Объект до начала смены</span>
          <select value={projectId} onChange={(event) => onProject(event.target.value)}>
            {data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      ) : null}
      {data.error ? <p className="alert" role="alert">{data.error}</p> : null}
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {notice ? <p className="quiet">{notice}</p> : null}
      <article className="job">
        {blocked ? <p className="day-copy">{blocked} Обратитесь к прорабу.</p> : null}
        {!blocked && !open && !closed ? <p className="day-copy">Смена не открыта. Доступных заданий: {data.tasks.length}.</p> : null}
        {!blocked && open && startedAt ? <p className="day-copy">Смена идёт с {civilOf(startedAt, data.timeZone) === data.day ? clock(startedAt, data.timeZone) : `${civilLabel(civilOf(startedAt, data.timeZone))} ${clock(startedAt, data.timeZone)}`}</p> : null}
        {!blocked && open && mode === "idle" ? <p className="day-copy"><b>Смена началась. Выберите, чем занимаетесь.</b><br />Ожидание — {duration(openSpan ? now - new Date(openSpan.startedAt).getTime() : 0)}. Это не рабочие часы по заданию.</p> : null}
        {!blocked && open && mode === "work" ? <p className="day-copy"><b>{taskName(openSpan?.taskId ?? null)}</b><br />План: {planOf(data, openSpan?.taskId ?? null)} · Работа по заданию: {duration(workMs)}</p> : null}
        {!blocked && open && mode === "break" ? <p className="day-copy"><b>Перерыв</b><br />С {openSpan ? clock(openSpan.startedAt, data.timeZone) : ""}</p> : null}
        {!blocked && open && mode === "downtime" ? <p className="day-copy"><b>Простой</b><br />{openSpan?.reasonCode && openSpan.reasonCode in downtimeLabels ? downtimeLabels[openSpan.reasonCode as keyof typeof downtimeLabels] : "Причина записана"}{openSpan?.taskId ? ` · ${taskName(openSpan.taskId)}` : ""}</p> : null}
        {!blocked && closed ? <p className="day-copy"><b>Смена закрыта</b><br />Смена — {duration(presenceMs)}. {missingReports.length ? "Есть работа без заявленного объёма." : data.reports.some((report) => report.shiftId === shiftId) ? "Сообщённый объём ждёт проверки." : "Объём не заявлен."}</p> : null}
        {!blocked && (open || missingReports.length > 0) ? (
          <div>
            <b>Незавершённое</b>
            {open ? <p className="day-copy">Смена открыта. Завершение и отправка объёма — в этой карточке. Отдельного срока у действия нет.</p> : null}
            {missingReports.map((item) => <p className="day-copy" key={item.taskId ?? item.startedAt}>По заданию {taskName(item.taskId ?? null)} нет заявленного объёма. Форма отправки ниже.</p>)}
          </div>
        ) : null}
        {closed && employee && projectId && data.day ? <OwnDayStatus session={session} projectId={projectId} employeeId={employee.id} day={data.day} /> : null}
        {geoLine ? <p className="quiet">{geoLine}</p> : null}
        <button className="fill wide" type="button" disabled={busy || seeking} onClick={() => void primaryAction()}>{busy ? "Сохраняем…" : seeking ? "Ищем точку…" : primary}</button>
        {!blocked && !open && !closed ? (
          <div className="stack">
            <button className="ghost" type="button" disabled={seeking} onClick={() => void seek()}>{seeking ? "Ищем точку…" : "Повторить точку"}</button>
            {geo ? <p className="quiet">{geoText(geo)}</p> : <p className="quiet">Точка запрашивается в момент начала смены. Отказ не подменяется координатами объекта.</p>}
            <PhotoField label="Фото начала" photos={startPhotos} onChange={setStartPhotos} />
          </div>
        ) : null}
        {closed ? <button className="ghost" type="button" disabled={busy || seeking} onClick={() => void (async () => { setSeeking(true); const attempt = await captureGeo(); setGeo(attempt); setSeeking(false); await start(attempt.fix); })()}>Начать новую смену</button> : null}
        {open ? (
          <div className="stack">
            {mode === "work" ? <button className="ghost" type="button" disabled={busy} onClick={() => void save([{ projectId, build: (expectedVersion, previous) => base({ kind: "segment_change", mode: "break", requestId: crypto.randomUUID(), employeeId: employee!.id, projectId, shiftId, occurredAt: new Date().toISOString(), expectedVersion: 0 }, expectedVersion, previous) }], "break")}>Перерыв</button> : null}
            {mode === "work" || mode === "idle" ? <button className="ghost" type="button" disabled={busy} onClick={() => setSheet("downtime")}>Простой</button> : null}
            {mode !== "idle" ? <button className="ghost" type="button" disabled={busy} onClick={() => setSheet("tasks")}>Другое задание</button> : null}
            {mode !== "work" ? <button className="ghost" type="button" disabled={busy} onClick={() => setSheet("close")}>Завершить смену</button> : null}
          </div>
        ) : null}
      </article>
      <h2>История</h2>
      <ul className="day-history">
        {startedAt ? <li>{clock(startedAt, data.timeZone)} — Начали смену{localStart ? " · на устройстве" : ""}</li> : null}
        {spans.filter((item) => item.mode !== "idle").map((item) => (
          <li key={`${item.startedAt}:${item.mode}:${item.taskId ?? ""}`}>{clock(item.startedAt, data.timeZone)} — {spanText(item, taskName)}{item.local ? " · на устройстве" : ""}</li>
        ))}
        {(shiftId === latest?.id && latest?.endedAt) || endedLocal ? <li>{clock(latest?.endedAt ?? new Date(now).toISOString(), data.timeZone)} — Закончили смену{endedLocal && !latest?.endedAt ? " · на устройстве" : ""}</li> : null}
        {!startedAt ? <li>Отметок за эту смену ещё нет.</li> : null}
      </ul>
      <p className="quiet">Смена — {duration(Math.max(0, presenceMs))}. Это предварительный итог смены.</p>
      {sheet === "tasks" ? <TaskPicker data={data} onClose={() => setSheet("")} onPick={(taskId) => void resume(taskId)} /> : null}
      {sheet === "downtime" ? (
        <form className="dialog-back is-sheet" onSubmit={(event) => {
          event.preventDefault();
          if (!comment.trim() || !employee) return;
          const taskId = downtimeTask ? openSpan?.taskId ?? undefined : undefined;
          void save([{
            projectId,
            build: (expectedVersion, previous) => base({
              kind: "segment_change", mode: "downtime", reasonCode: reason, comment: comment.trim(), requestId: crypto.randomUUID(),
              employeeId: employee.id, projectId, shiftId, occurredAt: new Date().toISOString(), expectedVersion: 0,
              ...(taskId ? { taskId } : {}),
            }, expectedVersion, previous),
          }], "downtime");
        }}>
          <div className="dialog" role="dialog" aria-labelledby="downtime-title">
            <h2 id="downtime-title">Простой</h2>
            <label className="field"><span>Причина</span>
              <select value={reason} onChange={(event) => setReason(event.target.value as keyof typeof downtimeLabels)}>
                {Object.entries(downtimeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            <label className="field"><span>Комментарий</span><textarea className="note" value={comment} maxLength={500} onChange={(event) => setComment(event.target.value)} required /></label>
            {mode === "work" && openSpan?.taskId ? <label className="check"><input type="checkbox" checked={downtimeTask} onChange={(event) => setDowntimeTask(event.target.checked)} /> Простой по текущему заданию</label> : null}
            <button className="fill wide" type="submit" disabled={busy || !comment.trim()}>Начать простой</button>
            <button className="ghost" type="button" onClick={() => setSheet("")}>Закрыть</button>
          </div>
        </form>
      ) : null}
      {sheet === "close" ? (
        <form className="dialog-back is-sheet" onSubmit={(event) => { event.preventDefault(); void confirmClose(); }}>
          <div className="dialog" role="dialog" aria-labelledby="close-title">
            <h2 id="close-title">Итог смены</h2>
            <p className="quiet">Пустое поле не превращается в объём. Часы и сообщение ещё подлежат проверке.</p>
            {open ? <>
              <button className="ghost" type="button" onClick={() => void seek()}>Точка окончания</button>
              {geo ? <p className="quiet">{geoText(geo)}</p> : null}
              <PhotoField label="Фото окончания" photos={endPhotos} onChange={setEndPhotos} />
            </> : null}
            {reportTasks.length ? reportTasks.map((item) => {
              const task = data.tasks.find((entry) => entry.id === item.taskId);
              const sent = data.reports.find((report) => report.shiftId === shiftId && report.taskId === item.taskId);
              const quantity = quantities[item.taskId ?? ""] ?? "";
              const normalized = decimalQuantity(quantity);
              const above = task && normalized ? thousandths(normalized) > thousandths(task.plannedQuantity) : false;
              return (
                <div key={item.taskId}>
                  <b>{task?.title ?? taskName(item.taskId)}</b>
                  <p className="quiet">План: {task ? showQuantity(task.plannedQuantity, task.unit) : "единица задания"}</p>
                  {sent ? <p className="day-copy">Сообщено {showQuantity(sent.submittedQuantity, sent.unit)}. Принятый объём этим экраном не ставится.{sent.reviewFlags?.abovePlannedQuantity ? " Больше плана, ждёт проверки." : ""}</p> : <>
                    <label className="field"><span>Фактический объём{task ? `, ${task.unit}` : ""}</span>
                      <input inputMode="decimal" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [item.taskId ?? ""]: event.target.value }))} disabled={Boolean(frozen)} />
                    </label>
                    {quantity.trim() && !normalized ? <p className="alert">Нужен положительный объём, не больше трёх знаков после запятой.</p> : null}
                    {!quantity.trim() ? <p className="quiet">Объём не заявлен.</p> : null}
                    {above ? <p className="quiet">Больше плана. Это отметка к проверке, не приёмка.</p> : null}
                    <PhotoField label="Фото результата" photos={reportPhotos[item.taskId ?? ""] ?? []} onChange={(photos) => setReportPhotos((current) => ({ ...current, [item.taskId ?? ""]: photos }))} />
                  </>}
                </div>
              );
            }) : <p className="quiet">Завершённой работы по заданиям нет. Смену можно закрыть без отчёта.</p>}
            <button className="fill wide" type="submit" disabled={busy || (!open && !missingReports.length)}>{busy ? "Сохраняем…" : open ? "Завершить и отправить" : "Отправить объём"}</button>
            <button className="ghost" type="button" onClick={() => setSheet("")}>Закрыть</button>
          </div>
        </form>
      ) : null}
      {sheet === "transfer" ? <Transfer rows={data.rows} employeeId={employee?.id ?? ""} onClose={() => setSheet("")} onChanged={onReload} /> : null}
      <p className="quiet">Дата отчёта не переносит плановую дату задания.</p>
      <label className="field"><span>Дата списка заданий</span><input type="date" value={planDay} onChange={(event) => onPlanDay(event.target.value)} /></label>
    </>
  );
}

function TaskScreen({
  session, data, planDay, preview, onPlanDay, onReload,
}: {
  session: Session;
  data: DayData;
  planDay: string;
  preview: boolean;
  onPlanDay: (day: string) => void;
  onReload: () => void;
}) {
  const published = data.tasks.filter((task) => task.status === "published" && task.assigneeEmployeeId === data.employee?.id);
  return (
    <>
      <h1>Задания</h1>
      <label className="field"><span>Плановая дата</span><input type="date" value={planDay} onChange={(event) => onPlanDay(event.target.value)} /></label>
      <p className="quiet">Смена даты показывает задания этой плановой даты. Она не назначает их на другой день.</p>
      {published.length ? published.map((task) => {
        const report = data.reports.find((item) => item.taskId === task.id);
        return (
          <article className="job" key={task.id}>
            <h2>{task.title}</h2>
            {task.zoneId && data.zones.get(task.zoneId) ? <p className="quiet">{data.zones.get(task.zoneId)}</p> : null}
            <p className="day-copy">План: {showQuantity(task.plannedQuantity, task.unit)}</p>
            {task.rdReference ? <p className="quiet">Рабочая документация: {task.rdReference}</p> : null}
            <p className="quiet">{report ? `Сообщено ${showQuantity(report.submittedQuantity, report.unit)}. Принятый объём этим экраном не ставится.` : "Объём ещё не сообщён."}{report?.reviewFlags?.abovePlannedQuantity ? " Больше плана, ждёт проверки." : ""}</p>
            {preview ? null : <p className="quiet">Выбрать задание можно на экране дня, когда смена открыта.</p>}
          </article>
        );
      }) : <p className="quiet">На эту дату опубликованных заданий нет.</p>}
      <button className="ghost" type="button" onClick={onReload}>Обновить</button>
      <span className="sr-only">{session.name}</span>
    </>
  );
}

function ProfileScreen({
  session, data, theme, onTheme, onLogout, preview, onReload,
}: {
  session: Session;
  data: DayData;
  theme: "light" | "dark";
  onTheme: () => void;
  onLogout: () => void;
  preview: boolean;
  onReload: () => void;
}) {
  const [storage, setStorage] = useState("");
  const admission = data.assignment?.currentAdmission;
  return (
    <>
      <h1>Профиль</h1>
      <article className="job">
        <b>{data.employee?.fullName ?? session.name}</b>
        <p className="quiet">{data.employee ? "Карточка связана с аккаунтом." : "Карточка сотрудника не связана."}</p>
        <p className="quiet">{data.assignment ? "Назначение действует." : "Назначения нет."}</p>
        <p className="quiet">{admission ? (admission.eligible ? "Допуск сейчас позволяет работать." : admission.reasons.map(admissionText).join(". ")) : "Состояние допуска не получено."}</p>
      </article>
      <button className="ghost" type="button" onClick={onTheme}>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</button>
      <button className="ghost" type="button" onClick={() => void shiftStorage().then((info) => setStorage(info.indexedDB ? `Хранилище доступно. Постоянство: ${info.persisted === null ? "неизвестно" : info.persisted ? "да" : "нет"}. Блокировка: ${info.webLocks ? "есть" : "нет"}.` : "Хранилище недоступно.")).catch((error) => setStorage(failureLabel(queueCode(error))))}>Подробности синхронизации</button>
      {storage ? <p className="quiet">{storage}</p> : null}
      <p className="quiet">Очередь хранится в этом браузере, пока его данные не очищены. Закрытое приложение само не отправляет отметки. Пароль, роль и допуск здесь не меняются.</p>
      {preview ? <p className="quiet">Это просмотр. Отметки от этого вида не записываются.</p> : null}
      <button className="fill wide" type="button" onClick={onLogout}>Выйти</button>
      <button className="ghost" type="button" onClick={onReload}>Обновить статус</button>
    </>
  );
}

function TaskPicker({ data, onClose, onPick }: { data: DayData; onClose: () => void; onPick: (taskId: string) => void }) {
  const tasks = data.tasks.filter((task) => task.status === "published");
  return (
    <div className="dialog-back is-sheet">
      <div className="dialog" role="dialog" aria-labelledby="pick-title">
        <h2 id="pick-title">Чем занимаетесь</h2>
        {tasks.length ? tasks.map((task) => (
          <button className="ghost wide" type="button" key={task.id} onClick={() => onPick(task.id)}>{task.title}</button>
        )) : <p className="quiet">На выбранную плановую дату опубликованных заданий нет. Смена может остаться в ожидании.</p>}
        <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

function Transfer({ rows, employeeId, onClose, onChanged }: { rows: ShiftRow[]; employeeId: string; onClose: () => void; onChanged: () => void }) {
  const [error, setError] = useState("");
  const mine = rows.filter((row) => row.employeeId === employeeId);
  return (
    <div className="dialog-back is-sheet">
      <div className="dialog" role="dialog" aria-labelledby="transfer-title">
        <h2 id="transfer-title">Отправка</h2>
        {error ? <p className="alert" role="alert">{error}</p> : null}
        {mine.length ? mine.map((row) => (
          <p key={row.id} className="quiet">{isShiftEvent(row) ? commandTitle(row.event) : "Фото"} · {fileOrRow(row, rows)}{row.lastError ? ` · ${failureLabel(row.lastError)}` : ""}</p>
        )) : <p className="quiet">На этом устройстве нет ожидающих отметок.</p>}
        <button className="fill wide" type="button" onClick={() => void deliverShiftQueue().then(() => onChanged()).catch((reason) => setError(failureLabel(queueCode(reason))))}>Отправить сохранённое</button>
        {mine.filter((row) => row.state === "retry_wait" || row.state === "auth-required").map((row) => (
          <button className="ghost" type="button" key={row.id} onClick={() => void retryShiftRow(row.id).then(() => deliverShiftQueue()).then(() => onChanged()).catch((reason) => setError(failureLabel(queueCode(reason))))}>Повторить прежнюю операцию</button>
        ))}
        <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}

function PhotoField({ label, photos, onChange }: { label: string; photos: LocalPhoto[]; onChange: (photos: LocalPhoto[]) => void }) {
  const [error, setError] = useState("");
  const [open, setOpen] = useState("");
  return (
    <div>
      <label className="ghost wide file-pick">{label}
        <input type="file" accept="image/jpeg,image/png" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void preparePhoto(file).then((result) => {
            if ("error" in result) { setError(result.error); return; }
            setError("");
            onChange([...photos, newPhoto(result.blob, result.filename, result.contentType)].slice(-4));
          });
        }} />
      </label>
      {error ? <p className="alert">{error}</p> : null}
      <div className="photo-row">
        {photos.map((photo) => (
          <button type="button" key={photo.fileId} onClick={() => setOpen(photo.url)}>
            <img src={photo.url} alt={photo.filename} />
            <span>{Math.ceil(photo.blob.size / 1024)} КБ</span>
          </button>
        ))}
      </div>
      {open ? <button className="dialog-back" type="button" onClick={() => setOpen("")}><img className="photo-view" src={open} alt="Просмотр фото" /></button> : null}
    </div>
  );
}

function ServerPhoto({ session, projectId, file }: { session: Session; projectId: string; file: EvidenceFile }) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    let current = "";
    void fetch(`/api/v1/projects/${projectId}/evidence/${file.id}/content`, {
      headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
      signal: ac.signal,
    }).then(async (response) => {
      if (!response.ok || ac.signal.aborted) return;
      current = URL.createObjectURL(await response.blob());
      if (!ac.signal.aborted) setUrl(current);
    }).catch(() => undefined);
    return () => { ac.abort(); if (current) URL.revokeObjectURL(current); };
  }, [session, projectId, file.id]);
  if (file.state !== "ready") return <p className="quiet">{file.filename}: файл ещё не готов</p>;
  if (!file.contentType.startsWith("image/")) return <p className="quiet">{file.filename}</p>;
  return url ? <button type="button" onClick={() => setOpen(true)}><img src={url} alt={file.filename} />{open ? <span className="dialog-back"><img className="photo-view" src={url} alt={file.filename} /></span> : null}</button> : <p className="quiet">Открываем {file.filename}</p>;
}

export function ShiftWatch({ session, projectId, day, timeZone }: { session: Session; projectId: string; day: string; timeZone: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [cards, setCards] = useState<{ shift: ShiftRowServer; name: string; mode: string; when: string; reports: string[]; files: EvidenceFile[] }[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const [people, shifts, reports, files] = await Promise.all([
          collectPages<V1Employee>(session, `/employees?projectId=${projectId}`, ac.signal),
          collectPages<ShiftRowServer>(session, `/projects/${projectId}/execution/shifts`, ac.signal),
          optionalList<Report>(session, `/projects/${projectId}/execution/reports?day=${day}`, ac.signal),
          optionalList<EvidenceFile>(session, `/projects/${projectId}/evidence`, ac.signal),
        ]);
        const shown = shifts.items.filter((shift) => !shift.endedAt || civilOf(shift.startedAt, timeZone) === day || (shift.endedAt && civilOf(shift.endedAt, timeZone) === day)).slice(-15);
        const next = [];
        for (const shift of shown) {
          const segments = (await optionalList<Segment>(session, `/projects/${projectId}/execution/shifts/${shift.id}/segments`, ac.signal)).items;
          const current = [...segments].reverse().find((item) => !item.endedAt) ?? segments.at(-1);
          const when = shift.endEvent?.occurredAt ?? current?.startedAt ?? shift.startedAt;
          next.push({
            shift,
            name: people.items.find((item) => item.id === shift.employeeId)?.fullName ?? "Сотрудник",
            mode: shift.endedAt ? "Смена закрыта" : modeLabel(current?.mode ?? "idle"),
            when: `${civilOf(when, timeZone)} ${clock(when, timeZone)}`,
            reports: reports.items.filter((item) => item.shiftId === shift.id).map((item) => showQuantity(item.submittedQuantity, item.unit)),
            files: files.items.filter((file) => file.employeeId === shift.employeeId && (civilOf(file.reservedAt, timeZone) === day || reports.items.some((item) => item.reportId === file.attachment?.target.reportId))),
          });
        }
        if (!ac.signal.aborted) { setCards(next); setLines([]); setError(""); }
      } catch (reason) {
        if (!isAbort(reason)) setError(apiText(reason));
      }
    })();
    return () => ac.abort();
  }, [session, projectId, day, timeZone]);
  return (
    <section className="panel">
      <h2>Смены на сервере</h2>
      <p className="quiet">Показаны подтверждённые смены, режимы, сообщённый объём и файлы. Это не положение человека и не очередь его телефона.</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {cards.length ? cards.map((card) => (
        <article className="job" key={card.shift.id}>
          <b>{card.name}</b>
          <p className="day-copy">{card.mode}</p>
          <p className="quiet">Последняя подтверждённая отметка: {card.when}</p>
          <p className="quiet">{card.reports.length ? `Сообщено: ${card.reports.join(", ")}. Приёмки качества здесь нет.` : "Объём не сообщён."}</p>
          <div className="photo-row">{card.files.map((file) => <ServerPhoto key={file.id} session={session} projectId={projectId} file={file} />)}</div>
        </article>
      )) : <p className="quiet">{lines.join(" ") || "На этот день серверных смен нет."}</p>}
    </section>
  );
}

function modeLabel(mode: string) {
  if (mode === "work") return "Смена открыта: работа";
  if (mode === "break") return "Смена открыта: перерыв";
  if (mode === "downtime") return "Смена открыта: простой";
  return "Смена открыта: ожидание";
}

function commandTitle(event: EventPayload) {
  if (event.kind === "shift_start") return "Начало смены";
  if (event.kind === "shift_end") return "Окончание смены";
  if (event.kind === "submit_volume") return "Сообщённый объём";
  if (event.kind !== "segment_change") return "Отметка";
  if (event.mode === "break") return "Перерыв";
  if (event.mode === "downtime") return "Простой";
  if (event.mode === "work") return "Работа";
  return "Ожидание";
}

function fileOrRow(row: ShiftRow, rows: ShiftRow[]) {
  if (isShiftEvent(row)) return rowLabel(row);
  const event = rows.find((item) => isShiftEvent(item) && item.requestId === row.dependency);
  if (row.state !== "synced" && event?.state === "synced") return "Отметка передана. Фото отправляется.";
  return rowLabel(row);
}

function spanText(span: Span, taskName: (id: string | null) => string) {
  if (span.mode === "work") return `Начали ${taskName(span.taskId) || "задание"}`;
  if (span.mode === "break") return "Перерыв";
  if (span.mode === "downtime") return `Простой: ${span.reasonCode && span.reasonCode in downtimeLabels ? downtimeLabels[span.reasonCode as keyof typeof downtimeLabels] : "причина"}`;
  return "Ожидание";
}

function planOf(data: DayData, taskId: string | null) {
  const task = data.tasks.find((item) => item.id === taskId);
  return task ? showQuantity(task.plannedQuantity, task.unit) : "план в карточке задания";
}

function localGeo(rows: ShiftRow[], shiftId: string) {
  const start = [...rows].reverse().find((row) => isShiftEvent(row) && row.event.kind === "shift_start" && row.event.shiftId === shiftId && row.event.geo);
  if (!start || !isShiftEvent(start) || start.event.kind !== "shift_start" || !start.event.geo) return "";
  const accuracy = Math.round(start.event.geo.accuracyMeters);
  return `Геопозиция получена, точность ±${accuracy} м${accuracy > 100 ? ". Точность слабая." : ""}`;
}

function geoText(attempt: GeoAttempt) {
  if (attempt.fix) {
    const accuracy = Math.round(attempt.fix.accuracyMeters);
    return `Точка получена, точность ±${accuracy} м. ${accuracy > 100 ? "Точность слабая. " : ""}Это не доказательство присутствия на объекте.`;
  }
  if (attempt.status === "denied") return "Доступ к точке запрещён. Смену можно открыть без координат.";
  if (attempt.status === "timeout") return "Точка не определилась за отведённое время.";
  return "Точка недоступна.";
}

function transferWord(rows: ShiftRow[]) {
  if (!rows.length) return "Новых отметок на устройстве нет";
  if (rows.some((row) => row.state === "sending")) return "Отправляем…";
  if (rows.some((row) => row.state === "auth-required")) return "Войдите снова, чтобы продолжить отправку";
  if (rows.some((row) => row.state === "blocked")) return "Нужна проверка. Запись сохранена на устройстве";
  if (rows.every((row) => row.state === "synced")) return "Передано на сервер";
  return "Сохранено на этом устройстве";
}

function civilLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return day;
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
}
