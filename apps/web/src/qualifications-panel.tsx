import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { ApiError, v1 } from "./v1";
import { Dialog } from "./dialog";
import { DeskBadge, DeskSelect } from "./kit";
import { staffRequest } from "./staff-form";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { qualificationError, qualificationState, type Qualification, type QualificationPage } from "./qualifications";

const describe = (reason: unknown) => qualificationError(reason instanceof ApiError ? reason : {});
export function QualificationsPanel({ session, employeeId, archived }: { session: Session; employeeId: string; archived: boolean }) {
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [page, setPage] = useState<QualificationPage | null>(null);
  const [day, setDay] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [editor, setEditor] = useState<Qualification | "new" | null>(null);
  const [saved, setSaved] = useState(""), [savedPulse, setSavedPulse] = useState(0);
  const path = `/employees/${employeeId}/qualifications`;
  useEffect(() => {
    const refresh = () => setPass(value => value + 1);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const [rows, clock] = await Promise.all([
          v1<QualificationPage>(session, `${path}?limit=25&offset=${offset}`),
          v1<{ day: string }>(session, "/overview"),
        ]);
        if (!live) return;
        setPage(rows); setDay(clock.day); setError(""); setBlocked(false);
        if (offset && offset >= rows.total) setOffset(Math.max(0, Math.floor((rows.total - 1) / 25) * 25));
      } catch (reason) {
        if (!live) return;
        setPage(null); setDay(""); setError(describe(reason));
        if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setBlocked(true); setEditor(null); }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, path, offset, pass]);
  const writable = session.role === "director" && !archived && !blocked;
  return <section className="panel qualifications" aria-label="Квалификации">
    <div className="documents-heading">
      <div className="documents-title"><h2>Квалификации</h2><NoteMark label="Как устроены квалификации"><p>Срок действует включительно. Реквизиты — номер или ссылка на документ, не загрузка скана.</p>{archived ? <p>У архивного сотрудника квалификации доступны для чтения.</p> : null}</NoteMark></div>
      {writable ? <button className="ghost desk-action" type="button" onClick={() => { setEditor("new"); setSaved(""); }}>Добавить квалификацию</button> : null}
    </div>
    {loading && !page ? <p className="quiet" role="status">Читаем квалификации…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost" type="button" onClick={() => setPass(value => value + 1)}>Повторить чтение</button></p> : null}
    {page && !error ? <>
      {page.items.length === 0 ? <p className="quiet">Квалификаций пока нет.</p> : <div className="qualification-list">{page.items.map(row => {
        const state = qualificationState(row, day);
        const meta = [`Код ${row.code}`, row.documentReference, row.validUntil ? `по ${row.validUntil.split("-").reverse().join(".")}` : "без срока"].filter(Boolean).join(" · ");
        return <article className="qualification-row" key={row.id}>
          <div><b>{row.title}</b><span className="quiet">{meta}</span></div>
          <DeskBadge tone={state === "Действует" ? "accent" : "neutral"}>{state}</DeskBadge>
          {writable && row.status === "active" ? <button className="ghost desk-action" type="button" onClick={() => { setEditor(row); setSaved(""); }}>Изменить</button> : null}
        </article>;
      })}</div>}
      {page.total > 25 ? <div className="qualification-bar"><button className="ghost desk-action" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Назад</button><span className="quiet">{offset + 1}–{offset + page.items.length} из {page.total}</span><button className="ghost desk-action" disabled={loading || offset + page.items.length >= page.total} onClick={() => setOffset(offset + 25)}>Далее</button></div> : null}
    </> : null}
    <Flash message={saved} pulse={savedPulse} />
    {editor && writable ? <QualificationEditor session={session} path={path} row={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={row => { setEditor(null); setSaved(`Сервер записал «${row.title}».`); setSavedPulse(value => value + 1); setPass(value => value + 1); }} /> : null}
  </section>;
}

function QualificationEditor({ session, path, row, onClose, onSaved }: { session: Session; path: string; row: Qualification | null; onClose: () => void; onSaved: (row: Qualification) => void }) {
  const [source, setSource] = useState(row);
  const [title, setTitle] = useState(row?.title ?? "");
  const [code, setCode] = useState(row?.code ?? "");
  const [reference, setReference] = useState(row?.documentReference ?? "");
  const [until, setUntil] = useState(row?.validUntil ?? "");
  const [status, setStatus] = useState<"active" | "revoked">(row?.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stored, setStored] = useState(true);
  const lock = useRef(false);
  const request = useRef({ id: "", key: "" });
  const pendingKey = `helios.qualification:${session.tenantId}:${session.userId}:${path}:${row?.id ?? "new"}`;
  async function submit() {
    if (lock.current || source?.status === "revoked") return;
    const fields = { title: title.trim(), documentReference: reference.trim() || null, validUntil: until || null,
      ...(source ? { expectedVersion: source.version, status } : { code: code.trim() }) };
    const key = JSON.stringify(fields);
    if (!request.current.id) {
      try { const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous; } catch { /* In-memory retry remains available. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await v1<Qualification>(session, source ? `${path}/${source.id}` : path, { ...fields, requestId: request.current.id }, source ? "PUT" : "POST");
      try { sessionStorage.removeItem(pendingKey); } catch { /* Server response is authoritative. */ }
      onSaved(result);
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readCurrent() {
    if (!source || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      let offset = 0;
      while (true) {
        const page = await v1<QualificationPage>(session, `${path}?limit=100&offset=${offset}`);
        const current = page.items.find(item => item.id === source.id);
        if (current) {
          setSource(current); setTitle(current.title); setReference(current.documentReference ?? ""); setUntil(current.validUntil ?? ""); setStatus(current.status); setError(""); request.current = { id: "", key: "" }; return;
        }
        offset += page.items.length;
        if (offset >= page.total || !page.items.length) throw new ApiError(404, "not_found");
      }
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={row ? "Изменить квалификацию" : "Новая квалификация"} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset className="employee-fields" disabled={busy || source?.status === "revoked"}>
        <label className="field"><span>Код квалификации</span><input required maxLength={80} value={code} disabled={!!row} onChange={event => setCode(event.target.value)} /></label>
        <label className="field"><span>Название квалификации</span><input required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="field"><span>Реквизиты документа</span><input maxLength={500} value={reference} onChange={event => setReference(event.target.value)} /></label>
        <label className="field"><span>Действует по</span><input type="date" value={until} onChange={event => setUntil(event.target.value)} /></label>
        <p className="quiet">Код связывает квалификацию с требованиями допуска и после создания не меняется.</p>
        <p className="quiet">Пустая дата означает отсутствие срока. Истёкшая квалификация не считается действующей.</p>
        {row ? <DeskSelect label="Состояние квалификации" value={status} options={[{ value: "active", label: "Действует с учётом срока" }, { value: "revoked", label: "Отозвать" }]} onChange={value => setStatus(value === "revoked" ? "revoked" : "active")} /> : null}
        {status === "revoked" ? <p className="quiet">Отзыв окончательный. Квалификация перестанет действовать после подтверждения сервера.</p> : null}
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
      {error && source ? <button className="ghost" type="button" disabled={busy} onClick={() => void readCurrent()}>Прочитать актуальную запись</button> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || source?.status === "revoked" || !title.trim() || !code.trim()}>{busy ? "Записываем…" : "Сохранить квалификацию"}</button>
    </form>
  </Dialog>;
}
