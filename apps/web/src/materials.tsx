import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { clearMaterialCommand, keepMaterialCommand, readMaterialCommand, type MaterialCommand } from "./material-command";

type Doc = { id: string; filename: string; contentType: string; sizeBytes: number; sha256: string; state: "pending" | "ready" };
type Item = {
  id: string; organizationId: string; organizationName: string; version: number; materialName: string; unit: string;
  batchCode: string; supplierName: string; deliveryDocument: string; deliveredOn: string; deliveredQuantity: string;
  statusLabel: string; documents: Doc[];
};
type Page = { total: number; limit: number; offset: number; employers: { id: string; name: string }[]; items: Item[] };
type History = { version: number; materialName: string; batchCode: string; deliveredQuantity: string; unit: string; deliveredOn: string; createdAt: string };
type Card = Item & { history: History[] };
type Draft = { organizationId: string; materialName: string; unit: string; batchCode: string; supplierName: string; deliveryDocument: string; deliveredOn: string; deliveredQuantity: string };
type Prepared = { filename: string; contentType: string; sizeBytes: number; sha256: string; bytes: ArrayBuffer };

const emptyDraft: Draft = { organizationId: "", materialName: "", unit: "", batchCode: "", supplierName: "", deliveryDocument: "", deliveredOn: "", deliveredQuantity: "" };
const ease = [0.23, 1, 0.32, 1] as const;

function reason(error: unknown) {
  const code = error instanceof ApiError ? error.message : "";
  if (code === "stale_version") return "Партию уже изменили. Открыта последняя версия.";
  if (code === "batch_code_taken") return "Такой номер партии у этого работодателя уже есть.";
  if (code === "employer_denied") return "Этот работодатель входу не разрешён.";
  if (code === "role_denied") return "Этому входу запись не разрешена.";
  if (code === "invalid_quantity") return "Количество — число больше нуля, не больше трёх знаков после запятой.";
  if (code === "invalid_documents" || code === "invalid_content_type" || code === "invalid_filename") return "Нужен файл PDF, JPEG или PNG.";
  if (code === "invalid_size") return "Файл должен быть от1байта до8МБ.";
  return "Результат записи не подтверждён. Повторите исходную команду.";
}

async function prepare(file: File): Promise<Prepared> {
  const contentType = file.type === "image/jpeg" || file.type === "image/png" || file.type === "application/pdf" ? file.type : "";
  if (!contentType) throw new ApiError(400, "invalid_content_type");
  if (file.size < 1 || file.size > 8 * 1024 * 1024) throw new ApiError(400, "invalid_size");
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { filename: file.name, contentType, sizeBytes: bytes.byteLength, sha256, bytes };
}

async function sendBytes(session: Session, projectId: string, batchId: string, documentId: string, bytes: ArrayBuffer) {
  const response = await fetch(`/api/v1/projects/${projectId}/material-batches/${batchId}/documents/${documentId}/content`, {
    method: "PUT",
    headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId, "content-type": "application/octet-stream" },
    body: bytes,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = "upload_failed";
    try { message = (JSON.parse(text) as { error?: string }).error ?? message; } catch { /* keep the fallback */ }
    throw new ApiError(response.status, message);
  }
}

export function Materials({ session, projectId, canEdit }: { session: Session; projectId: string; canEdit: boolean }) {
  const reduce = useReducedMotion();
  const live = useRef(true);
  const mutation = useRef(false);
  const commandKey = `helios.material:${session.tenantId}:${session.userId}:${projectId}`;
  const [pending, setPending] = useState<MaterialCommand | null>(() => readMaterialCommand(commandKey));
  useEffect(() => () => { live.current = false; }, []);
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [selected, setSelected] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [file, setFile] = useState<File | null>(null);
  const [writing, setWriting] = useState(false);
  const [mode, setMode] = useState<"read" | "create" | "edit">("read");
  const [problem, setProblem] = useState("");
  const [flash, setFlash] = useState("");
  const [pulse, setPulse] = useState(0);
  const limit = 8;

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void v1<Page>(session, `/projects/${projectId}/material-batches?limit=${limit}&offset=${offset}${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`)
        .then((next) => { if (live) { setPage(next); setProblem(""); } })
        .catch(() => { if (live) setProblem("Реестр не прочитан."); });
    }, query ? 300 : 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [session, projectId, query, offset, pulse]);

  useEffect(() => {
    if (!projectId || !selected) { setCard(null); return; }
    setCard(null);
    let live = true;
    void v1<Card>(session, `/projects/${projectId}/material-batches/${selected}`)
      .then((next) => { if (live) setCard(next); })
      .catch(() => { if (live) setCard(null); });
    return () => { live = false; };
  }, [session, projectId, selected, pulse]);

  function tell(message: string) { setFlash(message); setPulse((value) => value + 1); }

  async function openDocument(document: Doc) {
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/material-batches/${selected}/documents/${document.id}/content`, {
        headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
      });
      if (!live.current) return;
      if (!response.ok) { setProblem(response.status === 409 ? "Документ ещё не загружен." : "Документ не открыт."); return; }
      const blob = await response.blob(); if (!live.current) return;
      const href = URL.createObjectURL(blob); window.open(href, "_blank", "noopener");
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch { if (live.current) setProblem("Документ не открыт: нет ответа сервера."); }
  }

  async function retryDocument(document: Doc, chosen: File | undefined) {
    if (!chosen || mutation.current) return;
    mutation.current = true; setWriting(true); setProblem("");
    try {
      const prepared = await prepare(chosen);
      if (prepared.sha256 !== document.sha256 || prepared.sizeBytes !== document.sizeBytes || prepared.contentType !== document.contentType) throw new Error("Нужен тот же файл, который указан в партии.");
      await sendBytes(session, projectId, selected, document.id, prepared.bytes);
      if (live.current) tell("Документ загружен и проверен.");
    } catch (error) { if (live.current) setProblem(error instanceof ApiError ? reason(error) : error instanceof Error ? error.message : "Документ не загружен."); }
    finally { mutation.current = false; if (live.current) setWriting(false); }
  }

  async function save(event?: FormEvent) {
    event?.preventDefault();
    if (!canEdit || mutation.current) return;
    mutation.current = true; setWriting(true); setProblem("");
    let command = pending;
    try {
      const prepared = file ? await prepare(file) : null;
      if (!command) {
        if (mode === "create" && !prepared) { setProblem("Приложите документ качества."); return; }
        const documents = prepared ? [{ filename: prepared.filename, contentType: prepared.contentType, sizeBytes: prepared.sizeBytes, sha256: prepared.sha256 }] : [];
        const fields = { materialName: draft.materialName, unit: draft.unit, batchCode: draft.batchCode, supplierName: draft.supplierName, deliveryDocument: draft.deliveryDocument, deliveredOn: draft.deliveredOn, deliveredQuantity: draft.deliveredQuantity.replace(",", "."), documents };
        command = keepMaterialCommand(commandKey, mode === "edit" && card
          ? {path: `/projects/${projectId}/material-batches/${card.id}`, body: {requestId:crypto.randomUUID(), expectedVersion:card.version, ...fields}}
          : {path: `/projects/${projectId}/material-batches`, body: {requestId:crypto.randomUUID(), organizationId:draft.organizationId, ...fields}});
        setPending(command);
      }
      const saved = await v1<Card>(session, command.path, command.body);
      if (readMaterialCommand(commandKey)?.body.requestId === command.body.requestId) clearMaterialCommand(commandKey);
      if (!live.current) return;
      setPending(null); setSelected(saved.id); setCard(saved); setMode("read"); setFile(null); setDraft(emptyDraft);
      const unfinished = saved.documents.find(item => item.state === "pending" && prepared && item.sha256 === prepared.sha256);
      if (unfinished && prepared) {
        try { await sendBytes(session, projectId, saved.id, unfinished.id, prepared.bytes); }
        catch { if (live.current) tell("Партия сохранена. Документ не загружен: выберите тот же файл для дозагрузки."); return; }
      } else if (saved.documents.some(item => item.state === "pending")) {
        tell("Партия сохранена. Документ не загружен: выберите тот же файл для дозагрузки."); return;
      }
      if (live.current) tell("Партия сохранена.");
    } catch (error) {
      if (!live.current) return;
      if (error instanceof ApiError && error.status < 500 && error.status !== 408 && command) {
        if (readMaterialCommand(commandKey)?.body.requestId === command.body.requestId) clearMaterialCommand(commandKey);
        setPending(null);
      }
      setProblem(reason(error));
      if (error instanceof ApiError && error.message === "stale_version") setPulse(value => value + 1);
    } finally { mutation.current = false; if (live.current) setWriting(false); }
  }

  const form = (
    <form className="material-form" onSubmit={(event) => void save(event)}>
      <fieldset disabled={writing || Boolean(pending)} style={{border:0,padding:0,margin:0,minWidth:0,display:"contents"}}>
      {mode === "create" ? (
        <label className="field"><span>Работодатель</span>
          <select aria-label="Работодатель" value={draft.organizationId} onChange={(event) => setDraft({ ...draft, organizationId: event.target.value })} required>
            <option value="">Выберите</option>
            {(page?.employers ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      ) : null}
      <label className="field"><span>Материал</span><input value={draft.materialName} onChange={(event) => setDraft({ ...draft, materialName: event.target.value })} required /></label>
      <label className="field"><span>Единица</span><input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} required /></label>
      <label className="field"><span>Номер партии</span><input value={draft.batchCode} onChange={(event) => setDraft({ ...draft, batchCode: event.target.value })} required /></label>
      <label className="field"><span>Поставщик</span><input value={draft.supplierName} onChange={(event) => setDraft({ ...draft, supplierName: event.target.value })} required /></label>
      <label className="field"><span>Документ поставки</span><input value={draft.deliveryDocument} onChange={(event) => setDraft({ ...draft, deliveryDocument: event.target.value })} required /></label>
      <label className="field"><span>Дата поставки</span><input type="date" value={draft.deliveredOn} onChange={(event) => setDraft({ ...draft, deliveredOn: event.target.value })} required /></label>
      <label className="field"><span>Количество</span><input inputMode="decimal" value={draft.deliveredQuantity} onChange={(event) => setDraft({ ...draft, deliveredQuantity: event.target.value })} required /></label>
      <label className="field"><span>{mode === "create" ? "Документ качества" : "Ещё документ"}</span><input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      {problem ? <p role="alert">{problem}</p> : null}
      <div className="material-actions">
        <button className="desk-action fill" type="submit" disabled={writing}>{writing ? "Сохраняем" : "Сохранить"}</button>
        <button className="desk-action" type="button" onClick={() => { setMode("read"); setProblem(""); setFile(null); }}>Отмена</button>
      </div>
      </fieldset>
    </form>
  );

  return (
    <section className="page">
      <div className="documents-title">
        <h1>Материалы</h1>
        <NoteMark label="Что это за запись">Партия ждёт входного контроля. Принять её здесь нельзя, и в задание она не выбирается. Это не склад, не закупка и не оплата.</NoteMark>
      </div>
      <p className="sub">Реестр партий и документов качества на объекте.</p>
      <Flash message={flash} pulse={pulse} />
      {pending ? <div role="status"><p>Результат записи не получен. Повтор отправит исходную команду.</p><button className="desk-action" type="button" disabled={writing} onClick={() => void save()}>Повторить запись партии</button></div> : null}
      {!projectId ? <DeskEmpty title="Объект не выбран" description="Откройте объект, к которому у этого входа есть доступ." /> : (
        <div className="material-board">
          <section className="panel material-hold">
            <div className="panel-head"><h2>Партии</h2></div>
            <label className="field"><span>Поиск</span><input value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Материал, номер или поставщик" /></label>
            {!page ? <p className="quiet">Читаем партии.</p> : page.items.length === 0 ? (
              <DeskEmpty title={query.trim() ? "Ничего не найдено" : "Партий нет"} description={query.trim() ? "Проверьте название, номер партии или поставщика." : "Запишите поставку. Она останется на сервере и будет ждать входного контроля."} />
            ) : (
              <motion.div key={`${query}:${offset}`} className="roles material-picks" role="tablist" aria-label="Партии" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }}>
                {page.items.map((item) => (
                  <button key={item.id} type="button" role="tab" aria-selected={selected === item.id} disabled={writing || Boolean(pending)} className={selected === item.id ? "is-on" : ""} onClick={() => { setSelected(item.id); setMode("read"); setProblem(""); }}>
                    {item.materialName} · {item.batchCode}
                  </button>
                ))}
              </motion.div>
            )}
            {page && page.total > page.limit ? (
              <div className="material-actions">
                <button className="desk-action" type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>Назад</button>
                <button className="desk-action" type="button" disabled={offset + page.items.length >= page.total} onClick={() => setOffset(offset + limit)}>Дальше</button>
              </div>
            ) : null}
            {canEdit && mode !== "create" ? <button className="desk-action" type="button" disabled={writing || Boolean(pending)} onClick={() => { setMode("create"); setDraft({ ...emptyDraft, organizationId: page?.employers.length === 1 ? page.employers[0]!.id : "" }); setFile(null); setProblem(""); }}>Новая партия</button> : null}
            {problem && mode === "read" ? <p role="alert">{problem}</p> : null}
          </section>
          <section className="panel material-hold">
            {mode === "create" ? form : selected && card?.id === selected ? (
              <motion.div key={card.id + card.version} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }}>
                <div className="panel-head"><h2>{card.materialName}</h2><span>{card.statusLabel}</span></div>
                {mode === "edit" ? form : (
                  <>
                    <dl className="task-facts">
                      <div><dt>Работодатель</dt><dd>{card.organizationName}</dd></div>
                      <div><dt>Номер партии</dt><dd>{card.batchCode}</dd></div>
                      <div><dt>Поставщик</dt><dd>{card.supplierName}</dd></div>
                      <div><dt>Документ поставки</dt><dd>{card.deliveryDocument}</dd></div>
                      <div><dt>Дата</dt><dd>{card.deliveredOn}</dd></div>
                      <div><dt>Количество</dt><dd>{card.deliveredQuantity} {card.unit}</dd></div>
                    </dl>
                    <ul className="material-docs">
                      {card.documents.map((document) => (
                        <li key={document.id}>
                          <span>{document.filename}</span>
                          {document.state === "ready" ? <button className="desk-action" type="button" onClick={() => void openDocument(document)}>Открыть</button> : <span className="quiet">Загрузка не завершена{canEdit ? <label> Дозагрузить<input type="file" aria-label={`Дозагрузить ${document.filename}`} accept="application/pdf,image/jpeg,image/png" disabled={writing} onChange={event => { void retryDocument(document, event.target.files?.[0]); event.target.value = ""; }} /></label> : null}</span>}
                        </li>
                      ))}
                    </ul>
                    <ol className="timeline">
                      {card.history.map((item, index) => (
                        <li className="timeline-item" key={item.version}>
                          <span className="timeline-rail" aria-hidden="true">{index < card.history.length - 1 ? <i /> : null}<b className="is-on" /></span>
                          <span><strong>Версия {item.version}</strong><small>{item.materialName} · {item.batchCode} · {item.deliveredQuantity} {item.unit}</small></span>
                          <time dateTime={item.createdAt}>{item.deliveredOn}</time>
                        </li>
                      ))}
                    </ol>
                    {canEdit ? <button className="desk-action" type="button" disabled={writing || Boolean(pending)} onClick={() => { setMode("edit"); setDraft({ organizationId: card.organizationId, materialName: card.materialName, unit: card.unit, batchCode: card.batchCode, supplierName: card.supplierName, deliveryDocument: card.deliveryDocument, deliveredOn: card.deliveredOn, deliveredQuantity: card.deliveredQuantity }); setFile(null); }}>Изменить</button> : null}
                  </>
                )}
              </motion.div>
            ) : selected ? <p className="quiet">Читаем партию.</p> : <DeskEmpty title="Партия не выбрана" description="Выберите партию слева, чтобы увидеть реквизиты, документ и историю." />}
          </section>
        </div>
      )}
    </section>
  );
}
