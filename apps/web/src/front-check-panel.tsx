import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { DeskSelect } from "./kit";
import { ApiError, v1 } from "./v1";
import {
  blankFrontAnswers, canWriteFrontCheck, frontAnswersComplete, frontCommand, frontError, frontReason, frontTemplateCurrent,
  type FrontAnswers, type FrontCheck, type FrontCommand, type FrontReadiness, type FrontTemplate,
} from "./front-check";

const describe = (reason: unknown) => frontError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");

export function FrontCheckPanel({ session, projectId, taskId, taskVersion, status, onRecorded }: {
  session: Session;
  projectId: string;
  taskId: string;
  taskVersion: number;
  status: string;
  onRecorded: () => void;
}) {
  const [template, setTemplate] = useState<FrontTemplate | null | undefined>(undefined);
  const [readiness, setReadiness] = useState<FrontReadiness | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [pass, setPass] = useState(0);
  const canWrite = canWriteFrontCheck(session.role) && (status === "draft" || status === "pending_approval");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [list, ready] = await Promise.all([
          v1<FrontTemplate>(session, `/projects/${projectId}/front-template`).catch((reason: unknown) => {
            if (reason instanceof ApiError && reason.status === 404) return null;
            throw reason;
          }),
          v1<FrontReadiness>(session, `/projects/${projectId}/tasks/${taskId}/readiness`),
        ]);
        if (!live) return;
        setTemplate(list); setReadiness(ready); setError("");
      } catch (reason) {
        if (!live) return;
        setTemplate(undefined); setReadiness(null); setError(describe(reason));
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, taskId, taskVersion, pass]);
  const items = template?.items ?? [];
  return <section className="panel" aria-label="Готовность фронта">
    <div className="documents-heading">
      <h2>Готовность фронта</h2>
      {canWrite && template ? <button className="ghost desk-action" type="button" onClick={() => setOpen(true)}>Проверить фронт</button> : null}
    </div>
    {template === undefined && !error ? <p className="quiet" role="status">Читаем готовность…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {template === null ? <p className="quiet">Чек-листа на объекте нет. Руководитель задаёт его в настройках.</p> : null}
    {readiness ? <>
      <p className="quiet">{readiness.ready ? "Сервер подтвердил готовность." : "Сервер не подтвердил готовность."}</p>
      {readiness.reasons.length ? <ul className="check-reasons">{readiness.reasons.map((reason) => <li key={reason}>{frontReason(reason, items)}</li>)}</ul> : null}
      {readiness.warnings.length ? <ul className="check-reasons">{readiness.warnings.map((reason) => <li key={reason}>{frontReason(reason, items)}</li>)}</ul> : null}
    </> : null}
    <Flash message={saved} pulse={pulse} />
    {open && template ? <FrontAnswerDialog session={session} projectId={projectId} taskId={taskId} taskVersion={taskVersion} template={template} onRead={() => { setOpen(false); onRecorded(); }} onClose={() => setOpen(false)} onSaved={(row) => {
      setOpen(false);
      setSaved(row.passed ? `Сервер записал проверку №${row.sequence}.` : `Сервер записал проверку №${row.sequence}. Критичный пункт не пройден.`);
      setPulse((value) => value + 1);
      onRecorded();
    }} /> : null}
  </section>;
}

function FrontAnswerDialog({ session, projectId, taskId, taskVersion, template, onRead, onClose, onSaved }: {
  session: Session;
  projectId: string;
  taskId: string;
  taskVersion: number;
  template: FrontTemplate;
  onRead: () => void;
  onClose: () => void;
  onSaved: (row: FrontCheck) => void;
}) {
  const [source, setSource] = useState(template);
  const [answers, setAnswers] = useState<FrontAnswers>(() => blankFrontAnswers(template));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stored, setStored] = useState(true);
  const [stale, setStale] = useState(false);
  const lock = useRef(false);
  const request = useRef<FrontCommand | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pendingKey = `helios.front-check:${session.tenantId}:${session.userId}:${taskId}:${source.version}`;
  const complete = frontAnswersComplete(source, answers);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function readTemplate() {
    const latest = await v1<FrontTemplate>(session, `/projects/${projectId}/front-template`);
    if (!frontTemplateCurrent(source, latest)) {
      setSource(latest); setAnswers(blankFrontAnswers(latest)); request.current = null;
      setError("Шаблон изменён. Прочитайте пункты версии " + latest.version + " и ответьте заново.");
      return null;
    }
    return latest;
  }
  async function submit() {
    if (lock.current || !complete) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const latest = await readTemplate();
      if (!latest) return;
      if (!request.current) {
        try { request.current = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null"); } catch { /* The open form can still repeat the same attempt. */ }
      }
      request.current = frontCommand(request.current, taskVersion, latest, answers, () => crypto.randomUUID());
      try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
      const row = await v1<FrontCheck>(session, `/projects/${projectId}/tasks/${taskId}/front-checks`, request.current.body);
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      onSaved(row);
    } catch (reason) { setError(describe(reason)); setStale(reason instanceof ApiError && reason.status === 409 && reason.message === "stale_version"); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title="Проверка фронта" onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      <p className="quiet">{source.title}, версия {source.version}. Ответ «нет» на критичном пункте блокирует готовность.</p>
      <fieldset className="employee-fields" disabled={busy}>
        {source.items.map((item, index) => <div className="check-point" key={item.id}>
          <p>{item.label}</p>
          <p className="quiet">{item.critical ? "Критичный пункт." : "Некритичный пункт останется предупреждением."}</p>
          <DeskSelect label={`Ответ на пункт ${index + 1}`} value={answers[item.id] === null || answers[item.id] === undefined ? "" : answers[item.id] ? "yes" : "no"} options={[{ value: "", label: "Выберите ответ" }, { value: "yes", label: "Да" }, { value: "no", label: "Нет" }]} onChange={(value) => setAnswers((current) => ({ ...current, [item.id]: value === "" ? null : value === "yes" }))} />
        </div>)}
      </fieldset>
      {error ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void readTemplate().catch((reason: unknown) => setError(describe(reason)))}>Прочитать актуальную версию</button> : null}
      {stale ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => { try { sessionStorage.removeItem(pendingKey); } catch { /* The next dialog starts from current server state. */ } onRead(); }}>Прочитать актуальное задание</button> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !complete}>{busy ? "Записываем…" : "Записать проверку"}</button>
    </form>
  </Dialog>;
}
