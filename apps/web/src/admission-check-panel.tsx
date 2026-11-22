import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { ApiError, v1 } from "./v1";
import { Dialog } from "./dialog";
import { DeskBadge, DeskSelect } from "./kit";
import { staffRequest } from "./staff-form";
import type { AdmissionTemplate } from "./admission-template";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { answersComplete, approvalError, approvalLine, blankAnswers, checkBody, checkError, checkReason, reviewError, reviewLine, type AdmissionCheck, type CheckAnswers, type CheckPage, type SafetyReview } from "./admission-check";

const describe = (reason: unknown) => checkError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");
async function currentTemplate(session: Session, projectId: string) {
  const project = await v1<{ name: string }>(session, `/projects/${projectId}`);
  try { return { projectName: project.name, template: await v1<AdmissionTemplate>(session, `/projects/${projectId}/admission-template`) }; }
  catch (reason) { if (reason instanceof ApiError && reason.status === 404) return { projectName: project.name, template: null }; throw reason; }
}
export function AdmissionChecksPanel({ session, employeeId, projectId, archived }: { session: Session; employeeId: string; projectId: string; archived: boolean }) {
  const [template, setTemplate] = useState<AdmissionTemplate | null>(null);
  const [projectName, setProjectName] = useState("");
  const [page, setPage] = useState<CheckPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [editing, setEditing] = useState<AdmissionTemplate | null>(null);
  const [written, setWritten] = useState<AdmissionCheck | null>(null);
  const [agreed, setAgreed] = useState("");
  const path = `/employees/${employeeId}/admission-checks`;
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setPass(value => value + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (!projectId) { setLoading(false); return; }
    let live = true; setLoading(true);
    void (async () => {
      try {
        const context = await currentTemplate(session, projectId);
        const rows = await v1<CheckPage>(session, `${path}?projectId=${projectId}&limit=10&offset=${offset}`);
        if (!live) return;
        setTemplate(context.template); setProjectName(context.projectName); setPage(rows); setError(""); setBlocked(false);
        if (offset && offset >= rows.total) setOffset(Math.max(0, Math.floor((rows.total - 1) / 10) * 10));
      } catch (reason) {
        if (!live) return;
        setError(describe(reason)); setPage(null); setTemplate(null);
        if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setBlocked(true); setEditing(null); setWritten(null); setProjectName(""); }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, path, offset, pass]);
  return <section className="panel admission-checks" aria-label="Проверки допуска">
    <div className="documents-heading">
      <div className="documents-title"><h2>Проверки допуска</h2><NoteMark label="Как устроена проверка допуска"><p>Успешная попытка — результат на момент записи. Текущий допуск и назначение проверяются отдельно.</p>{projectName ? <p>Объект: {projectName}.</p> : null}{template ? <p>Текущий шаблон: {template.title}, версия {template.version}.</p> : null}{archived ? <p>Для архивного сотрудника доступна история; новые проверки не записываются.</p> : null}{session.role === "master" ? <p>Прораб читает результаты. Попытку записывает руководитель проекта.</p> : null}</NoteMark></div>
      {session.role === "director" && !archived && !blocked && !editing && template && !error ? <button className="ghost desk-action" type="button" disabled={loading} onClick={() => { setEditing(template); setWritten(null); }}>Новая проверка</button> : null}
    </div>
    {!projectId ? <p className="quiet">Выберите объект в шапке для проверки допуска сотрудника.</p> : <>
      {loading && !page ? <p className="quiet" role="status">Читаем проверки допуска…</p> : null}
      {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass(value => value + 1)}>Повторить чтение</button></p> : null}
      {!error && !template && (page || !loading) ? <p className="quiet">Шаблон допуска не создан. Руководитель задаёт его в «Настройках» этого объекта.</p> : null}
      {session.role === "director" && !archived && !blocked && editing ? <Dialog title="Новая проверка" onClose={() => setEditing(null)}><CheckForm session={session} path={path} projectId={projectId} initial={editing} latest={template} onCancel={() => setEditing(null)} onSaved={row => { setWritten(row); setEditing(null); setOffset(0); setPass(value => value + 1); }} /></Dialog> : null}
      <Flash message={agreed || (written ? `Сервер записал попытку №${written.sequence}: ${written.passed ? "проверка пройдена" : "проверка не пройдена"}.` : "")} />
      {written && !page?.items.some(item => item.id === written.id) ? <CheckResult session={session} path={path} row={written} template={template} onAgreed={setAgreed} /> : null}
      {!error && page?.total === 0 ? <p className="quiet">Попыток проверки на этом объекте пока нет.</p> : null}
      <div className="check-history">{page?.items.map(row => <CheckResult key={row.id} session={session} path={path} row={row} template={template} onAgreed={setAgreed} />)}</div>
      {page && page.total > 10 ? <div className="template-bar"><button className="ghost desk-action" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 10))}>Предыдущие</button><span className="quiet">{offset + 1}–{offset + page.items.length} из {page.total}</span><button className="ghost desk-action" disabled={loading || offset + page.items.length >= page.total} onClick={() => setOffset(offset + 10)}>Более ранние</button></div> : null}
    </>}
  </section>;
}
function CheckResult({ session, path, row, template, onAgreed }: { session: Session; path: string; row: AdmissionCheck; template: AdmissionTemplate | null; onAgreed: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<SafetyReview | null>(null);
  const [approval, setApproval] = useState<SafetyReview | null>(null);
  const [reviewPass, setReviewPass] = useState(0);
  const [approvalPass, setApprovalPass] = useState(0);
  const reduce = useReducedMotion();
  const stale = !!template && (row.templateVersion !== template.version || row.templateCode !== template.code);
  const line = reviewLine(review, session.role);
  const decision = approvalLine(approval, session.role);
  const safetyClear = !review?.required || review.recorded;
  useEffect(() => {
    if (!row.passed) return;
    let live = true;
    void v1<SafetyReview>(session, `${path}/${row.id}/safety-review`).then(next => { if (live) setReview(next); }).catch(() => { if (live) setReview(null); });
    void v1<SafetyReview>(session, `${path}/${row.id}/approval`).then(next => { if (live) setApproval(next); }).catch(() => { if (live) setApproval(null); });
    return () => { live = false; };
  }, [session, path, row.id, row.passed, reviewPass, approvalPass]);
  return <article className={open ? "check-result is-open" : "check-result"}>
    <div className="check-summary">
      <button type="button" className="check-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="check-identity"><b>Попытка №{row.sequence}</b><time dateTime={row.checkedAt}>{new Date(row.checkedAt).toLocaleString("ru-RU")}</time></span>
        <span className="check-state">{stale ? <span className="check-stale">Прежний шаблон</span> : null}<DeskBadge tone={!row.passed || stale ? "warn" : "done"}>{row.passed ? "Пройдена" : "Не пройдена"}</DeskBadge><motion.span className="check-chevron" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.28 }}>⌄</motion.span></span>
      </button>
      {line ? <p className="quiet" role="status">{line}</p> : null}
      {decision ? <p className="quiet" role="status">{decision}</p> : null}
      {session.role === "safety" && review?.required && !review.recorded ? <SafetyAgree session={session} path={`${path}/${row.id}/safety-review`} onAgreed={message => { onAgreed(message); setReviewPass(value => value + 1); }} /> : null}
      {session.role === "director" && safetyClear && approval?.required && !approval.recorded ? <ApprovalAgree session={session} path={`${path}/${row.id}/approval`} onAgreed={message => { onAgreed(message); setApprovalPass(value => value + 1); }} /> : null}
      <NoteMark label={`Сведения попытки №${row.sequence}`}><p>{row.templateSnapshot.title} · шаблон версии {row.templateVersion} · дата проверки {row.civilDate}.</p><p>Требуемые квалификации: {row.templateSnapshot.requiredQualificationCodes.join(", ") || "не требовались"}.</p>{row.qualificationEvidence.length ? <p>{row.qualificationEvidence.map(item => `${item.code} · версия ${item.version} · ${item.validUntil ? `по ${item.validUntil.split("-").reverse().join(".")}` : "без срока"}`).join("; ")}</p> : null}{!template ? <p>Актуальность шаблона не подтверждена.</p> : null}</NoteMark>
    </div>
    <motion.div className="check-fold" initial={false} animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.24 }} inert={open ? undefined : true}>
      <div className="check-detail">
        {stale ? <p className="check-stale">Шаблон изменён. Эта попытка относится к прежней версии; нужна новая проверка.</p> : null}
        {row.reasons.length ? <ul className="check-reasons">{row.reasons.map(reason => <li key={reason}>{checkReason(reason, row.templateSnapshot)}</li>)}</ul> : null}
        {row.warnings.length ? <ul className="check-reasons quiet">{row.warnings.map(reason => <li key={reason}>{checkReason(reason, row.templateSnapshot)}</li>)}</ul> : null}
        <ul className="check-answers">{row.templateSnapshot.items.map(item => <li key={item.id}><span>{item.label}{item.critical ? <small className="quiet">Критичный пункт</small> : null}</span><b>{row.answers.find(answer => answer.itemId === item.id)?.value ? "Да" : "Нет"}</b></li>)}</ul>
      </div>
    </motion.div>
  </article>;
}
function SafetyAgree({ session, path, onAgreed }: { session: Session; path: string; onAgreed: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const pendingKey = `helios.admission-safety:${session.tenantId}:${session.userId}:${path}`;
  async function agree() {
    if (lock.current) return;
    let requestId = "";
    try { const previous = sessionStorage.getItem(pendingKey); if (previous) requestId = previous; } catch { /* The same click can still finish. */ }
    if (!requestId) requestId = crypto.randomUUID();
    try { sessionStorage.setItem(pendingKey, requestId); } catch { /* A lost answer can be repeated from this button. */ }
    lock.current = true; setBusy(true); setError("");
    try {
      await v1(session, path, { requestId });
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server result is the confirmation. */ }
      onAgreed("Сервер записал согласование охраны труда.");
    } catch (reason) { setError(reviewError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="template-bar">{error ? <p role="alert">{error}</p> : null}<button className="desk-action" type="button" disabled={busy} onClick={() => void agree()}>{busy ? "Записываем…" : "Согласовать допуск"}</button></div>;
}
function ApprovalAgree({ session, path, onAgreed }: { session: Session; path: string; onAgreed: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const pendingKey = `helios.admission-approval:${session.tenantId}:${session.userId}:${path}`;
  async function approve() {
    if (lock.current) return;
    let requestId = "";
    try { const previous = sessionStorage.getItem(pendingKey); if (previous) requestId = previous; } catch { /* The same click can still finish. */ }
    if (!requestId) requestId = crypto.randomUUID();
    try { sessionStorage.setItem(pendingKey, requestId); } catch { /* A lost answer can be repeated from this button. */ }
    lock.current = true; setBusy(true); setError("");
    try {
      await v1(session, path, { requestId });
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server result is the confirmation. */ }
      onAgreed("Сервер записал утверждение допуска.");
    } catch (reason) { setError(approvalError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="template-bar">{error ? <p role="alert">{error}</p> : null}<button className="desk-action" type="button" disabled={busy} onClick={() => void approve()}>{busy ? "Записываем…" : "Утвердить допуск"}</button></div>;
}
function CheckForm({ session, path, projectId, initial, latest, onCancel, onSaved }: { session: Session; path: string; projectId: string; initial: AdmissionTemplate; latest: AdmissionTemplate | null; onCancel: () => void; onSaved: (row: AdmissionCheck) => void }) {
  const [source, setSource] = useState(initial);
  const [answers, setAnswers] = useState<CheckAnswers>(() => blankAnswers(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stored, setStored] = useState(true);
  const lock = useRef(false), request = useRef({ id: "", key: "" });
  const pendingKey = `helios.admission-check:${session.tenantId}:${session.userId}:${projectId}:${path}`;
  const changed = !!latest && (source.version !== latest.version || source.code !== latest.code);
  async function submit() {
    if (lock.current || changed || !answersComplete(source, answers)) return;
    const key = JSON.stringify(checkBody(projectId, source, answers, ""));
    if (!request.current.id) {
      try { const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous; } catch { /* This form can still retry in memory. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const row = await v1<AdmissionCheck>(session, path, checkBody(projectId, source, answers, request.current.id));
      try { sessionStorage.removeItem(pendingKey); } catch { /* Server confirmation is authoritative. */ }
      onSaved(row);
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const context = await currentTemplate(session, projectId);
      if (!context.template) throw new ApiError(404, "not_found");
      setSource(context.template); setAnswers(blankAnswers(context.template)); request.current = { id: "", key: "" }; setError("");
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form aria-label="Новая проверка допуска" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <fieldset className="employee-fields" disabled={busy}>
      <p className="quiet">{source.title} · версия {source.version}. Ответьте на каждый пункт. Заполнение формы ещё не означает пройденную проверку.</p>
      {source.items.map((item, index) => <div className="check-point" key={item.id}><p>{item.label}</p><p className="quiet">{item.critical ? "Критичный пункт: ответ «нет» блокирует проверку." : "Ответ «нет» будет предупреждением."}</p><DeskSelect label={`Ответ на пункт ${index + 1}`} value={answers[item.id] === null ? "" : answers[item.id] ? "yes" : "no"} options={[{ value: "", label: "Выберите ответ" }, { value: "yes", label: "Да" }, { value: "no", label: "Нет" }]} onChange={value => setAnswers(current => ({ ...current, [item.id]: value === "" ? null : value === "yes" }))} /></div>)}
      <p className="quiet">Требуемые квалификации: {source.requiredQualificationCodes.join(", ") || "не заданы"}. Их состояние проверит сервер.</p>
    </fieldset>
    {changed ? <p role="alert">Шаблон изменён. Прочитайте текущую версию; ответы нужно заполнить заново.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {changed || error ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void reload()}>Прочитать шаблон</button> : null}
    {!stored && error ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
    <div className="template-bar"><button className="ghost desk-action" type="button" disabled={busy} onClick={onCancel}>Отменить</button><button className="fill desk-action" type="submit" disabled={busy || changed || !answersComplete(source, answers)}>{busy ? "Записываем…" : "Записать проверку"}</button></div>
  </form>;
}
