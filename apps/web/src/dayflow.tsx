import { useState } from "react";
import { USER_MASTER } from "@helios/domain";
import type { Session } from "./api";
import { ApiError, moscowDay, stableId, v1 } from "./v1";

type Page<T> = { items: T[]; total: number };
type Employee = { id: string; fullName: string; organizationId: string; userId: string | null; status: string };
type Project = { id: string; name: string };
type Task = { id: string; title: string; workDate: string; status: string; version: number; plannedQuantity: string; unit: string; assigneeEmployeeId: string };
type Shift = { id: string; startedAt: string; endedAt: string | null; version: number; startEvent?: { requestId: string } | null; endEvent?: { requestId: string } | null };

export function DayFlow({ session }: { session: Session }) {
  const [lines, setLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const director = session.role === "director";
  const worker = session.role === "worker";

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      const line = await action();
      setLines((current) => [line, ...current].slice(0, 8));
    } catch (reason) {
      const status = reason instanceof ApiError ? reason.status : 0;
      const code = reason instanceof Error ? reason.message : "request_failed";
      setError(status === 401 ? "Сессия закончилась. Войдите снова." : status === 403 ? "Этому входу действие не разрешено." : status === 409 ? `Версия на сервере уже другая: ${code}` : code);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>Рабочий день</h2>
      <p className="quiet">Запись идёт на сервер этой интеграции. Повтор той же кнопки отправляет тот же запрос.</p>
      <div className="panel-tools" style={{ padding: "0 12px 12px" }}>
        {director ? <button className="fill" type="button" disabled={busy} onClick={() => void run(() => prepare(session))}>Подготовить день</button> : null}
        {director ? <button className="ghost" type="button" disabled={busy} onClick={() => void run(() => approve(session))}>Утвердить часы</button> : null}
        {director ? <button className="ghost" type="button" disabled={busy} onClick={() => void run(() => downloadExcel(session))}>Скачать Excel</button> : null}
        {worker ? <button className="fill" type="button" disabled={busy} onClick={() => void run(() => work(session, "start"))}>Начать смену</button> : null}
        {worker ? <button className="ghost" type="button" disabled={busy} onClick={() => void run(() => work(session, "task"))}>В работу</button> : null}
        {worker ? <button className="ghost" type="button" disabled={busy} onClick={() => void run(() => work(session, "end"))}>Закончить смену</button> : null}
        {worker ? <button className="fill" type="button" disabled={busy} onClick={() => void run(() => work(session, "volume"))}>Сдать объём</button> : null}
      </div>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {lines.map((line) => <p className="quiet" key={line}>{line}</p>)}
    </section>
  );
}

async function scope(session: Session) {
  const projects = await v1<Page<Project>>(session, "/projects?limit=100");
  const project = projects.items[0];
  if (!project) throw new ApiError(404, "Проектов этому входу не видно");
  const people = await v1<Page<Employee>>(session, "/employees?limit=100");
  const employee = session.role === "worker"
    ? people.items.find((item) => item.userId === session.userId)
    : people.items.find((item) => item.userId && item.userId !== session.userId) ?? people.items.find((item) => item.userId);
  if (!employee) throw new ApiError(404, "Сотрудников этому входу не видно");
  return { project, employee };
}

async function prepare(session: Session) {
  const { project, employee } = await scope(session);
  const day = moscowDay();
  const key = `helios.day.${project.id}.${day}`;
  await ensureMembership(session, project.id, USER_MASTER, `${key}.master`);
  if (employee.userId) await ensureMembership(session, project.id, employee.userId, `${key}.worker`);
  const template = await ensureTemplate(session, project.id, key);
  const check = await ensureCheck(session, project.id, employee.id, template.version, key);
  await ensureAssignment(session, project.id, employee.id, check.id, `${key}.assign`);
  const zone = await ensureNamed(session, project.id, "zones", "Учебная зона", { name: "Учебная зона" }, `${key}.zone`);
  const workType = await ensureNamed(session, project.id, "work-types", "Учебная работа", {
    name: "Учебная работа", unit: "м3", requiresRd: false, requiresMaterialControl: false, requiresPredecessorAcceptance: false, requiresId: false,
  }, `${key}.type`);
  const front = await ensureFront(session, project.id, key);
  const existing = await v1<Page<Task>>(session, `/projects/${project.id}/tasks?day=${day}&limit=100`);
  const ready = existing.items.find((item) => item.status === "published" && item.assigneeEmployeeId === employee.id);
  if (ready) return `День уже на сервере: ${ready.title}, ${ready.plannedQuantity} ${ready.unit}`;
  const draft = await v1<Task>(session, `/projects/${project.id}/tasks`, {
    requestId: stableId(`${key}.task`),
    zoneId: zone.id, workTypeId: workType.id, title: "Учебная работа дня", workDate: day, plannedQuantity: "2.500",
    assigneeEmployeeId: employee.id, responsibleUserId: USER_MASTER, plannedStart: `${day}T08:00:00+03:00`, plannedEnd: `${day}T18:00:00+03:00`, rdReference: null,
  });
  await v1(session, `/projects/${project.id}/tasks/${draft.id}/front-checks`, {
    requestId: stableId(`${key}.front-check`), expectedVersion: draft.version, templateVersion: front.version, answers: [{ itemId: "ready", value: true }],
  });
  const checked = await v1<Task>(session, `/projects/${project.id}/tasks/${draft.id}`);
  const submitted = await v1<Task>(session, `/projects/${project.id}/tasks/${draft.id}/submit`, { requestId: stableId(`${key}.submit`), expectedVersion: checked.version });
  const published = await v1<Task>(session, `/projects/${project.id}/tasks/${draft.id}/publish`, { requestId: stableId(`${key}.publish`), expectedVersion: submitted.version });
  return `Сервер опубликовал «${published.title}» для ${employee.fullName}`;
}

async function ensureMembership(session: Session, projectId: string, userId: string, key: string) {
  const list = await v1<Page<{ userId: string; status: string; version: number }>>(session, `/projects/${projectId}/memberships?limit=100`);
  if (list.items.some((item) => item.userId === userId && item.status === "active")) return;
  const current = list.items.find((item) => item.userId === userId);
  await v1(session, `/projects/${projectId}/memberships/${userId}`, {
    requestId: stableId(key), expectedVersion: current?.version ?? 0, status: "active",
  }, "PUT");
}

async function ensureTemplate(session: Session, projectId: string, key: string) {
  try {
    return await v1<{ version: number }>(session, `/projects/${projectId}/admission-template`);
  } catch (reason) {
    if (!(reason instanceof ApiError) || reason.status !== 404) throw reason;
    return v1<{ version: number }>(session, `/projects/${projectId}/admission-template`, {
      requestId: stableId(`${key}.template`), code: "day", title: "Допуск на день", items: [{ id: "ready", label: "Допуск подтверждён", critical: true }], requiredQualificationCodes: [],
    });
  }
}

async function ensureCheck(session: Session, projectId: string, employeeId: string, templateVersion: number, key: string) {
  const list = await v1<Page<{ id: string }>>(session, `/employees/${employeeId}/admission-checks?projectId=${projectId}&limit=20`);
  if (list.items[0]) return list.items[0];
  return v1<{ id: string }>(session, `/employees/${employeeId}/admission-checks`, {
    requestId: stableId(`${key}.check`), projectId, templateVersion, answers: [{ itemId: "ready", value: true }],
  });
}

async function ensureAssignment(session: Session, projectId: string, employeeId: string, checkId: string, key: string) {
  const list = await v1<Page<{ employeeId: string; status: string; version: number }>>(session, `/projects/${projectId}/assignments?limit=100`);
  const current = list.items.find((item) => item.employeeId === employeeId);
  if (current?.status === "active") return;
  await v1(session, `/projects/${projectId}/assignments/${employeeId}`, {
    requestId: stableId(key), expectedVersion: current?.version ?? 0, status: "active", admissionCheckId: checkId,
  }, "PUT");
}

async function ensureNamed(session: Session, projectId: string, kind: "zones" | "work-types", name: string, body: Record<string, unknown>, key: string) {
  const list = await v1<Page<{ id: string; name: string }>>(session, `/projects/${projectId}/${kind}?limit=100`);
  const found = list.items.find((item) => item.name === name);
  if (found) return found;
  return v1<{ id: string }>(session, `/projects/${projectId}/${kind}`, { requestId: stableId(key), ...body });
}

async function ensureFront(session: Session, projectId: string, key: string) {
  try {
    return await v1<{ version: number }>(session, `/projects/${projectId}/front-template`);
  } catch (reason) {
    if (!(reason instanceof ApiError) || reason.status !== 404) throw reason;
    return v1<{ version: number }>(session, `/projects/${projectId}/front-template`, {
      requestId: stableId(`${key}.front`), code: "front", title: "Фронт", items: [{ id: "ready", label: "Фронт готов", critical: true }],
    });
  }
}

async function work(session: Session, step: "start" | "task" | "end" | "volume") {
  const { project, employee } = await scope(session);
  if (employee.userId !== session.userId) throw new ApiError(403, "Смена записывается только на свою карточку");
  const day = moscowDay();
  const tasks = await v1<Page<Task>>(session, `/projects/${project.id}/tasks?day=${day}&status=published&limit=20`);
  const task = tasks.items.find((item) => item.assigneeEmployeeId === employee.id);
  if (!task) throw new ApiError(404, "На сегодня опубликованного задания нет");
  const shifts = await v1<Page<Shift>>(session, `/projects/${project.id}/execution/shifts?employeeId=${employee.id}&limit=20`);
  const open = shifts.items.find((item) => !item.endedAt);
  const ended = shifts.items.find((item) => item.endedAt);
  const version = Number(shifts.items[0]?.version ?? 0);
  const key = `helios.shift.${employee.id}.${day}`;
  if (step === "start") {
    if (open || ended) return "Смена этого дня уже есть на сервере";
    const shiftId = stableId(`${key}.id`);
    const started = new Date(Date.now() - 120_000).toISOString();
    sessionStorage.setItem(`${key}.at`, started);
    const result = await send(session, key, "start", version, null, { kind: "shift_start", employeeId: employee.id, projectId: project.id, shiftId, occurredAt: started });
    return `Сервер открыл смену, версия ${result.version}`;
  }
  const shift = open ?? ended;
  if (!shift) throw new ApiError(409, "Сначала сервер должен открыть смену");
  const previous = sessionStorage.getItem(`${key}.prev`) ?? shift.startEvent?.requestId ?? null;
  if (step === "task") {
    const at = sessionStorage.getItem(`${key}.at`) ?? shift.startedAt;
    const result = await send(session, key, "task", version, previous, { kind: "segment_change", employeeId: employee.id, projectId: project.id, shiftId: shift.id, occurredAt: at, mode: "work", taskId: task.id });
    return `Сервер записал работу по заданию, версия ${result.version}`;
  }
  if (step === "end") {
    const result = await send(session, key, "end", version, previous, { kind: "shift_end", employeeId: employee.id, projectId: project.id, shiftId: shift.id, occurredAt: new Date().toISOString() });
    return `Сервер закрыл смену, версия ${result.version}`;
  }
  const reports = await v1<Page<{ submittedQuantity: string }>>(session, `/projects/${project.id}/execution/reports?employeeId=${employee.id}&taskId=${task.id}&day=${day}&limit=5`);
  if (reports.items[0]) return `Объём уже на сервере: ${reports.items[0].submittedQuantity} ${task.unit}`;
  const result = await send(session, key, "volume", version, previous ?? shift.endEvent?.requestId ?? null, {
    kind: "submit_volume", employeeId: employee.id, projectId: project.id, shiftId: shift.id, occurredAt: new Date().toISOString(),
    taskId: task.id, reportId: stableId(`${key}.report`), submittedQuantity: "1.250",
  });
  return `Сервер принял объём к учёту, версия ${result.version}. Это ещё не приёмка качества.`;
}

async function send(session: Session, key: string, step: string, version: number, previous: string | null, event: Record<string, unknown>) {
  const requestId = stableId(`${key}.${step}`);
  const payload = { requestId, expectedVersion: version, ...event, ...(previous ? { previousEventId: previous } : {}) };
  const body = await v1<{ results: { outcome: string; status: number; code?: string; result?: { version: number } }[] }>(session, "/execution/events", { events: [payload] });
  const result = body.results[0];
  if (!result || result.outcome === "error") throw new ApiError(result?.status ?? 409, result?.code ?? "event_rejected");
  sessionStorage.setItem(`${key}.prev`, requestId);
  return { version: result.result?.version ?? version + 1 };
}

async function approve(session: Session) {
  const { project, employee } = await scope(session);
  const day = moscowDay();
  const sheet = await v1<{ sourceHash: string; approvalVersion: number; status: string }>(session, `/projects/${project.id}/time/employees/${employee.id}/days/${day}`);
  if (sheet.status === "current") return "Часы этого дня уже утверждены";
  await v1(session, `/projects/${project.id}/time/employees/${employee.id}/days/${day}/approvals`, {
    requestId: stableId(`helios.approve.${project.id}.${employee.id}.${day}`),
    expectedApprovalVersion: sheet.approvalVersion,
    sourceHash: sheet.sourceHash,
    reason: "Сверка учебного дня",
    acknowledgeSuspicious: true,
  });
  return "Сервер утвердил часы";
}

async function downloadExcel(session: Session) {
  const { project } = await scope(session);
  const day = moscowDay();
  const response = await fetch(`/api/v1/projects/${project.id}/time/export.xlsx?from=${day}&to=${day}`, {
    headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `http_${response.status}` }));
    throw new ApiError(response.status, body.error ?? `http_${response.status}`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new ApiError(502, "Сервер прислал пустой файл");
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `helios-${day}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
  return `Сервер отдал Excel, ${blob.size} байт`;
}
