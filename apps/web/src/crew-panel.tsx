import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { ApiError, v1, v1Collection } from "./v1";
import { DeskBadge, DeskEmpty, DeskSelect } from "./kit";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { addable, crewAttempt, crewError, memberFacts, memberVersion, type Crew, type CrewAssignment, type CrewAttempt } from "./crew";

export function CrewPanel({ session, projectId }: { session: Session; projectId: string }) {
  const reduce = useReducedMotion();
  const writable = session.role === "director";
  const [pass, setPass] = useState(0);
  const [loading, setLoading] = useState(true);
  const [crews, setCrews] = useState<Crew[] | null>(null);
  const [assignments, setAssignments] = useState<CrewAssignment[]>([]);
  const [names, setNames] = useState<{ id: string; fullName: string }[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const lock = useRef(false);
  const inFlightScope = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState("");
  const scope = `${session.tenantId}:${session.userId}:${projectId}:${session.token}`;
  const activeScope = useRef<string | null>(scope);
  activeScope.current = scope;
  const pending = useRef<CrewAttempt | null>(null);
  const fresh = loadedFor === scope;
  useEffect(() => {
    activeScope.current = scope;
    setPicked(""); setName(""); setEmployeeId("");
    return () => { if (activeScope.current === scope) activeScope.current = null; };
  }, [scope]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible") setPass(value => value + 1); };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);
  const nameOf = (id: string) => names.find((item) => item.id === id)?.fullName ?? "Имя не пришло";
  useEffect(() => {
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [crewPage, assignmentPage, people] = await Promise.all([
          v1Collection<Crew>(session, `/projects/${projectId}/crews?limit=100&offset=0`),
          v1Collection<CrewAssignment>(session, `/projects/${projectId}/assignments?limit=100&offset=0`),
          v1Collection<{ id: string; fullName: string }>(session, `/employees?projectId=${projectId}&limit=100&offset=0`),
        ]);
        if (!live) return;
        setCrews(crewPage.items);
        setAssignments(assignmentPage.items);
        setNames(people.items);
        setTruncated(crewPage.items.length < crewPage.total || assignmentPage.items.length < assignmentPage.total || people.items.length < people.total);
        setError("");
        setLoadedFor(scope);
      } catch (reason) {
        if (!live) return;
        setCrews(null);
        setError(reason instanceof ApiError ? crewError(reason.status, reason.message) : crewError(null));
        setLoadedFor(scope);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [scope, pass]);
  const selected = crews?.find((crew) => crew.id === picked) ?? null;
  const choices = crews ? addable(assignments, crews) : [];
  async function command(path: string, body: Record<string, unknown>, method: "POST" | "PUT", done: string) {
    if (lock.current || !fresh || loading || !crews || truncated) return false;
    lock.current = true;
    inFlightScope.current = scope;
    setBusy(true);
    setError("");
    const storageKey = `helios.crew-command:${session.tenantId}:${session.userId}:${projectId}`;
    const { requestId: _ignored, ...payload } = body;
    const signature = JSON.stringify([storageKey, path, method, payload]);
    let stored: unknown = pending.current;
    if (!stored || (stored as CrewAttempt).signature !== signature) {
      try { stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch { stored = null; }
    }
    const attempt = crewAttempt(stored, signature, () => crypto.randomUUID());
    pending.current = attempt;
    try { sessionStorage.setItem(storageKey, JSON.stringify(attempt)); } catch { /* The mounted form retains the same attempt. */ }
    try {
      await v1(session, path, { ...payload, requestId: attempt.requestId }, method);
      try {
        if (JSON.parse(sessionStorage.getItem(storageKey) ?? "null")?.requestId === attempt.requestId) sessionStorage.removeItem(storageKey);
      } catch { /* The server acknowledgement is authoritative. */ }
      if (pending.current?.requestId === attempt.requestId) pending.current = null;
      if (activeScope.current !== scope) return false;
      setSaved(done);
      setPulse((value) => value + 1);
      setPass((value) => value + 1);
      return true;
    } catch (reason) {
      if (activeScope.current !== scope) return false;
      setError(reason instanceof ApiError ? crewError(reason.status, reason.message) : "Нет подтверждения сервера. Повторите эту команду без изменений.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (!projectId) return <DeskEmpty title="Объект не выбран" description="Состав бригады читается после выбора объекта." />;
  if (!fresh) return <section className="panel" aria-label="Бригады" aria-busy="true"><h2>Бригады</h2><p className="quiet" role="status">Читаем состав…</p></section>;
  return <section className="panel" aria-label="Бригады">
    <div className="panel-head">
      <h2>Бригады</h2>
      <NoteMark label="Три разные записи"><p>Доступ пускает в объект. Назначение с допуском позволяет получить задание. Состав бригады — отдельная запись: снятие с бригады назначение не отзывает, а чужой отчёт объёма не создаёт.</p></NoteMark>
    </div>
    {writable ? <form className="template-bar" onSubmit={(event) => { event.preventDefault(); const title = name.trim(); void command(`/projects/${projectId}/crews`, { name: title }, "POST", "Сервер записал бригаду.").then((ok) => { if (ok) setName(""); }); }}>
      <label className="field"><span>Название</span><input aria-label="Название бригады" maxLength={200} disabled={(busy && inFlightScope.current === scope) || loading || !crews} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <button className="fill desk-action" type="submit" disabled={busy || loading || !crews || truncated || !name.trim()}>Создать бригаду</button>
    </form> : null}
    {loading && !crews ? <p className="quiet" role="status">Читаем состав…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {truncated ? <p className="quiet">Сервер отдал не весь список. Состав по неполной странице не меняем.</p> : null}
    {crews && crews.length === 0 ? <DeskEmpty title="Бригад нет" description="Назначение на объект уже можно сделать без бригады. Состав появится здесь после записи на сервере." /> : null}
    {crews && crews.length > 0 ? <div className="sheet-split">
      <table className="sheet">
        <thead><tr><th>Бригада</th><th>В составе</th><th>Сняты</th></tr></thead>
        <tbody>
          {crews.map((crew) => <tr className={selected?.id === crew.id ? "is-link is-on" : "is-link"} key={crew.id} tabIndex={0} onClick={() => setPicked(crew.id)} onKeyDown={(event) => { if (event.key === "Enter") setPicked(crew.id); }}>
            <td><b>{crew.name}</b></td>
            <td>{crew.members.filter((member) => member.status === "active").length}</td>
            <td>{crew.members.filter((member) => member.status === "revoked").length}</td>
          </tr>)}
        </tbody>
      </table>
      {selected ? <motion.div key={selected.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}>
        <h2>{selected.name}</h2>
        {selected.members.length === 0 ? <p className="quiet">В этой бригаде ещё никого не было.</p> : null}
        {selected.members.map((member) => {
          const facts = memberFacts(member.status, member.currentAdmission.eligible);
          return <div className="rowline crew-member" key={member.employeeId}>
            <b>{nameOf(member.employeeId)}</b>
            <DeskBadge tone={member.status === "active" ? "accent" : "neutral"}>{facts.membership}</DeskBadge>
            <span className="quiet">{facts.admission}. Версия {member.version}.</span>
            {writable && !truncated && member.status === "active" ? <button className="ghost desk-action" type="button" disabled={busy || loading} onClick={() => void command(`/projects/${projectId}/crews/${selected.id}/members/${member.employeeId}`, { expectedVersion: member.version, status: "revoked" }, "PUT", "Сервер снял человека с бригады.")}>Снять</button> : null}
            {writable && !truncated && member.status === "revoked" ? <button className="ghost desk-action" type="button" disabled={busy || loading || !member.currentAdmission.eligible} onClick={() => void command(`/projects/${projectId}/crews/${selected.id}/members/${member.employeeId}`, { expectedVersion: member.version, status: "active" }, "PUT", "Сервер вернул человека в состав.")}>Вернуть</button> : null}
          </div>;
        })}
        {writable && !truncated ? <div className="template-bar">
          <DeskSelect label="Сотрудник" value={employeeId} options={[{ value: "", label: "Кого добавить" }, ...choices.map((row) => ({ value: row.employeeId, label: nameOf(row.employeeId) }))]} onChange={setEmployeeId} />
          <button className="fill desk-action" type="button" disabled={busy || loading || !employeeId} onClick={() => void command(`/projects/${projectId}/crews/${selected.id}/members/${employeeId}`, { expectedVersion: memberVersion(selected.members, employeeId), status: "active" }, "PUT", "Сервер записал человека в состав.").then((ok) => { if (ok) setEmployeeId(""); })}>В состав</button>
        </div> : null}
      </motion.div> : <p className="quiet">Выберите бригаду, чтобы прочитать состав.</p>}
    </div> : null}
    <Flash message={saved} pulse={pulse} />
  </section>;
}
