import { useEffect, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { DeskEmpty } from "./kit";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { MaterialControl, controlStepLabel, type ControlCard } from "./material-control";
import { roleTitle } from "./roles";

type Doc = { id: string; filename: string; contentType: string; sizeBytes: number; sha256: string; state: "pending" | "ready" };
type Item = {
  id: string; organizationId: string; organizationName: string; version: number; materialName: string; unit: string;
  batchCode: string; supplierName: string; deliveryDocument: string; deliveredOn: string; deliveredQuantity: string;
  statusLabel: string; documents: Doc[];
};
type Page = { total: number; limit: number; offset: number; employers: { id: string; name: string }[]; items: Item[] };
type History = { version: number; materialName: string; batchCode: string; deliveredQuantity: string; unit: string; deliveredOn: string; createdAt: string };
type Card = Item & { history: History[]; control: ControlCard | null; intake: { zones: { id: string; name: string }[]; workTypes: { id: string; name: string }[]; templates: { id: string; title: string; edition: number; items: ControlCard["items"] }[] } };
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
  return "Сервер не сохранил партию.";
}

async function prepare(file: File): Promise<Prepared> {
  const contentType = file.type === "image/jpeg" || file.type === "image/png" || file.type === "application/pdf" ? file.type : "";
  if (!contentType) throw new ApiError(400, "invalid_content_type");
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
    let live = true;
    void v1<Card>(session, `/projects/${projectId}/material-batches/${selected}`)
      .then((next) => { if (live) setCard(next); })
      .catch(() => { if (live) setCard(null); });
    return () => { live = false; };
  }, [session, projectId, selected, pulse]);

  function tell(message: string) { setFlash(message); setPulse((value) => value + 1); }

  async function openDocument(document: Doc) {
    const response = await fetch(`/api/v1/projects/${projectId}/material-batches/${selected}/documents/${document.id}/content`, {
      headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
    });
    if (!response.ok) { setProblem(response.status === 409 ? "Документ ещё не загружен." : "Документ не открыт."); return; }
    const href = URL.createObjectURL(await response.blob());
    window.open(href, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || writing) return;
    setWriting(true);
    setProblem("");
    try {
      const prepared = file ? await prepare(file) : null;
      if (mode === "create" && !prepared) { setProblem("Приложите документ качества."); return; }
      const deliveredQuantity = draft.deliveredQuantity.replace(",", ".");
      const documents = prepared ? [{ filename: prepared.filename, contentType: prepared.contentType, sizeBytes: prepared.sizeBytes, sha256: prepared.sha256 }] : [];
      const fields = { materialName: draft.materialName, unit: draft.unit, batchCode: draft.batchCode, supplierName: draft.supplierName, deliveryDocument: draft.deliveryDocument, deliveredOn: draft.deliveredOn, deliveredQuantity, documents };
      const saved = mode === "edit" && card
        ? await v1<Card>(session, `/projects/${projectId}/material-batches/${card.id}`, { requestId: crypto.randomUUID(), expectedVersion: card.version, ...fields })
        : await v1<Card>(session, `/projects/${projectId}/material-batches`, { requestId: crypto.randomUUID(), organizationId: draft.organizationId, ...fields });
      if (prepared) {
        const pending = saved.documents.find((item) => item.state === "pending" && item.sha256 === prepared.sha256 && item.filename === prepared.filename);
        if (!pending) throw new ApiError(409, "document_pending");
        try { await sendBytes(session, projectId, saved.id, pending.id, prepared.bytes); }
        catch { tell("Партия сохранена. Документ не загружен и не отмечен готовым."); setSelected(saved.id); setMode("read"); setFile(null); return; }
      }
      setSelected(saved.id);
      setMode("read");
      setFile(null);
      setDraft(emptyDraft);
      tell(mode === "edit" ? "Изменение сохранено." : "Партия сохранена.");
    } catch (error) {
      setProblem(reason(error));
      if (error instanceof ApiError && error.message === "stale_version") setPulse((value) => value + 1);
    } finally { setWriting(false); }
  }

  const form = (
    <form className="material-form" onSubmit={(event) => void save(event)}>
      {mode === "create" ? (
        <label className="field"><span>Работодатель</span>
          <select value={draft.organizationId} onChange={(event) => setDraft({ ...draft, organizationId: event.target.value })} required>
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
    </form>
  );

  return (
    <section className="page">
      <div className="documents-title">
        <h1>Материалы</h1>
        <NoteMark label="Что это за запись">Результат считает сервер по утверждённому чек-листу и маршруту. Кнопки «Принять» нет. В задание попадает только принятая партия. Это не склад, не закупка и не оплата.</NoteMark>
      </div>
      <p className="sub">Реестр партий и документов качества на объекте.</p>
      <Flash message={flash} pulse={pulse} />
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
                  <button key={item.id} type="button" role="tab" aria-selected={selected === item.id} className={selected === item.id ? "is-on" : ""} onClick={() => { setSelected(item.id); setMode("read"); setProblem(""); }}>
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
            {canEdit && mode !== "create" ? <button className="desk-action" type="button" onClick={() => { setMode("create"); setDraft({ ...emptyDraft, organizationId: page?.employers[0]?.id ?? "" }); setFile(null); setProblem(""); }}>Новая партия</button> : null}
            {problem && mode === "read" ? <p role="alert">{problem}</p> : null}
          </section>
          <section className="panel material-hold">
            {mode === "create" ? form : selected && card?.id === selected ? (
              <motion.div key={card.id + card.version} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease }}>
                <div className="panel-head"><h2>{card.materialName}</h2><span>{card.control?.verdictLabel ?? card.statusLabel}</span></div>
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
                          {document.state === "ready" ? <button className="desk-action" type="button" onClick={() => void openDocument(document)}>Открыть</button> : <span className="quiet">Загрузка не завершена</span>}
                        </li>
                      ))}
                    </ul>
                    <ol className="timeline">
                      {card.history.map((item, index) => (
                        <li className="timeline-item" key={item.version}>
                          <span className="timeline-rail" aria-hidden="true">{index < card.history.length - 1 || (card.control?.steps.length ?? 0) > 0 ? <i /> : null}<b className="is-on" /></span>
                          <span><strong>Версия {item.version}</strong><small>{item.materialName} · {item.batchCode} · {item.deliveredQuantity} {item.unit}</small></span>
                          <time dateTime={item.createdAt}>{item.deliveredOn}</time>
                        </li>
                      ))}
                      {(card.control?.steps ?? []).map((step, index, list) => (
                        <li className="timeline-item" key={`control-${step.version}`}>
                          <span className="timeline-rail" aria-hidden="true">{index < list.length - 1 ? <i /> : null}<b className="is-on" /></span>
                          <span><strong>{controlStepLabel(step)}</strong><small>{roleTitle(step.actorRole)}{step.reason ? ` · ${step.reason}` : ""}</small></span>
                          <time dateTime={step.createdAt}>{new Date(step.createdAt).toLocaleDateString("ru-RU")}</time>
                        </li>
                      ))}
                    </ol>
                    {canEdit ? <button className="desk-action" type="button" onClick={() => { setMode("edit"); setDraft({ organizationId: card.organizationId, materialName: card.materialName, unit: card.unit, batchCode: card.batchCode, supplierName: card.supplierName, deliveryDocument: card.deliveryDocument, deliveredOn: card.deliveredOn, deliveredQuantity: card.deliveredQuantity }); setFile(null); }}>Изменить</button> : null}
                    <MaterialControl session={session} projectId={projectId} batchId={card.id} documents={card.documents} control={card.control} intake={card.intake} onDone={(message) => { setFlash(message); setPulse((value) => value + 1); setSelected(card.id); }} />
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
