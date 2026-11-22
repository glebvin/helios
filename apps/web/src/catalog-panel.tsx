import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { Flash } from "./flash";
import { DeskBadge, DeskEmpty, DeskSelect } from "./kit";
import { NoteMark } from "./note-mark";
import { staffRequest } from "./staff-form";
import { ApiError, v1 } from "./v1";
import {
  canWriteCatalog, catalogBody, catalogError, catalogValidation, requirementLabels, workTypeDraft, zoneDraft,
  type CatalogItem, type CatalogKind, type CatalogPage, type WorkType, type WorkTypeDraft, type Zone, type ZoneDraft,
} from "./catalog";

const titles = { zones: "Зоны", "work-types": "Виды работ" } as const;
const describe = (reason: unknown) => catalogError(reason instanceof ApiError ? reason.status : null, reason instanceof ApiError ? reason.message : "");

export function ProjectCatalogs({ session, projectId, writable }: { session: Session; projectId: string; writable: boolean }) {
  if (!projectId) return <DeskEmpty title="Объект не выбран" description="Выберите объект в шапке. Зоны и виды работ читаются только у него." />;
  return (
    <div className="documents-top">
      <CatalogPanel key={`${session.tenantId}:${projectId}:zones`} session={session} projectId={projectId} kind="zones" writable={writable} />
      <CatalogPanel key={`${session.tenantId}:${projectId}:work-types`} session={session} projectId={projectId} kind="work-types" writable={writable} />
    </div>
  );
}

function CatalogPanel({ session, projectId, kind, writable }: { session: Session; projectId: string; kind: CatalogKind; writable: boolean }) {
  const [offset, setOffset] = useState(0);
  const [pass, setPass] = useState(0);
  const [page, setPage] = useState<CatalogPage<CatalogItem> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [editor, setEditor] = useState<CatalogItem | "new" | null>(null);
  const [saved, setSaved] = useState("");
  const [savedPulse, setSavedPulse] = useState(0);
  const path = `/projects/${projectId}/${kind}`;
  const canWrite = writable && canWriteCatalog(session.role) && !blocked;
  useEffect(() => {
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        const rows = await v1<CatalogPage<CatalogItem>>(session, `${path}?limit=25&offset=${offset}`);
        if (!live) return;
        setPage(rows); setError(""); setBlocked(false);
        if (offset && offset >= rows.total) setOffset(Math.max(0, Math.floor((rows.total - 1) / 25) * 25));
      } catch (reason) {
        if (!live) return;
        setPage(null); setError(describe(reason));
        if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) { setBlocked(true); setEditor(null); }
      } finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, path, offset, pass]);
  return <section className="panel qualifications" aria-label={titles[kind]}>
    <div className="documents-heading">
      <div className="documents-title">
        <h2>{titles[kind]}</h2>
        <NoteMark label={kind === "zones" ? "Как устроены зоны" : "Как устроены виды работ"}>
          {kind === "zones" ? <p>Архивная зона остаётся в списке, но для нового задания не предлагается.</p> : <p>Единица берётся из вида работ. Требования РД, материалов, предшественника и ИД сохраняются как есть: сервер не даст опубликовать задание, пока обязательной записи нет. Скрытые работы всегда сдаются нашему ПТО. Снять отметку можно только правкой вида.</p>}
        </NoteMark>
      </div>
      {canWrite ? <button className="ghost desk-action" type="button" onClick={() => { setEditor("new"); setSaved(""); }}>{kind === "zones" ? "Добавить зону" : "Добавить вид"}</button> : null}
    </div>
    {kind === "work-types" ? <InspectionPolicy session={session} projectId={projectId} writable={canWrite} /> : null}
    {loading && !page ? <p className="quiet" role="status">Читаем справочник…</p> : null}
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {page && !error ? <>
      {page.items.length === 0 ? <p className="quiet">{kind === "zones" ? "Зон пока нет. Добавьте участок, чтобы ставить на него задание." : "Видов работ пока нет. У вида указываются единица и требования."}</p> : <div className="qualification-list">{page.items.map((row) => <CatalogRow key={row.id} kind={kind} row={row} canWrite={canWrite} onEdit={() => { setEditor(row); setSaved(""); }} />)}</div>}
      {page.total > 25 ? <div className="qualification-bar"><button className="ghost desk-action" type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))}>Назад</button><span className="quiet">{offset + 1}–{offset + page.items.length} из {page.total}</span><button className="ghost desk-action" type="button" disabled={loading || offset + page.items.length >= page.total} onClick={() => setOffset(offset + 25)}>Далее</button></div> : null}
    </> : null}
    <Flash message={saved} pulse={savedPulse} />
    {editor && canWrite ? <CatalogEditor session={session} path={path} kind={kind} row={editor === "new" ? null : editor} onClose={() => setEditor(null)} onSaved={(row) => { setEditor(null); setSaved(`Сервер записал «${row.name}».`); setSavedPulse((value) => value + 1); setPass((value) => value + 1); }} /> : null}
  </section>;
}

function CatalogRow({ kind, row, canWrite, onEdit }: { kind: CatalogKind; row: CatalogItem; canWrite: boolean; onEdit: () => void }) {
  const requirements = kind === "work-types" ? requirementLabels(row as WorkType) : [];
  return <article className="qualification-row">
    <div>
      <b>{row.name}</b>
      <span className="quiet catalog-meta">{kind === "work-types" ? <span>{(row as WorkType).unit}</span> : null}{requirements.map((label) => <span key={label}>{label}</span>)}{kind === "work-types" && requirements.length === 0 ? <span>без дополнительных требований</span> : null}</span>
    </div>
    {row.status === "archived" ? <DeskBadge tone="neutral">В архиве</DeskBadge> : null}
    {canWrite ? <button className="ghost desk-action" type="button" onClick={onEdit}>Изменить</button> : null}
  </article>;
}

function CatalogEditor({ session, path, kind, row, onClose, onSaved }: { session: Session; path: string; kind: CatalogKind; row: CatalogItem | null; onClose: () => void; onSaved: (row: CatalogItem) => void }) {
  const [source, setSource] = useState(row);
  const [draft, setDraft] = useState<ZoneDraft | WorkTypeDraft>(kind === "zones" ? zoneDraft(row) : workTypeDraft(row as WorkType | null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stored, setStored] = useState(true);
  const lock = useRef(false);
  const request = useRef({ id: "", key: "" });
  const pendingKey = `helios.catalog:${session.tenantId}:${session.userId}:${path}:${row?.id ?? "new"}`;
  const problem = catalogValidation(kind, draft);
  async function submit() {
    if (lock.current || problem) return;
    const fields = catalogBody(kind, draft, source, "");
    const { requestId: _ignored, ...identity } = fields;
    const key = JSON.stringify(identity);
    if (!request.current.id) {
      try {
        const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
        if (typeof previous?.id === "string" && typeof previous?.key === "string") request.current = previous;
      } catch { /* The open form can still repeat the same attempt. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); setStored(true); } catch { setStored(false); }
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await v1<CatalogItem>(session, source ? `${path}/${source.id}` : path, catalogBody(kind, draft, source, request.current.id), source ? "PUT" : "POST");
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server answer is enough. */ }
      onSaved(result);
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  async function readCurrent() {
    if (!source || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      let next = 0;
      while (true) {
        const found = await v1<CatalogPage<CatalogItem>>(session, `${path}?limit=100&offset=${next}`);
        const current = found.items.find((item) => item.id === source.id);
        if (current) { setSource(current); setDraft(kind === "zones" ? zoneDraft(current) : workTypeDraft(current as WorkType)); setError(""); request.current = { id: "", key: "" }; return; }
        next += found.items.length;
        if (next >= found.total || !found.items.length) throw new ApiError(404, "not_found");
      }
    } catch (reason) { setError(describe(reason)); }
    finally { lock.current = false; setBusy(false); }
  }
  const type = draft as WorkTypeDraft;
  return <Dialog title={row ? `Изменить ${kind === "zones" ? "зону" : "вид работ"}` : kind === "zones" ? "Новая зона" : "Новый вид работ"} onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <fieldset className="employee-fields" disabled={busy}>
        <label className="field"><span>Название</span><input required maxLength={200} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        {kind === "work-types" ? <>
          <label className="field"><span>Единица</span><input required maxLength={40} value={type.unit} onChange={(event) => setDraft({ ...type, unit: event.target.value })} /></label>
          <CheckLine checked={type.requiresRd} onChange={(value) => setDraft({ ...type, requiresRd: value })}>Нужна рабочая документация</CheckLine>
          <CheckLine checked={type.requiresMaterialControl} onChange={(value) => setDraft({ ...type, requiresMaterialControl: value })}>Нужен входной контроль материалов</CheckLine>
          <CheckLine checked={type.requiresPredecessorAcceptance} onChange={(value) => setDraft({ ...type, requiresPredecessorAcceptance: value })}>Нужна приёмка предшественника</CheckLine>
          <CheckLine checked={type.requiresId} onChange={(value) => setDraft({ ...type, requiresId: value })}>Нужна исполнительная документация</CheckLine>
          <CheckLine checked={type.hiddenWork} onChange={(value) => setDraft({ ...type, hiddenWork: value })}>Скрытые работы</CheckLine>
        </> : null}
        {source ? <DeskSelect label="Состояние" value={draft.status} options={[{ value: "active", label: "Активна" }, { value: "archived", label: "В архиве" }]} onChange={(value) => setDraft({ ...draft, status: value === "archived" ? "archived" : "active" })} /> : null}
      </fieldset>
      {problem ? <p className="quiet">{problem}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {error && source ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => void readCurrent()}>Прочитать актуальную запись</button> : null}
      {error && !stored ? <p className="quiet">Номер попытки не сохранён браузером. Повторите в этой форме, не закрывая её.</p> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : "Сохранить"}</button>
    </form>
  </Dialog>;
}

function InspectionPolicy({ session, projectId, writable }: { session: Session; projectId: string; writable: boolean }) {
  const [policy, setPolicy] = useState<{ required: boolean; version: number } | null>(null);
  const [required, setRequired] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(0);
  const request = useRef({ id: "", key: "" });
  const path = `/projects/${projectId}/internal-inspection-policy`;
  const pendingKey = `helios.inspection-policy:${session.tenantId}:${session.userId}:${projectId}`;
  useEffect(() => {
    let live = true;
    void v1<{ required: boolean; version: number }>(session, path).then((row) => {
      if (!live) return;
      setPolicy(row); setRequired(row.required); setError("");
    }).catch((reason) => { if (live) setError(describe(reason)); });
    return () => { live = false; };
  }, [session.token, session.tenantId, path, pass]);
  async function save() {
    if (!policy || busy) return;
    const key = JSON.stringify({ required, expectedVersion: policy.version });
    if (!request.current.id) {
      try {
        const previous = JSON.parse(sessionStorage.getItem(pendingKey) ?? "null");
        if (typeof previous?.id === "string" && previous.key === key) request.current = previous;
      } catch { /* The open form can still repeat this attempt. */ }
    }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pendingKey, JSON.stringify(request.current)); } catch { /* The server answer remains the confirmation. */ }
    setBusy(true); setError("");
    try {
      const savedPolicy = await v1<{ required: boolean; version: number }>(session, path, { requestId: request.current.id, expectedVersion: policy.version, required });
      try { sessionStorage.removeItem(pendingKey); } catch { /* The server already confirmed the setting. */ }
      request.current = { id: "", key: "" };
      setPolicy(savedPolicy); setRequired(savedPolicy.required);
      setSaved(savedPolicy.required ? "Для остальных работ наш ПТО включён." : "Для остальных работ наш ПТО выключен.");
      setPulse((value) => value + 1);
    } catch (reason) { setError(describe(reason)); }
    finally { setBusy(false); }
  }
  return <div>
    {writable ? <CheckLine checked={required} onChange={setRequired}>Для остальных работ наш ПТО обязателен</CheckLine> : <p>{required ? "Для остальных работ проверка нашего ПТО включена." : "Для остальных работ проверка нашего ПТО выключена."}</p>}
    <p className="quiet">Скрытые работы и субподряд эта настройка не отменяет.</p>
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Прочитать настройку</button></p> : null}
    {writable ? <button className="fill desk-action" type="button" disabled={busy || !policy || policy.required === required} onClick={() => void save()}>{busy ? "Записываем…" : "Сохранить настройку"}</button> : null}
    <Flash message={saved} pulse={pulse} />
  </div>;
}

function CheckLine({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return <label className="check-line"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{children}</label>;
}
