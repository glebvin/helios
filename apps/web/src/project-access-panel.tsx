import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import type { AdmissionCheck, CheckPage } from "./admission-check";
import { ApiError, v1 } from "./v1";
import { DeskBadge } from "./kit";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { accessCommand, accessError, admissionReason, storedAccessCommand, type AccessCommand, type ProjectAssignment, type ProjectMembership } from "./project-access";

type AccessState = { projectName: string; assignment: ProjectAssignment | null; membership: ProjectMembership | null; latest: AdmissionCheck | null };
async function findRow<T>(session: Session, path: string, matches: (row: T) => boolean): Promise<T | null> {
  let offset = 0;
  while (true) {
    const page = await v1<{ items: T[]; total: number }>(session, `${path}?limit=100&offset=${offset}`);
    const row = page.items.find(matches); if (row) return row;
    offset += page.items.length; if (offset >= page.total || !page.items.length) return null;
  }
}
export function ProjectAccessPanel({ session, projectId, employeeId, userId, archived }: { session: Session; projectId: string; employeeId: string; userId: string | null; archived: boolean }) {
  const [data, setData] = useState<AccessState | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false), [confirmed, setConfirmed] = useState(""), [pulse, setPulse] = useState(0);
  const generation = useRef(0), live = useRef(true), latest = useRef<AccessState | null>(null);
  const load = useCallback(async () => {
    if (!projectId) return false;
    const ticket = ++generation.current; setLoading(true); setError("");
    try {
      const project = await v1<{ name: string }>(session, `/projects/${projectId}`);
      const [assignment, checks, membership] = await Promise.all([
        findRow<ProjectAssignment>(session, `/projects/${projectId}/assignments`, row => row.employeeId === employeeId),
        v1<CheckPage>(session, `/employees/${employeeId}/admission-checks?projectId=${projectId}&limit=1`),
        session.role === "director" && userId ? findRow<ProjectMembership>(session, `/projects/${projectId}/memberships`, row => row.userId === userId) : Promise.resolve(null),
      ]);
      if (!live.current || ticket !== generation.current) return false;
      const fresh = { projectName: project.name, assignment, latest: checks.items[0] ?? null, membership };
      latest.current = fresh; setData(fresh); setBlocked(false); return true;
    } catch (reason) {
      if (!live.current || ticket !== generation.current) return false;
      latest.current = null; setData(null); setError(reason instanceof ApiError ? accessError(reason.status) : "Не удалось прочитать доступ и назначение. Повторите чтение.");
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) setBlocked(true);
      return false;
    } finally { if (live.current && ticket === generation.current) setLoading(false); }
  }, [session.token, session.tenantId, session.role, projectId, employeeId, userId]);
  useEffect(() => {
    live.current = true; void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh); const timer = window.setInterval(refresh, 60000);
    return () => { live.current = false; generation.current++; window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [load]);
  const saved = (kind: string) => { void load().then((ok) => {
    const fresh = ok ? latest.current : null;
    if (!fresh) return;
    const text = kind === "membership" ? "Сервер подтвердил изменение доступа."
      : fresh.assignment?.status === "active" && fresh.assignment.currentAdmission.eligible ? "Сервер подтвердил актуальность допуска на момент чтения."
      : fresh.assignment?.status === "active" ? "Назначение сохранено, но условия допуска сейчас не выполнены."
      : "Сервер подтвердил изменение назначения.";
    setConfirmed(text); setPulse(value => value + 1);
  }); };
  const roleName = data?.membership?.role === "master" ? "Прораб" : data?.membership?.role === "worker" ? "Работник" : data?.membership?.role;
  const admissionProblem = data?.assignment?.status === "active" && !data.assignment.currentAdmission.eligible
    ? data.assignment.currentAdmission.reasons.map(admissionReason).join(" ")
    : "";
  return <section className="panel project-access" aria-label="Доступ и назначение">
    <div className="documents-heading">
      <div className="documents-title"><h2>Доступ и назначение</h2><NoteMark label="Как устроены доступ и назначение"><p>Учётная запись нужна для входа. Прорабу достаточно доступа к объекту, работнику дополнительно нужно назначение с актуальной проверкой допуска.</p><p>При назначении сервер заново проверит последнюю попытку, шаблон и квалификации.</p>{data ? <p>Объект: {data.projectName}.</p> : null}{!userId ? <p>Назначение карточки без входа не создаёт учётную запись. Для работника с входом используйте приглашение из раздела «Люди».</p> : null}{roleName ? <p>Роль учётной записи: {roleName}.</p> : null}{data ? <p>{data.latest ? `Последняя попытка №${data.latest.sequence}: ${data.latest.passed ? "пройдена" : "не пройдена"}.` : "Пока нет проверки допуска этого сотрудника на объекте."}</p> : null}{admissionProblem ? <p>Условия допуска сейчас не выполнены. {admissionProblem}</p> : null}{archived ? <p>Архивного сотрудника нельзя назначить заново.</p> : null}{session.role !== "director" ? <p>Доступ и назначение меняет руководитель проекта.</p> : null}</NoteMark></div>
    </div>
    {!projectId ? <p className="quiet">Выберите объект в шапке для управления доступом и назначением.</p> : <>
      {loading && !data ? <p className="quiet" role="status">Читаем доступ и назначение…</p> : null}
      {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => void load()}>Повторить чтение</button></p> : null}
      <div className="access-part">
        <div className="access-copy"><h3>Учётная запись</h3>{userId && data ? <DeskBadge>{data.membership?.status === "active" ? "Доступ открыт" : "Доступ закрыт"}</DeskBadge> : <span className="quiet">{userId ? "Привязана" : "Не привязана"}</span>}</div>
        {session.role === "director" && userId && !blocked ? <AccessActions session={session} path={`/projects/${projectId}/memberships/${userId}`} kind="membership" disabled={loading || !data} activate={data ? accessCommand(data.membership?.version ?? 0, "active", "") : null} revoke={data?.membership?.status === "active" ? accessCommand(data.membership.version, "revoked", "") : null} active={data?.membership?.status === "active"} onRead={load} onSaved={() => saved("membership")} /> : null}
      </div>
      <div className="access-part">
        <div className="access-copy"><h3>Назначение</h3>{data ? <DeskBadge tone={data.assignment?.status === "active" && !data.assignment.currentAdmission.eligible ? "warn" : "neutral"}>{data.assignment?.status === "active" ? "Назначен" : "Не назначен"}</DeskBadge> : null}{admissionProblem ? <span className="check-stale">Допуск не актуален</span> : null}</div>
        {session.role === "director" && !blocked ? <AccessActions session={session} path={`/projects/${projectId}/assignments/${employeeId}`} kind="assignment" disabled={loading || !data} activate={data?.latest?.passed && !archived ? accessCommand(data.assignment?.version ?? 0, "active", "", data.latest.id) : null} revoke={data?.assignment?.status === "active" ? accessCommand(data.assignment.version, "revoked", "") : null} active={data?.assignment?.status === "active"} onRead={load} onSaved={() => saved("assignment")} /> : null}
      </div>
      <Flash message={confirmed} pulse={pulse} />
    </>}
  </section>;
}
function AccessActions({ session, path, kind, disabled, activate, revoke, active, onRead, onSaved }: { session: Session; path: string; kind: "membership" | "assignment"; disabled: boolean; activate: AccessCommand | null; revoke: AccessCommand | null; active: boolean; onRead: () => Promise<boolean>; onSaved: () => void }) {
  const key = `helios.project-access:${session.tenantId}:${session.userId}:${kind}:${path}`;
  const [pending, setPending] = useState<AccessCommand | null>(() => { try { return storedAccessCommand(sessionStorage.getItem(key)); } catch { return null; } });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [stored, setStored] = useState(true), [pulse, setPulse] = useState(0);
  const lock = useRef(false);
  function remember(command: AccessCommand | null) {
    setPending(command);
    try { if (command) sessionStorage.setItem(key, JSON.stringify(command)); else sessionStorage.removeItem(key); setStored(true); } catch { setStored(false); }
  }
  async function send(command: AccessCommand) {
    if (lock.current) return;
    const body = command.requestId ? command : { ...command, requestId: crypto.randomUUID() };
    remember(body); lock.current = true; setBusy(true); setError("");
    try { await v1(session, path, body, "PUT"); remember(null); setConflict(false); onSaved(); }
    catch (reason) {
      const status = reason instanceof ApiError ? reason.status : null;
      setError(accessError(status, reason instanceof ApiError ? reason.message : "")); setPulse(value => value + 1);
      if (status !== null && status >= 400 && status < 500) { remember(null); if (status === 409) setConflict(true); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reread() { if (lock.current) return; lock.current = true; setBusy(true); if (await onRead()) { setConflict(false); setError(""); } lock.current = false; setBusy(false); }
  const openLabel = kind === "membership" ? "Открыть доступ к объекту" : active ? "Обновить" : "Назначить на объект";
  const closeLabel = kind === "membership" ? "Закрыть доступ к объекту" : "Снять назначение";
  return <div className="access-actions">
    {error ? <p className="access-feedback" role="alert">{error}</p> : null}
    {!busy && pending ? <p className="access-feedback quiet">Предыдущее изменение не подтверждено. Повтор отправит ту же команду.</p> : null}
    {!stored ? <p className="access-feedback quiet">Номер команды не сохранён браузером. Повторите здесь, не закрывая карточку.</p> : null}
    {pending ? <button className="fill desk-action" type="button" disabled={busy} onClick={() => void send(pending)}>{busy ? "Подтверждаем…" : kind === "membership" ? "Повторить доступ" : "Повторить назначение"}</button> : <div className="template-bar">
      {kind === "assignment" || !active ? <button className="fill desk-action" type="button" aria-label={kind === "assignment" && active ? "Обновить назначение по последней проверке" : undefined} disabled={busy || disabled || conflict || !activate} onClick={() => { if (activate) void send(activate); }}>{openLabel}</button> : null}
      {active ? <button className="ghost desk-action" type="button" disabled={busy || disabled || conflict || !revoke} onClick={() => { if (revoke) void send(revoke); }}>{closeLabel}</button> : null}
    </div>}
    {error || conflict ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void reread()}>Перечитать</button> : null}
  </div>;
}
