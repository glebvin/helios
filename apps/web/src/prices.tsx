import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { Flash } from "./flash";
import { Mark } from "./mark";
import { ApiError, v1 } from "./v1";
import { readPriceCommand, keepPriceCommand, clearPriceCommand, type PriceCommand } from "./price-command";
import { readPriceImport, keepPriceImport, clearPriceImport, type PriceImportCommand } from "./price-import-command";

type Project = { id: string; name: string };
type Revision = { version: number; unit: string; price: string; start: string; end: string; createdAt: string };
type WorkType = { id: string; name: string; unit: string; status: string; headVersion: number; acting: Revision | null; revisions: Revision[] };
type Register = { projectId: string; asOf: string; workTypes: WorkType[] };

const call = v1;

const reasons: Record<string, string> = {
  role_denied: "Этой роли действие недоступно.",
  not_found: "Объект или вид работ не найден.",
  stale_version: "Эту строку уже изменили. История обновлена, повторите запись.",
  price_period: "Период пересекается с другой редакцией той же единицы.",
  price_version: "Такая версия уже есть.",
  invalid_price: "Цена должна быть нулём или положительным числом, не больше 6 знаков после запятой.",
  invalid_period: "Укажите существующие даты, конец не раньше начала.",
  reference_denied: "Вид работ архивный, новую цену к нему не записать.",
  price_import_rejected: "Таблица не записана: есть строка с ошибкой.",
  unknown_work_type: "Нет такого вида работ на объекте.",
  duplicate_work_type: "Вид работ повторяется в таблице.",
  ambiguous_work_type: "На объекте несколько видов работ с таким названием.",
  archived_work_type: "Вид работ архивный.",
  invalid_text: "Укажите название вида работ.",
  conflict: "Эту таблицу уже записывают в другом окне.",
};

type ImportRow = { line: number; workTypeName: string; unit: string | null; price: string; start: string; end: string; error: string | null };
type ImportPreview = { acceptable: boolean; rows: ImportRow[] };

function tableRows(text: string) {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [workTypeName = "", price = "", start = "", end = ""] = line.split(";").map((part) => part.trim());
    return { workTypeName, price, start, end };
  });
}

export function PriceDesk({ session, theme, onTheme, onLogout }: { session: Session; theme: "light" | "dark"; onTheme: () => void; onLogout: () => void }) {
  const reduce = useReducedMotion();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState("");
  const [loadedRegister, setRegister] = useState<Register | null>(null);
  const [selected, setSelected] = useState("");
  const [price, setPrice] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pulse, setPulse] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PriceCommand | null>(null);
  const [table, setTable] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const previewList = useRef<HTMLUListElement>(null);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<PriceImportCommand | null>(null);
  const importLock = useRef(false);
  const generation = useRef(0);
  const activeScope = useRef("");
  const scope = `helios.price:${session.tenantId}:${session.userId}:${projectId}`;
  activeScope.current = scope;
  const [pinned, setPinned] = useState(false);

  async function loadProjects() {
    const body = await call(session, "/contract-prices/projects") as { projects: Project[] };
    setProjects(body.projects);
    setProjectId((current) => current && body.projects.some((item) => item.id === current) ? current : body.projects[0]?.id ?? "");
  }

  async function loadRegister(id: string) {
    const pass = ++generation.current;
    const body = await call(session, `/projects/${id}/contract-prices`) as Register;
    if (pass !== generation.current || activeScope.current !== `helios.price:${session.tenantId}:${session.userId}:${id}`) return;
    setRegister(body);
    setSelected((current) => body.workTypes.some((item) => item.id === current) ? current : body.workTypes[0]?.id ?? "");
  }

  useEffect(() => { void loadProjects().catch((reason: Error) => setError(reasons[reason.message] ?? reason.message)); }, [session.token]);
  useEffect(() => { if (preview && !preview.acceptable) previewList.current?.focus(); }, [preview]);
  useEffect(() => {
    if (!projectId) { setRegister(null); return; }
    let live = true;
    setRegister(null); setError("");
    const heldImport = readPriceImport(`${scope}:import`);
    setPendingImport(heldImport); setTable(heldImport?.text ?? ""); setPreview(null);
    setChecking(false); setImporting(false);
    const held = readPriceCommand(scope); setPending(held);
    if (held) { setSelected(held.workTypeId); setPrice(held.price); setStart(held.start); setEnd(held.end); }
    else { setPrice(""); setStart(""); setEnd(""); }
    void loadRegister(projectId).catch((reason: Error) => { if (live) setError(reasons[reason.message] ?? reason.message); });
    return () => { live = false; generation.current += 1; };
  }, [projectId, session.token]);

  const register = loadedRegister?.projectId === projectId ? loadedRegister : null;
  const work = register?.workTypes.find((item) => item.id === selected) ?? null;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!work || saving) return;
    setSaving(true);
    setError("");
    const submittedScope = scope;
    const target = projectId;
    const body = pending ?? keepPriceCommand(scope, { requestId: crypto.randomUUID(), workTypeId: work.id, price: price.trim().replace(",", "."), start, end, expectedVersion: work.headVersion });
    setPending(body);
    try {
      await call(session, `/projects/${target}/contract-prices`, body);
      clearPriceCommand(submittedScope);
      if (activeScope.current !== submittedScope) return;
      setPending(null); setPrice("");
      setNotice("Редакция записана."); setPulse((value) => value + 1);
      await loadRegister(target).catch(() => setError("Редакция записана. Не удалось обновить реестр; повторите чтение."));
    } catch (reason) {
      if (activeScope.current !== submittedScope) return;
      const code = reason instanceof Error ? reason.message : "request_failed";
      if (reason instanceof ApiError && reason.status < 500) { clearPriceCommand(submittedScope); setPending(null); }
      setError(reason instanceof ApiError && reason.status < 500 ? reasons[code] ?? "Сервер не принял запись." : "Ответ сервера не подтверждён. Повтор отправит ту же редакцию.");
      if (code === "stale_version") await loadRegister(target).catch(() => {});
    } finally { setSaving(false); }
  }

  async function checkTable() {
    if (!projectId || checking || importing || pendingImport) return;
    const submittedScope = scope;
    setChecking(true); setError(""); setPreview(null);
    try {
      const next = await call<ImportPreview>(session, `/projects/${projectId}/contract-prices/checks`, { rows: tableRows(table) });
      if (activeScope.current !== submittedScope) return;
      setPreview(next);
    } catch (reason) {
      if (activeScope.current !== submittedScope) return;
      setError(reason instanceof ApiError ? reasons[reason.message] ?? "Сервер не принял таблицу." : "Не удалось проверить таблицу.");
    } finally { if (activeScope.current === submittedScope) setChecking(false); }
  }

  async function confirmTable() {
    if (!projectId || importLock.current || (!pendingImport && !preview?.acceptable)) return;
    const submittedScope = scope, target = projectId, key = `${scope}:import`;
    const command = pendingImport ?? keepPriceImport(key, { requestId: crypto.randomUUID(), text: table, rows: tableRows(table) });
    importLock.current = true; setPendingImport(command);
    setImporting(true); setError("");
    try {
      await call(session, `/projects/${target}/contract-prices/imports`, { requestId: command.requestId, rows: command.rows });
      clearPriceImport(key, command.requestId);
      if (activeScope.current !== submittedScope) return;
      setPendingImport(null); setTable(""); setPreview(null);
      setNotice("Таблица записана."); setPulse((value) => value + 1);
      await loadRegister(target).catch(() => { if (activeScope.current === submittedScope) setError("Таблица записана. Не удалось обновить реестр; повторите чтение."); });
    } catch (reason) {
      if (activeScope.current !== submittedScope) return;
      const code = reason instanceof Error ? reason.message : "request_failed";
      const rejected = reason instanceof ApiError && reason.status < 500 && reason.status !== 429;
      if (rejected) { clearPriceImport(key, command.requestId); setPendingImport(null); setPreview(null); }
      setError(rejected ? reasons[code] ?? "Сервер не принял таблицу." : "Ответ сервера не подтверждён. Повтор отправит ту же таблицу.");
    } finally { importLock.current = false; if (activeScope.current === submittedScope) setImporting(false); }
  }

  return (
    <main className="prices">
      <header>
        <Mark />
        <div><strong>Договорные цены</strong><small>Сметный отдел</small></div>
        <button className="desk-action" type="button" onClick={onTheme}>{theme === "dark" ? "Светлая" : "Тёмная"}</button>
        <button className="desk-action" type="button" onClick={onLogout}>Выйти</button>
      </header>
      <Flash message={notice} pulse={pulse} />
      <section className="price-card">
        <div className="price-head">
          <h1>Реестр единицы</h1>
          <button className="info" type="button" aria-label="Что это за цена" aria-pressed={pinned} onClick={() => setPinned((value) => !value)}>i</button>
          <p className={pinned ? "price-note is-pinned" : "price-note"}>Договорная цена единицы для готовности к КС-2. Это не зарплата и не себестоимость. Новая запись не стирает прежнюю редакцию.</p>
        </div>
        <p className="price-import-note">Таблица: каждая строка «название; цена; начало; окончание». Это проверочный формат, не файл заказчика. Пустая цена не становится нулём.</p>
        {projectId ? (
          <div className="price-import">
            <textarea aria-label="Таблица цен" rows={4} value={table} disabled={importing || checking || !!pendingImport} onChange={(event) => { setTable(event.target.value); setPreview(null); }} />
            {pendingImport ? <p role="status">Таблица ждёт подтверждения. Повтор сохранит исходные строки и номер запроса.</p> : null}
            <button className="desk-action" type="button" disabled={importing || checking || !!pendingImport || tableRows(table).length === 0} onClick={() => void checkTable()}>{checking ? "Проверяем…" : "Проверить"}</button>
            <button className="desk-action" type="button" disabled={importing || checking || (!pendingImport && !preview?.acceptable)} onClick={() => void confirmTable()}>{importing ? "Записываем…" : pendingImport ? "Повторить запись таблицы" : "Записать проверенные"}</button>
            {preview ? <ul ref={previewList} className="price-import-rows" tabIndex={-1} role={preview.acceptable ? "status" : "alert"}>{preview.rows.map((row) => <li key={row.line}>{row.line}. {row.workTypeName || "Пустая строка"} — {row.error ? reasons[row.error] ?? row.error : `${row.price} за ${row.unit}, ${row.start} — ${row.end}`}</li>)}</ul> : null}
          </div>
        ) : null}
        {projects === null ? (!error ? <p className="price-hold">Читаем объекты…</p> : null) : projects.length === 0 ? <p>Нет объектов, к которым вам открыт доступ. Попросите руководителя проекта добавить вас на объект.</p> : (
          <div className="roles" role="tablist" aria-label="Объект">
            {projects.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === projectId} className={item.id === projectId ? "is-on" : ""} disabled={saving || checking || importing} onClick={() => setProjectId(item.id)}>{item.name}</button>)}
          </div>
        )}
      </section>
      {error ? <p className="alert" role="alert">{error} <button className="desk-action" type="button" onClick={() => { setError(""); void (projectId ? loadRegister(projectId) : loadProjects()).catch(() => setError("Не удалось прочитать реестр.")); }}>Повторить чтение</button></p> : null}
      {pending ? <p role="status">Есть запрос без подтверждённого ответа. Повтор отправит исходную редакцию с той же версией.</p> : null}
      {projectId && register === null && !error ? <section className="price-card price-hold">Читаем виды работ…</section> : null}
      {register && register.workTypes.length === 0 ? <section className="price-card"><p>На этом объекте ещё нет видов работ. Цену нельзя ввести, пока руководитель проекта не заведёт вид работ.</p></section> : null}
      {register && work ? (
        <div className="price-board">
          <div className="roles price-kinds" role="tablist" aria-label="Вид работ">
            {register.workTypes.map((item) => <button key={item.id} type="button" role="tab" aria-selected={item.id === work.id} className={item.id === work.id ? "is-on" : ""} disabled={saving || !!pending} onClick={() => setSelected(item.id)}>{item.name}</button>)}
          </div>
          <motion.section key={work.id} className="price-card" initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.28 }}>
            <p className="price-unit">Единица: {work.unit}. Дата компании: {register.asOf}.</p>
            <p className="price-acting">{work.acting ? `Действует редакция ${work.acting.version}: ${work.acting.price} за ${work.acting.unit}, ${work.acting.start} — ${work.acting.end}` : "Действующей цены нет. Это не ноль."}</p>
            <form onSubmit={(event) => void save(event)}>
              <label className="field">Цена единицы<input inputMode="decimal" disabled={saving || !!pending} value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
              <label className="field">Начало<input type="date" disabled={saving || !!pending} value={start} onChange={(event) => setStart(event.target.value)} required /></label>
              <label className="field">Окончание<input type="date" disabled={saving || !!pending} value={end} onChange={(event) => setEnd(event.target.value)} required /></label>
              <button className="desk-action" type="submit" disabled={saving || (!pending && work.status !== "active")}>{saving ? "Записываем…" : pending ? "Повторить запись" : "Записать редакцию"}</button>
            </form>
            <ol className="price-history">
              {work.revisions.length === 0 ? <li>Истории ещё нет. Первая запись станет редакцией 1.</li> : [...work.revisions].reverse().map((item) => (
                <li key={item.version}><b>Версия {item.version}</b><span>{item.price} / {item.unit}</span><span>{item.start} — {item.end}</span></li>
              ))}
            </ol>
          </motion.section>
        </div>
      ) : null}
    </main>
  );
}
