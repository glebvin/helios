import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { activeForNewTask, type WorkType, type Zone } from "./catalog";
import { Dialog } from "./dialog";
import { DeskSelect } from "./kit";
import { staffRequest } from "./staff-form";
import type { ServerEmployee } from "./staff-list";
import { ApiError, v1, v1Items } from "./v1";
import {
  taskDraftBody, taskDraftError, taskDraftFrom, taskDraftValidation,
  type TaskDraft,
} from "./task-draft";
import type { ServerTask } from "./task-read";

type Member = { userId: string; role: string; status: string };

const describe = (reason: unknown) => taskDraftError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");

export function TaskDraftDialog({ session, projectId, day, task, onClose, onSaved }: {
  session: Session;
  projectId: string;
  day: string;
  task: ServerTask | null;
  onClose: () => void;
  onSaved: (row: ServerTask) => void;
}) {
  const [zones, setZones] = useState<Zone[]>([]);
  const [types, setTypes] = useState<WorkType[]>([]);
  const [people, setPeople] = useState<ServerEmployee[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [timezone, setTimezone] = useState("");
  const [source, setSource] = useState(task);
  const [draft, setDraft] = useState<TaskDraft>(() => taskDraftFrom(task, day, session.userId, "UTC"));
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pass, setPass] = useState(0);
  const [error, setError] = useState("");
  const [batches, setBatches] = useState<{ id: string; materialName: string; batchCode: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(true);
  const lock = useRef(false);
  const request = useRef({ id: "", key: "" });
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pendingKey = `helios.task-draft:${session.tenantId}:${session.userId}:${projectId}:${source?.id ?? "new"}`;
  const workType = types.find((item) => item.id === draft.workTypeId) ?? null;
  const problem = ready ? taskDraftValidation(draft, !!workType?.requiresRd, !!workType?.requiresMaterialControl) : "";
  useEffect(() => {
    let live = true;
    setReady(false); setLoadError("");
    void (async () => {
      try {
        const [zoneItems, typeItems, peopleItems, clock] = await Promise.all([
          v1Items<Zone>(session, `/projects/${projectId}/zones`),
          v1Items<WorkType>(session, `/projects/${projectId}/work-types`),
          v1Items<ServerEmployee>(session, `/employees?projectId=${projectId}`),
          v1<{ timezone: string }>(session, "/overview"),
        ]);
        const memberships = session.role === "director"
          ? await v1Items<Member>(session, `/projects/${projectId}/memberships`)
          : [];
        if (!live) return;
        setZones(activeForNewTask(zoneItems));
        setTypes(activeForNewTask(typeItems));
        setPeople(peopleItems.filter((item) => item.status === "active"));
        setMembers(memberships.filter((item) => item.status === "active" && (item.role === "director" || item.role === "master")));
        setTimezone(clock.timezone);
        setDraft(taskDraftFrom(task, day, session.userId, clock.timezone));
        setReady(true);
      } catch (reason) {
        if (live) setLoadError(describe(reason));
      }
    })();
    return () => { live = false; };
  }, [session, projectId, day, task, pass]);
  useEffect(() => {
    if (!workType?.requiresMaterialControl || !draft.zoneId || !draft.workTypeId) { setBatches([]); return; }
    let live = true;
    void v1<{ items: { id: string; materialName: string; batchCode: string }[] }>(session, `/projects/${projectId}/material-batches?usable=1&zoneId=${draft.zoneId}&workTypeId=${draft.workTypeId}&limit=100`)
      .then((page) => { if (live) setBatches(page.items); })
      .catch(() => { if (live) setBatches([]); });
    return () => { live = false; };
  }, [session, projectId, draft.zoneId, draft.workTypeId, workType?.requiresMaterialControl]);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  const responsibles = responsibleOptions(session, people, members);
  if (source?.responsibleUserId && !responsibles.some((item) => item.value === source.responsibleUserId)) {
    responsibles.push({ value: source.responsibleUserId, label: "Текущий ответственный" });
  }
  async function submit() {
    if (lock.current || problem || !timezone) return;
    const fields = taskDraftBody(draft, "", timezone, source?.version);
    const { requestId: _ignored, ...identity } = fields;
    const key = JSON.stringify(identity);
    if (!request.current.id) {
      try {
        const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
        if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous;
      } catch { /* The open form can still repeat the same attempt. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const path = source ? `/projects/${projectId}/tasks/${source.id}` : `/projects/${projectId}/tasks`;
      const row = await v1<ServerTask>(session, path, taskDraftBody(draft, request.current.id, timezone, source?.version), source ? "PUT" : "POST");
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      onSaved(row);
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readCurrent() {
    if (!source || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const row = await v1<ServerTask>(session, `/projects/${projectId}/tasks/${source.id}`);
      setSource(row); setDraft(taskDraftFrom(row, day, session.userId, timezone)); setError(""); request.current = { id: "", key: "" };
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={source ? "Черновик задания" : "Новое задание"} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      {!ready && !loadError ? <p className="quiet" role="status">Читаем зоны, виды и людей…</p> : null}
      {loadError ? <p role="alert">{loadError} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить загрузку</button></p> : null}
      {ready ? <fieldset className="employee-fields" disabled={busy}>
        <DeskSelect label="Зона" value={draft.zoneId} options={selectOptions(zones.map((item) => ({ value: item.id, label: item.name })), "Выберите зону")} onChange={(zoneId) => setDraft({ ...draft, zoneId, materialBatchId: "" })} />
        <DeskSelect label="Вид работ" value={draft.workTypeId} options={selectOptions(types.map((item) => ({ value: item.id, label: item.name })), "Выберите вид")} onChange={(workTypeId) => setDraft({ ...draft, workTypeId, materialBatchId: "" })} />
        {workType?.requiresMaterialControl ? <DeskSelect label="Принятая партия" value={draft.materialBatchId} options={selectOptions(batches.map((item) => ({ value: item.id, label: `${item.materialName} · ${item.batchCode}` })), batches.length ? "Выберите партию" : "Принятых партий нет")} onChange={(materialBatchId) => setDraft({ ...draft, materialBatchId })} /> : null}
        <p className="quiet">Единица берётся из вида работ{workType ? `: ${workType.unit}` : ""}.</p>
        <label className="field"><span>Название</span><input required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label className="field"><span>День</span><input type="date" required value={draft.workDate} onChange={(event) => setDraft({ ...draft, workDate: event.target.value })} /></label>
        <label className="field"><span>Объём</span><input required inputMode="decimal" value={draft.plannedQuantity} onChange={(event) => setDraft({ ...draft, plannedQuantity: event.target.value })} /></label>
        <label className="field"><span>Начало</span><input type="time" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
        <label className="field"><span>Конец</span><input type="time" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>
        <DeskSelect label="Исполнитель" value={draft.assigneeEmployeeId} options={selectOptions(people.map((item) => ({ value: item.id, label: item.fullName })), "Выберите исполнителя")} onChange={(assigneeEmployeeId) => setDraft({ ...draft, assigneeEmployeeId })} />
        {responsibles.length > 1 ? <DeskSelect label="Ответственный" value={draft.responsibleUserId} options={responsibles} onChange={(responsibleUserId) => setDraft({ ...draft, responsibleUserId })} /> : <p className="quiet">Ответственный: {session.name}.{session.role === "master" ? " Список других ответственных прорабу не отдан." : ""}</p>}
        <label className="field"><span>Рабочая документация</span><input maxLength={500} value={draft.rdReference} onChange={(event) => setDraft({ ...draft, rdReference: event.target.value })} /></label>
      </fieldset> : null}
      {problem ? <p className="quiet">{problem}</p> : null}
      {error && source ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void readCurrent()}>Прочитать актуальную запись</button> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !ready || !!problem || source?.status !== undefined && source.status !== "draft"}>{busy ? "Записываем…" : "Сохранить черновик"}</button>
    </form>
  </Dialog>;
}

function selectOptions(items: { value: string; label: string }[], empty: string) {
  return [{ value: "", label: empty }, ...items];
}

function responsibleOptions(session: Session, people: ServerEmployee[], members: Member[]) {
  const names = new Map(people.filter((item) => item.userId).map((item) => [item.userId, item.fullName]));
  const role = (value: string) => value === "director" ? "руководитель" : "прораб";
  const options = [{ value: session.userId, label: session.name }];
  for (const member of members) {
    if (member.userId === session.userId || options.some((item) => item.value === member.userId)) continue;
    options.push({ value: member.userId, label: names.get(member.userId) ?? role(member.role) });
  }
  return options;
}
