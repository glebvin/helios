import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { staffRequest } from "./staff-form";
import { ApiError, v1 } from "./v1";
import {
  canWriteFrontTemplate, frontDraft, frontError, frontTemplateBody, frontTemplateValidation,
  type FrontDraft, type FrontTemplate,
} from "./front-check";

const describe = (reason: unknown) => frontError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");

export function FrontTemplatePanel({ session, projectId, writable }: { session: Session; projectId: string; writable: boolean }) {
  const [row, setRow] = useState<FrontTemplate | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [pass, setPass] = useState(0);
  const canWrite = writable && canWriteFrontTemplate(session.role);
  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const template = await v1<FrontTemplate>(session, `/projects/${projectId}/front-template`);
        if (live) { setRow(template); setError(""); }
      } catch (reason) {
        if (!live) return;
        if (reason instanceof ApiError && reason.status === 404) { setRow(null); setError(""); return; }
        setRow(undefined); setError(describe(reason));
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, pass]);
  return <section className="panel admission-template" aria-label="Чек-лист фронта">
    <div className="documents-heading">
      <div className="documents-title">
        <h2>Чек-лист фронта</h2>
        <NoteMark label="Как устроен чек-лист фронта"><p>Критичный ответ «нет» блокирует готовность. Контроль материалов, приёмка предшественника и исполнительная документация, если их требует вид работ, остаются блокирующими: этих модулей нет.</p></NoteMark>
      </div>
      {canWrite && row !== undefined ? <button className="ghost desk-action" type="button" onClick={() => setEditing(true)}>{row ? "Изменить" : "Создать чек-лист"}</button> : null}
    </div>
    {loading && row === undefined ? <p className="quiet" role="status">Читаем чек-лист…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {row === null ? <p className="quiet">Чек-листа на этом объекте нет.</p> : null}
    {row ? <div className="qualification-list">{row.items.map((item) => <article className="qualification-row" key={item.id}><div><b>{item.label}</b><span className="quiet catalog-meta"><span>версия {row.version}</span></span></div><span className="quiet">{item.critical ? "критичный" : "предупреждение"}</span></article>)}</div> : null}
    <Flash message={saved} pulse={pulse} />
    {editing && canWrite ? <FrontTemplateDialog session={session} projectId={projectId} row={row ?? null} onClose={() => setEditing(false)} onSaved={(next) => { setEditing(false); setRow(next); setSaved(`Сервер записал чек-лист «${next.title}», версия ${next.version}.`); setPulse((value) => value + 1); }} /> : null}
  </section>;
}

function FrontTemplateDialog({ session, projectId, row, onClose, onSaved }: { session: Session; projectId: string; row: FrontTemplate | null; onClose: () => void; onSaved: (row: FrontTemplate) => void }) {
  const [source, setSource] = useState(row);
  const [draft, setDraft] = useState<FrontDraft>(() => frontDraft(row));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(true);
  const lock = useRef(false);
  const request = useRef({ id: "", key: "" });
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pendingKey = `helios.front-template:${session.tenantId}:${session.userId}:${projectId}`;
  const problem = frontTemplateValidation(draft);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit() {
    if (lock.current || problem) return;
    const key = JSON.stringify(frontTemplateBody(draft, source, ""));
    if (!request.current.id) {
      try { const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous; } catch { /* The open form can still repeat the same attempt. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await v1<FrontTemplate>(session, `/projects/${projectId}/front-template`, frontTemplateBody(draft, source, request.current.id), source ? "PUT" : "POST");
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      onSaved(next);
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readCurrent() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const current = await v1<FrontTemplate>(session, `/projects/${projectId}/front-template`);
      setSource(current); setDraft(frontDraft(current)); setError(""); request.current = { id: "", key: "" };
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) { setSource(null); setDraft(frontDraft(null)); setError(""); request.current = { id: "", key: "" }; }
      else setError(describe(reason));
    } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title={source ? "Чек-лист фронта" : "Новый чек-лист"} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      <fieldset className="employee-fields" disabled={busy}>
        <p className="quiet">{source ? `Сейчас версия ${source.version}. Сохранение создаст следующую.` : "Первая версия чек-листа."}</p>
        {source ? null : <label className="field"><span>Код</span><input required maxLength={80} value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>}
        <label className="field"><span>Название</span><input required maxLength={200} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        {draft.items.map((item, index) => <div className="template-point" key={item.id}>
          <label className="field"><span>Пункт {index + 1}</span><input required maxLength={500} value={item.label} onChange={(event) => setDraft({ ...draft, items: draft.items.map((row) => row.id === item.id ? { ...row, label: event.target.value } : row) })} /></label>
          <label className="check-line"><input type="checkbox" checked={item.critical} onChange={(event) => setDraft({ ...draft, items: draft.items.map((row) => row.id === item.id ? { ...row, critical: event.target.checked } : row) })} />Критичный: ответ «нет» блокирует</label>
        </div>)}
        <button className="ghost desk-action" type="button" disabled={draft.items.length >= 100} onClick={() => setDraft({ ...draft, items: [...draft.items, { id: crypto.randomUUID(), label: "", critical: false }] })}>Добавить пункт</button>
      </fieldset>
      {problem ? <p className="quiet">{problem}</p> : null}
      {error ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void readCurrent()}>Прочитать актуальную версию</button> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : "Сохранить чек-лист"}</button>
    </form>
  </Dialog>;
}
