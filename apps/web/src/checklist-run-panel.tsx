import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { checklistPage, checklistPageCount, type ChecklistAnswer, type ChecklistItem, type ChecklistRefusal } from "@helios/domain";
import type { Session } from "./api";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { openDelivery, readChecklist, saveChecklist, sendChecklist, watchDelivery, type ChecklistDetail } from "./delivery";
import { canFillChecklist, canReadChecklist, checklistStatus, fileKind } from "./checklist-run";

type Edition = { templateId: string; edition: number; title: string; version: number; items: ChecklistItem[] };
type FileRow = { fileId: string; itemId: string; filename: string; contentType: string; sizeBytes: number; sha256: string };
type Run = {
  id: string; templateId: string; edition: number; templateVersion: number; items: ChecklistItem[]; answers: ChecklistAnswer[];
  verdict: { ok: boolean; refused: boolean; refusals: ChecklistRefusal[] }; passed: boolean; blocksNext: boolean;
  actorName: string; version: number; createdAt: string; files: FileRow[];
};
type Listed = { latest: Run | null; history: Run[]; approved: Edition[] };
type LocalFile = { itemId: string; filename: string; contentType: string; bytes: Uint8Array };

const fileLimit = 8 * 1024 * 1024;
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

function mediaType(file: File) {
  if (file.type === "image/jpg") return "image/jpeg";
  return file.type;
}

export function ChecklistRunPanel({ session, projectId, taskId, title, day }: { session: Session; projectId: string; taskId: string; title: string; day: string }) {
  const reduce = useReducedMotion();
  const [approved, setApproved] = useState<Edition[]>([]);
  const [chosen, setChosen] = useState("");
  const [runs, setRuns] = useState<Listed | null>(null);
  const [answers, setAnswers] = useState<ChecklistAnswer[]>([]);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [local, setLocal] = useState<ChecklistDetail | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(0);
  const active = useRef(true);
  const submitting = useRef(false);
  const filePicks = useRef(new Map<string, number>());
  const filesRef = useRef(files); filesRef.current = files;
  const answersRef = useRef(answers); answersRef.current = answers;
  const chosenRef = useRef(chosen); chosenRef.current = chosen;
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const confirmed = useRef("");
  const readable = canReadChecklist(session.role);
  const writable = canFillChecklist(session.role);
  const status = checklistStatus(local);
  const frozen = local?.phase === "queued" && (local.state === "pending" || local.state === "sending" || local.state === "retry_wait");

  function remember(next: { templateId: string; edition: number; version: number; items: ChecklistItem[]; answers: ChecklistAnswer[]; files: LocalFile[] }, heading = title, workDay = day, expectedVersion = runs?.latest?.version ?? local?.expectedVersion ?? 0) {
    if (!heading || !workDay) return;
    const draft = { projectId, taskId, title: heading, projectName: "Объект", day: workDay, templateId: next.templateId, edition: next.edition, templateVersion: next.version, expectedVersion, items: next.items, answers: next.answers, files: next.files };
    chain.current = chain.current.then(() => active.current ? openDelivery(session).then(() => active.current ? saveChecklist(draft) : null) : null).then((row) => { if (active.current && row) setLocal(row); }).catch((reason: unknown) => {
      if (active.current) setError(reason instanceof Error && reason.message === "local_identity_conflict" ? "Команда уже ждёт отправки." : "Черновик не записан на устройстве.");
    });
  }

  useEffect(() => {
    if (!readable) return;
    let live = true;
    const stop = watchDelivery(() => { void readChecklist(projectId, taskId).then((row) => { if (live && row) setLocal(row); }); });
    return () => { live = false; stop(); };
  }, [readable, projectId, taskId]);

  useEffect(() => {
    if (local?.state === "synced" && local.requestId && confirmed.current !== local.requestId) {
      confirmed.current = local.requestId;
      setSaved("Подтверждено сервером.");
      setPulse((value) => value + 1);
      setPass((value) => value + 1);
    }
  }, [local]);

  useEffect(() => {
    if (!readable) return;
    let live = true;
    void (async () => {
      await openDelivery(session).catch(() => {});
      const stored = await readChecklist(projectId, taskId).catch(() => null);
      if (!live) return;
      if (stored) {
        setLocal(stored);
        setAnswers(stored.answers);
        setFiles(stored.files);
        setChosen(stored.templateId);
        if (stored.items.length) setApproved([{ templateId: stored.templateId, edition: stored.edition, title: stored.title, version: stored.templateVersion, items: stored.items as ChecklistItem[] }]);
      }
      try {
        const listed = await v1<Listed>(session, `/projects/${projectId}/tasks/${taskId}/checklist-runs`);
        if (!live) return;
        setRuns(listed);
        const held = stored?.phase === "queued" && stored.state !== "synced" && stored.state !== "blocked";
        setApproved(held ? [{templateId: stored.templateId, edition: stored.edition, title: stored.title, version: stored.templateVersion, items: stored.items as ChecklistItem[]}] : listed.approved);
        const current = held ? stored.templateId : stored?.templateId && listed.approved.some((item) => item.templateId === stored.templateId) ? stored.templateId : listed.approved[0]?.templateId ?? "";
        setChosen(current);
        setError("");
        const edition = listed.approved.find((item) => item.templateId === current);
        if (writable && edition && title && day && !held) remember({ templateId: edition.templateId, edition: edition.edition, version: edition.version, items: edition.items, answers: stored?.answers ?? [], files: stored?.files ?? [] }, title, day, listed.latest?.version ?? 0);
      } catch (reason) {
        if (live && !stored?.items.length) setError(reason instanceof ApiError ? "Прохождение прочитать не удалось." : "Нет ответа сервера.");
      }
    })();
    return () => { live = false; };
  }, [session, projectId, taskId, pass, readable, title, day]);

  if (!readable) return null;
  const detail = approved.find((item) => item.templateId === chosen) ?? null;
  const items = detail?.items ?? [];
  const visible = checklistPage(items, page);
  const pages = checklistPageCount(items.length);
  const latest = runs?.latest;

  function change(itemId: string, value: string) {
    if (frozen || !detail) return;
    const next = answers.filter((answer) => answer.itemId !== itemId);
    if (value) next.push({ itemId, value });
    answersRef.current = next; setAnswers(next);
    remember({ templateId: detail.templateId, edition: detail.edition, version: detail.version, items, answers: next, files });
  }

  async function chooseFile(item: ChecklistItem, file: File | null) {
    const kind = fileKind(item);
    const type = file ? mediaType(file) : "";
    if (!file || !kind || !kind.types.includes(type) || file.size < 1 || file.size > fileLimit || !detail) {
      setError("Нужен файл JPEG, PNG или PDF не больше 8 МБ.");
      return;
    }
    const pick = (filePicks.current.get(item.id) ?? 0) + 1; filePicks.current.set(item.id, pick);
    const selectedTemplate = chosen;
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await file.arrayBuffer()); }
    catch { if (active.current) setError("Файл не прочитан. Выберите его ещё раз."); return; }
    if (!active.current || chosenRef.current !== selectedTemplate || filePicks.current.get(item.id) !== pick || submitting.current) return;
    const next = [...filesRef.current.filter((row) => row.itemId !== item.id), { itemId: item.id, filename: file.name, contentType: type, bytes }];
    filesRef.current = next; setFiles(next);
    setError("");
    remember({ templateId: detail.templateId, edition: detail.edition, version: detail.version, items, answers: answersRef.current, files: next });
  }

  async function submit() {
    if (!detail || frozen || submitting.current) return;
    submitting.current = true; setBusy(true);
    setError("");
    try {
      await chain.current;
      if (!active.current) return;
      await openDelivery(session);
      if (!active.current) return;
      const stored = await saveChecklist({ projectId, taskId, title: title || local?.title || "Задание", projectName: "Объект", day: day || local?.day || "", templateId: detail.templateId, edition: detail.edition, templateVersion: detail.version, expectedVersion: runs?.latest?.version ?? local?.expectedVersion ?? 0, items, answers, files });
      setLocal(stored);
      const sent = await sendChecklist(projectId, taskId);
      setLocal(sent);
    } catch (reason) {
      setError(reason instanceof Error && reason.message === "local_identity_conflict" ? "Команда уже ждёт отправки." : "Отправка не началась.");
    } finally { submitting.current = false; if (active.current) setBusy(false); }
  }

  return <section className="panel checklist-run" aria-label="Чек-лист задания">
    <div className="panel-head">
      <h2>Чек-лист</h2>
      <NoteMark label="Что сохраняется"><p>Ответы и фотография остаются на устройстве, пока сервер не подтвердит ту же команду. Партия без реестра не считается пройденной. Сохранение не принимает объём.</p></NoteMark>
    </div>
    {saved ? <Flash message={saved} pulse={pulse} /> : null}
    {error ? <p role="alert">{error}</p> : null}
    {status ? <p role={status === "Ошибка" || status === "Конфликт" ? "alert" : "status"}>{status}{status === "Ожидает отправки" ? ". Это ещё не запись на сервере." : ""}</p> : null}
    {approved.length === 0 ? <p className="quiet">Утверждённой редакции для этого объекта нет.</p> : null}
    {approved.length > 1 ? <label className="field">Шаблон
      <select value={chosen} disabled={frozen || busy} onChange={(event) => {
        const edition = approved.find(row => row.templateId === event.target.value); if (!edition) return;
        chosenRef.current = edition.templateId; setChosen(edition.templateId); setPage(0); answersRef.current = []; filesRef.current = []; setAnswers([]); setFiles([]);
        remember({templateId: edition.templateId, edition: edition.edition, version: edition.version, items: edition.items, answers: [], files: []});
      }}>
        {approved.map((card) => <option key={card.templateId} value={card.templateId}>{card.title}</option>)}
      </select>
    </label> : null}
    {detail ? <p className="quiet">{detail.title}. Редакция {detail.edition}, версия {detail.version}.</p> : null}
    {latest ? <motion.div key={latest.id} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.26, bounce: 0 }}>
      <p role="status">{latest.passed ? "Сервер принял ответы." : "Сервер сохранил отказ."} {latest.actorName}, {new Date(latest.createdAt).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}. Версия прохождения {latest.version}.</p>
      {latest.files.map((file) => <p key={file.fileId}>{file.filename}</p>)}
      {latest.blocksNext ? <p className="checklist-warn" role="alert">Критичный пункт не пройден. Следующее действие по заданию остановлено. Объём этим чек-листом не принимается.</p> : null}
      {latest.verdict.refusals.map((refusal) => <p className="checklist-warn" key={`${refusal.itemId}-${refusal.reason}`}>{reasonText[refusal.reason] ?? refusal.reason}</p>)}
      {runs && runs.history.length > 1 ? <p className="quiet">В истории {runs.history.length} прохождения. Первая редакция остаётся в записи {runs.history[0].templateVersion}.</p> : null}
    </motion.div> : null}
    {writable && detail ? <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {visible.map((item, index) => {
        const value = answers.find((answer) => answer.itemId === item.id)?.value ?? "";
        const kind = fileKind(item);
        const file = files.find((row) => row.itemId === item.id);
        return <fieldset className="checklist-item" key={item.id} disabled={frozen || busy}>
          <legend>{page * 10 + index + 1}. {item.prompt}{item.critical ? " · критичный" : ""}</legend>
          {item.kind === "yes_no" ? <div className="checklist-choice" role="group" aria-label={item.prompt}>
            <button className={value === "yes" ? "is-on" : ""} type="button" onClick={() => change(item.id, "yes")}>Да</button>
            <button className={value === "no" ? "is-on" : ""} type="button" onClick={() => change(item.id, "no")}>Нет</button>
          </div> : null}
          {item.kind === "number" ? <label><span className="quiet">Число, {item.unit}</span><input inputMode="decimal" value={value} onChange={(event) => change(item.id, event.target.value.trim())} /></label> : null}
          {kind ? <label><span className="quiet">{file ? file.filename : "Файл ещё не выбран"}</span><input type="file" accept={kind.accept} onChange={(event) => void chooseFile(item, event.target.files?.[0] ?? null)} /></label> : null}
          {item.kind === "batch" ? <p className="quiet">Проверка партии ещё не подключена. Произвольный номер здесь не станет успешным результатом.</p> : null}
        </fieldset>;
      })}
      {pages > 1 ? <div className="checklist-step">
        <button className="ghost desk-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button>
        <button className="ghost desk-action" type="button" disabled={page === pages - 1} onClick={() => setPage(page + 1)}>Далее</button>
      </div> : null}
      <button className="fill desk-action" type="submit" disabled={busy || frozen}>{busy ? "Записываем…" : "Сохранить на сервере"}</button>
    </form> : null}
  </section>;
}
