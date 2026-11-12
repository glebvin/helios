import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { ApiError, v1 } from "./v1";
import { staffRequest } from "./staff-form";
import { DeskBadge } from "./kit";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { templateBody, templateDraft, templateError, templateValidation, type AdmissionTemplate, type TemplateDraft } from "./admission-template";

const describe = (reason: unknown) => templateError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");
async function readTemplate(session: Session, projectId: string) {
  // Only a confirmed project read makes template404 an empty configuration, rather than denied scope.
  const project = await v1<{ name: string }>(session, `/projects/${projectId}`);
  try { return { projectName: project.name, template: await v1<AdmissionTemplate>(session, `/projects/${projectId}/admission-template`) }; }
  catch (reason) { if (reason instanceof ApiError && reason.status === 404) return { projectName: project.name, template: null }; throw reason; }
}
export function AdmissionTemplatePanel({ session, projectId }: { session: Session; projectId: string }) {
  const [row, setRow] = useState<AdmissionTemplate | null | undefined>(undefined);
  const [projectName, setProjectName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pass, setPass] = useState(0);
  const [editing, setEditing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState(""), [savedPulse, setSavedPulse] = useState(0);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setPass(value => value + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let live = true; setLoading(true);
    void readTemplate(session, projectId).then(next => {
      if (live) { setRow(next.template); setProjectName(next.projectName); setError(""); setBlocked(false); }
    }).catch(reason => {
      if (!live) return;
      setError(describe(reason));
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setRow(undefined); setProjectName(""); setBlocked(true); setEditing(false); }
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, pass]);
  return <section className={loading && row === undefined ? "panel admission-template is-reading" : "panel admission-template"} aria-label="Шаблон допуска">
    <div className="documents-heading">
      <div className="documents-title">
        <h2>Шаблон допуска</h2>
        <NoteMark label="Как устроен шаблон допуска">
          {projectName ? <p>Объект: {projectName}.</p> : null}
          <p>Пункт отвечает «да» или «нет». Критичный ответ «нет» блокирует проверку, некритичный остаётся предупреждением.</p>
          <p>Новая версия потребует заново проверить допуск сотрудников по её требованиям.</p>
          {row ? <p>Требуемые квалификации: {row.requiredQualificationCodes.length ? row.requiredQualificationCodes.join(", ") : "не заданы"}.</p> : null}
          {session.role === "master" ? <p>Прораб читает шаблон. Изменения сохраняет руководитель проекта.</p> : null}
        </NoteMark>
      </div>
      <div className="access-actions">
        {row ? <DeskBadge>{`Версия ${row.version}`}</DeskBadge> : null}
        {session.role === "director" && !blocked && row !== undefined && !editing && !error ? <button className="ghost desk-action" type="button" disabled={loading} onClick={() => { setEditing(true); setSaved(""); }}>{row ? "Изменить шаблон" : "Создать шаблон"}</button> : null}
      </div>
    </div>
    {!projectId ? <p className="quiet">Выберите объект в шапке, чтобы открыть его шаблон допуска.</p> : <>
      {loading && row === undefined ? <p className="quiet" role="status">Читаем шаблон…</p> : null}
      {error ? <p role="alert">{error} {row ? "Показана последняя прочитанная версия." : ""} <button className="ghost desk-action" type="button" onClick={() => setPass(value => value + 1)}>Повторить чтение</button></p> : null}
      {!editing && row ? <div className="qualification-list">
        <article className="qualification-row"><div><b>{row.title}</b><span className="quiet">Код {row.code}</span></div></article>
        {row.items.map(item => <article className="qualification-row" key={item.id}><div><b>{item.label}</b><span className="quiet">Да / нет</span></div><DeskBadge tone={item.critical ? "warn" : "neutral"}>{item.critical ? "Критичный" : "Некритичный"}</DeskBadge></article>)}
      </div> : null}
      {!loading && !error && row === null && !editing ? <p className="quiet">На этом объекте шаблон допуска ещё не создан.</p> : null}
      <Flash message={saved} pulse={savedPulse} />
      {session.role === "director" && !blocked && row !== undefined && editing ? <TemplateForm session={session} projectId={projectId} initial={row} onCancel={() => setEditing(false)} onSaved={next => { setRow(next); setEditing(false); setSaved(`Сервер записал версию ${next.version}.`); setSavedPulse(value => value + 1); setPass(value => value + 1); }} /> : null}
    </>}
  </section>;
}
function TemplateForm({ session, projectId, initial, onCancel, onSaved }: { session: Session; projectId: string; initial: AdmissionTemplate | null; onCancel: () => void; onSaved: (row: AdmissionTemplate) => void }) {
  const [source, setSource] = useState(initial);
  const [draft, setDraft] = useState(() => templateDraft(initial));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef({ id: "", key: "" });
  const pendingKey = `helios.template:${session.tenantId}:${session.userId}:${projectId}`;
  const [stored, setStored] = useState(true);
  const change = (patch: Partial<TemplateDraft>) => setDraft(value => ({ ...value, ...patch }));
  const unchanged = source && JSON.stringify(templateBody(draft, source, "")) === JSON.stringify(templateBody(templateDraft(source), source, ""));
  async function submit() {
    if (lock.current || unchanged) return;
    const invalid = templateValidation(draft); if (invalid) { setError(invalid); return; }
    const key = JSON.stringify(templateBody(draft, source, ""));
    if (!request.current.id) {
      try { const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous; } catch { /* In-memory retry remains available. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const next = await v1<AdmissionTemplate>(session, `/projects/${projectId}/admission-template`, templateBody(draft, source, request.current.id), source ? "PUT" : "POST");
      try { sessionStorage.removeItem(pendingKey); } catch { /* Confirmed server response remains authoritative. */ }
      onSaved(next);
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { const current = (await readTemplate(session, projectId)).template; setSource(current); setDraft(templateDraft(current)); setError(""); request.current = { id: "", key: "" }; }
    catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form aria-label="Редактор шаблона допуска" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className="employee-fields" disabled={busy}>
      <p className="quiet">{source ? `Версия ${source.version} → новая версия ${source.version + 1}.` : "Новый шаблон, версия 1."} Новая версия потребует заново проверить допуск сотрудников по её требованиям.</p>
      <label className="field"><span>Код шаблона</span><input required maxLength={80} value={draft.code} disabled={!!source} onChange={event => change({ code: event.target.value })} /></label>
      <label className="field"><span>Название шаблона</span><input required maxLength={200} value={draft.title} onChange={event => change({ title: event.target.value })} /></label>
      <div className="template-items">{draft.items.map((item, index) => <div className="template-point" key={item.id}>
        <label className="field"><span>Пункт {index + 1}</span><input required maxLength={500} value={item.label} onChange={event => change({ items: draft.items.map(row => row.id === item.id ? { ...row, label: event.target.value } : row) })} /></label>
        <div className="template-bar"><label className="template-check"><input type="checkbox" aria-label={`Критичный пункт ${index + 1}`} checked={item.critical} onChange={event => change({ items: draft.items.map(row => row.id === item.id ? { ...row, critical: event.target.checked } : row) })} />Критичный: ответ «нет» блокирует допуск</label><button className="ghost desk-action" type="button" aria-label={`Удалить пункт ${index + 1}`} disabled={draft.items.length === 1} onClick={() => change({ items: draft.items.filter(row => row.id !== item.id) })}>Удалить</button></div>
      </div>)}</div>
      <button className="ghost desk-action" type="button" disabled={draft.items.length >= 100} onClick={() => change({ items: [...draft.items, { id: crypto.randomUUID(), label: "", critical: false }] })}>Добавить пункт</button>
      <label className="field"><span>Требуемые коды квалификаций</span><textarea aria-label="Требуемые коды квалификаций" rows={3} value={draft.codes} onChange={event => change({ codes: event.target.value })} /></label>
      <p className="quiet">Один код на строку, как в квалификациях сотрудника. Пустой список означает отсутствие требований к квалификациям. Некритичный ответ «нет» будет предупреждением.</p>
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
    {error ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void reload()}>Прочитать шаблон</button> : null}
    {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
    <div className="template-bar"><button className="ghost desk-action" type="button" disabled={busy} onClick={onCancel}>Отмена</button><button className="fill desk-action" type="submit" disabled={busy || !!unchanged}>{busy ? "Записываем…" : "Сохранить шаблон"}</button></div>
  </form>;
}
