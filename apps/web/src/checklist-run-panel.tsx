import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { checklistPage, checklistPageCount, type ChecklistAnswer, type ChecklistItem, type ChecklistRefusal } from "@helios/domain";
import type { Session } from "./api";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { canFillChecklist, canReadChecklist, checklistPendingKey, fileKind, samePending, type ChecklistPending } from "./checklist-run";

type Edition = { templateId: string; edition: number; title: string; version: number; items: ChecklistItem[] };
type FileRow = { fileId: string; itemId: string; filename: string; contentType: string; sizeBytes: number; sha256: string };
type Run = {
  id: string; templateId: string; edition: number; templateVersion: number; items: ChecklistItem[]; answers: ChecklistAnswer[];
  verdict: { ok: boolean; refused: boolean; refusals: ChecklistRefusal[] }; passed: boolean; blocksNext: boolean;
  actorName: string; version: number; createdAt: string; files: FileRow[];
};
type Listed = { latest: Run | null; history: Run[]; approved: Edition[] };

const reasonText: Record<string, string> = {
  critical_empty: "Критичный пункт не заполнен.",
  critical_invalid: "Критичный пункт не проходит проверку.",
  required_empty: "Обязательный пункт не заполнен.",
  type_mismatch: "Ответ не соответствует типу пункта.",
  out_of_bounds: "Число вне допустимых границ.",
  failed_condition: "Ответ не совпадает с заданным условием.",
  photo_limit: "В прохождении больше 20 фото.",
  invalid_template: "Шаблон этой версии составлен неверно.",
  batch_unavailable: "Проверка партии ещё не подключена. Идентификатор не считается успехом.",
};

function encode(bytes: ArrayBuffer) {
  let text = "";
  for (const byte of new Uint8Array(bytes)) text += String.fromCharCode(byte);
  return btoa(text);
}

export function ChecklistRunPanel({ session, projectId, taskId }: { session: Session; projectId: string; taskId: string }) {
  const reduce = useReducedMotion();
  const [approved, setApproved] = useState<Edition[]>([]);
  const [chosen, setChosen] = useState("");
  const [runs, setRuns] = useState<Listed | null>(null);
  const [answers, setAnswers] = useState<ChecklistAnswer[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(0);
  const readable = canReadChecklist(session.role);
  const writable = canFillChecklist(session.role);

  useEffect(() => {
    if (!readable) return;
    let live = true;
    void (async () => {
      try {
        const listed = await v1<Listed>(session, `/projects/${projectId}/tasks/${taskId}/checklist-runs`);
        if (!live) return;
        setRuns(listed);
        setApproved(listed.approved);
        setChosen((current) => listed.approved.some((item) => item.templateId === current) ? current : listed.approved[0]?.templateId ?? "");
        setError("");
      } catch (reason) {
        if (live) setError(reason instanceof ApiError ? "Прохождение прочитать не удалось." : "Нет ответа сервера.");
      }
    })();
    return () => { live = false; };
  }, [session, projectId, taskId, pass, readable]);

  if (!readable) return null;
  const detail = approved.find((item) => item.templateId === chosen) ?? null;
  const items = detail?.items ?? [];
  const visible = checklistPage(items, page);
  const pages = checklistPageCount(items.length);
  const latest = runs?.latest;

  function change(itemId: string, value: string) {
    setAnswers((current) => {
      const next = current.filter((answer) => answer.itemId !== itemId);
      if (value) next.push({ itemId, value });
      return next;
    });
    setWaiting(false);
  }

  async function chooseFile(item: ChecklistItem, file: File | null) {
    const kind = fileKind(item);
    if (!file || !kind || !kind.types.includes(file.type) || file.size < 1 || file.size > 65536) {
      setError("Нужен файл JPEG, PNG или PDF не больше 64 КБ.");
      return;
    }
    setBusy(true);
    try {
      const stored = await v1<FileRow>(session, `/projects/${projectId}/tasks/${taskId}/checklist-files`, {
        requestId: crypto.randomUUID(), itemId: item.id, filename: file.name, contentType: file.type, fileBase64: encode(await file.arrayBuffer()),
      });
      change(item.id, stored.fileId);
      setError("");
    } catch (reason) {
      setError(reason instanceof ApiError ? "Сервер не принял файл." : "Файл не отправлен. Это не сохранение.");
    } finally { setBusy(false); }
  }

  async function submit() {
    if (!detail) return;
    setBusy(true);
    const key = checklistPendingKey(session.tenantId, session.userId, taskId);
    const next = { templateId: detail.templateId, edition: detail.edition, expectedVersion: latest?.version ?? 0, answers };
    let pending: ChecklistPending | null = null;
    try { pending = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { pending = null; }
    const requestId = samePending(pending, next) ? pending!.requestId : crypto.randomUUID();
    const body = { requestId, ...next };
    try { sessionStorage.setItem(key, JSON.stringify(body)); } catch { /* Повтор остаётся в этой форме. */ }
    try {
      await v1(session, `/projects/${projectId}/tasks/${taskId}/checklist-runs`, body);
      try { sessionStorage.removeItem(key); } catch { /* Ответ сервера уже есть. */ }
      setWaiting(false);
      setSaved("Сервер сохранил прохождение.");
      setPulse((value) => value + 1);
      setPass((value) => value + 1);
    } catch (reason) {
      if (reason instanceof ApiError) {
        try { sessionStorage.removeItem(key); } catch { /* Команда сервером отклонена. */ }
        setWaiting(false);
        setError(reason.message === "stale_version" ? "Прохождение уже изменилось. Прочитайте его снова." : reason.message === "checklist_blocked" ? "Критичный пункт останавливает следующее действие." : reason.message === "file_denied" ? "Файл не относится к этому пункту." : reason.message === "template_not_approved" ? "Нужна утверждённая редакция." : "Сервер не сохранил прохождение.");
      } else {
        setWaiting(true);
        setError("Ожидает отправки. Сервер ещё не подтвердил.");
      }
    } finally { setBusy(false); }
  }

  return <section className="panel checklist-run" aria-label="Чек-лист задания">
    <div className="panel-head">
      <h2>Чек-лист</h2>
      <NoteMark label="Что сохраняется"><p>Записывается закреплённая редакция. Партия без реестра не считается пройденной. Сохранение не принимает объём.</p></NoteMark>
    </div>
    {saved ? <Flash message={saved} pulse={pulse} /> : null}
    {error ? <p role="alert">{error}</p> : null}
    {waiting ? <p role="status">Ожидает отправки. Это ещё не запись на сервере.</p> : null}
    {approved.length === 0 ? <p className="quiet">Утверждённой редакции для этого объекта нет.</p> : null}
    {approved.length > 1 ? <label className="field">Шаблон
      <select value={chosen} onChange={(event) => { setChosen(event.target.value); setPage(0); setAnswers([]); }}>
        {approved.map((card) => <option key={card.templateId} value={card.templateId}>{card.title}</option>)}
      </select>
    </label> : null}
    {detail ? <p className="quiet">{detail.title}. Редакция {detail.edition}, версия {detail.version}.</p> : null}
    {latest ? <motion.div key={latest.id} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.26, bounce: 0 }}>
      <p role="status">{latest.passed ? "Сервер принял ответы." : "Сервер сохранил отказ."} {latest.actorName}, {new Date(latest.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}. Версия прохождения {latest.version}.</p>
      {latest.blocksNext ? <p className="checklist-warn" role="alert">Критичный пункт не пройден. Следующее действие по заданию остановлено. Объём этим чек-листом не принимается.</p> : null}
      {latest.verdict.refusals.map((refusal) => <p className="checklist-warn" key={`${refusal.itemId}-${refusal.reason}`}>{reasonText[refusal.reason] ?? refusal.reason}</p>)}
      {runs && runs.history.length > 1 ? <p className="quiet">В истории {runs.history.length} прохождения. Первая редакция остаётся в записи {runs.history[0].templateVersion}.</p> : null}
    </motion.div> : null}
    {writable && detail ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {visible.map((item, index) => {
        const value = answers.find((answer) => answer.itemId === item.id)?.value ?? "";
        const kind = fileKind(item);
        return <fieldset className="checklist-item" key={item.id}>
          <legend>{page * 10 + index + 1}. {item.prompt}{item.critical ? " · критичный" : ""}</legend>
          {item.kind === "yes_no" ? <div className="checklist-choice" role="group" aria-label={item.prompt}>
            <button className={value === "yes" ? "is-on" : ""} type="button" onClick={() => change(item.id, "yes")}>Да</button>
            <button className={value === "no" ? "is-on" : ""} type="button" onClick={() => change(item.id, "no")}>Нет</button>
          </div> : null}
          {item.kind === "number" ? <label><span className="quiet">Число, {item.unit}</span><input inputMode="decimal" value={value} onChange={(event) => change(item.id, event.target.value.trim())} /></label> : null}
          {kind ? <label><span className="quiet">{value ? "Файл принят сервером" : "Файл ещё не отправлен"}</span><input type="file" accept={kind.accept} onChange={(event) => void chooseFile(item, event.target.files?.[0] ?? null)} /></label> : null}
          {item.kind === "batch" ? <p className="quiet">Проверка партии ещё не подключена. Произвольный номер здесь не станет успешным результатом.</p> : null}
        </fieldset>;
      })}
      {pages > 1 ? <div className="checklist-step">
        <button className="ghost desk-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
        <button className="ghost desk-action" type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Далее</button>
      </div> : null}
      <button className="fill desk-action" type="submit" disabled={busy}>{busy ? "Записываем…" : "Сохранить на сервере"}</button>
    </form> : null}
  </section>;
}
