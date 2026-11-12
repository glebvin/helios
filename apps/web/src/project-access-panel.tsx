import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import type { AdmissionCheck, CheckPage } from "./admission-check";
import { ApiError, v1 } from "./v1";
import { DeskBadge } from "./kit";
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
  const [blocked, setBlocked] = useState(false), [confirmed, setConfirmed] = useState("");
  const generation = useRef(0), live = useRef(true);
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
      setData({ projectName: project.name, assignment, latest: checks.items[0] ?? null, membership }); setBlocked(false); return true;
    } catch (reason) {
      if (!live.current || ticket !== generation.current) return false;
      setData(null); setError(reason instanceof ApiError ? accessError(reason.status) : "Не удалось прочитать доступ и назначение. Повторите чтение.");
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
  const saved = (kind: string) => { setConfirmed(kind === "membership" ? "Сервер подтвердил изменение доступа учётной записи." : "Сервер подтвердил изменение назначения сотрудника."); void load(); };
  return <section className="panel project-access" aria-label="Доступ и назначение">
    <h2>Доступ и назначение</h2>
    {!projectId ? <p className="quiet">Выберите объект в шапке для управления доступом и назначением.</p> : <>
      {data ? <p className="quiet">Объект: {data.projectName}</p> : null}
      {loading && !data ? <p className="quiet" role="status">Читаем доступ и назначение…</p> : null}
      {error ? <p role="alert">{error} <button className="ghost" type="button" onClick={() => void load()}>Повторить чтение доступа</button></p> : null}
      <div className="access-part"><h3>Учётная запись</h3><p className="quiet">{userId ? "Привязана к сотруднику" : "Не привязана к сотруднику"}</p>
        {!userId ? <p className="quiet">Назначение такой карточки не создаёт вход. Для работника с входом используйте приглашение из раздела «Люди».</p> : session.role === "director" ? <>
          {data ? <DeskBadge>{data.membership?.status === "active" ? "Доступ к объекту открыт" : "Доступ к объекту закрыт"}</DeskBadge> : null}
          {data?.membership ? <p className="quiet">Роль: {data.membership.role === "master" ? "Прораб" : data.membership.role === "worker" ? "Работник" : data.membership.role}.</p> : null}
          {!blocked ? <AccessActions session={session} path={`/projects/${projectId}/memberships/${userId}`} kind="membership" disabled={loading || !data} activate={data ? accessCommand(data.membership?.version ?? 0, "active", "") : null} revoke={data?.membership?.status === "active" ? accessCommand(data.membership.version, "revoked", "") : null} active={data?.membership?.status === "active"} onRead={load} onSaved={() => saved("membership")} /> : null}
        </> : <p className="quiet">Доступом учётных записей управляет руководитель проекта.</p>}
      </div>
      <div className="access-part"><h3>Назначение сотрудника</h3>
        {data ? <><DeskBadge tone={data.assignment?.status === "active" && !data.assignment.currentAdmission.eligible ? "warn" : "neutral"}>{data.assignment?.status === "active" ? "Назначен на объект" : "Не назначен на объект"}</DeskBadge>
          {data.assignment?.status === "active" ? <><p>{data.assignment.currentAdmission.eligible ? "Сервер подтвердил актуальность допуска на момент чтения." : "Назначение сохранено, но условия допуска сейчас не выполнены."}</p><ul>{data.assignment.currentAdmission.reasons.map(reason => <li key={reason}>{admissionReason(reason)}</li>)}</ul></> : null}
          <p className="quiet">{data.latest ? `Последняя попытка №${data.latest.sequence}: ${data.latest.passed ? "пройдена" : "не пройдена"}.` : "Пока нет проверки допуска этого сотрудника на объекте."}</p>
        </> : null}
        {archived ? <p className="quiet">Архивного сотрудника нельзя назначить заново.</p> : null}
        {!userId ? <p className="quiet">После назначения сотрудник без привязанной учётной записи всё ещё не сможет войти.</p> : null}
        {session.role === "director" && !blocked ? <AccessActions session={session} path={`/projects/${projectId}/assignments/${employeeId}`} kind="assignment" disabled={loading || !data} activate={data?.latest?.passed && !archived ? accessCommand(data.assignment?.version ?? 0, "active", "", data.latest.id) : null} revoke={data?.assignment?.status === "active" ? accessCommand(data.assignment.version, "revoked", "") : null} active={data?.assignment?.status === "active"} onRead={load} onSaved={() => saved("assignment")} /> : null}
        {session.role !== "director" ? <p className="quiet">Назначение и снятие выполняет руководитель проекта.</p> : null}
      </div>
      <details className="documents-help"><summary>Как работают доступ и назначение</summary><p className="quiet">Учётная запись нужна для входа. Прорабу достаточно доступа к объекту, работнику дополнительно нужно назначение с актуальной проверкой допуска. При назначении сервер заново проверит последнюю попытку, шаблон и квалификации.</p></details>
      {confirmed ? <p className="quiet" role="status">{confirmed}</p> : null}
    </>}
  </section>;
}
function AccessActions({ session, path, kind, disabled, activate, revoke, active, onRead, onSaved }: { session: Session; path: string; kind: "membership" | "assignment"; disabled: boolean; activate: AccessCommand | null; revoke: AccessCommand | null; active: boolean; onRead: () => Promise<boolean>; onSaved: () => void }) {
  const key = `helios.project-access:${session.tenantId}:${session.userId}:${kind}:${path}`;
  const [pending, setPending] = useState<AccessCommand | null>(() => { try { return storedAccessCommand(sessionStorage.getItem(key)); } catch { return null; } });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [conflict, setConflict] = useState(false), [stored, setStored] = useState(true);
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
      setError(accessError(status, reason instanceof ApiError ? reason.message : ""));
      if (status !== null && status >= 400 && status < 500) { remember(null); if (status === 409) setConflict(true); }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reread() { if (lock.current) return; lock.current = true; setBusy(true); if (await onRead()) { setConflict(false); setError(""); } lock.current = false; setBusy(false); }
  const openLabel = kind === "membership" ? "Открыть доступ к объекту" : active ? "Обновить назначение по последней проверке" : "Назначить на объект";
  const closeLabel = kind === "membership" ? "Закрыть доступ к объекту" : "Снять назначение";
  return <div className="access-actions">
    {error ? <p role="alert">{error}</p> : null}
    {pending ? <><p className="quiet">Предыдущее изменение не подтверждено. Повтор отправит ту же команду.</p><button className="fill" type="button" disabled={busy} onClick={() => void send(pending)}>{busy ? "Подтверждаем…" : kind === "membership" ? "Повторить изменение доступа" : "Повторить изменение назначения"}</button>{!stored ? <p className="quiet">Номер команды не сохранён браузером. Повторите здесь, не закрывая карточку.</p> : null}</> : <div className="template-bar">
      {kind === "assignment" || !active ? <button className="fill" type="button" disabled={busy || disabled || conflict || !activate} onClick={() => { if (activate) void send(activate); }}>{openLabel}</button> : null}
      {active ? <button className="ghost" type="button" disabled={busy || disabled || conflict || !revoke} onClick={() => { if (revoke) void send(revoke); }}>{closeLabel}</button> : null}
    </div>}
    {error || conflict ? <button className="ghost" type="button" disabled={busy} onClick={() => void reread()}>Перечитать состояние</button> : null}
  </div>;
}
