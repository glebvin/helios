import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { DeskSelect } from "./kit";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";
import { collectBounded, currentPreview, previewStaffImport, staffImportColumns, staffImportExample, staffImportMaxBytes, type StaffImportPreview } from "./staff-import";

type Org = { id: string; name: string };
type VerdictRow = { row: number; personnelNumber: string; fullName: string; phone: string; disposition: string; detail: string; employeeId: string | null };
type Verdict = { organizationId: string; fileSha256: string; verdictHash: string; acceptable: boolean; fileError: string; rows: VerdictRow[] };
type SavedRow = { row: number; personnelNumber: string; fullName: string; phone: string; outcome: "created" | "present"; employeeId: string };
type SavedImport = { id: string; actorName: string; createdAt: string; createdCount: number; presentCount: number; rows: SavedRow[] };

export function StaffImportPanel({ session, organizations, onImported }: { session: Session; organizations: Org[]; onImported: () => void }) {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const readToken = useRef(0);
  const historyToken = useRef(0);
  const requestId = useRef("");
  const [employer, setEmployer] = useState(organizations.length === 1 ? organizations[0].id : "");
  const [file, setFile] = useState<Uint8Array | null>(null);
  const [preview, setPreview] = useState<StaffImportPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [pulse, setPulse] = useState(0);
  const [saved, setSaved] = useState<SavedImport | null>(null);

  useEffect(() => {
    const token = ++historyToken.current;
    void v1<{ items: SavedImport[] }>(session, "/staff-imports?limit=1&offset=0")
      .then((page) => { if (historyToken.current === token) setSaved(page.items[0] ?? null); })
      .catch(() => { if (historyToken.current === token) setSaved(null); });
  }, [session]);

  useEffect(() => {
    if (preview) summary.current?.focus();
  }, [preview]);

  async function open(chosen: File | undefined) {
    if (!chosen) return;
    const token = ++readToken.current;
    setReading(true);
    setPreview(null);
    setVerdict(null);
    setFile(null);
    requestId.current = "";
    try {
      if (chosen.size > staffImportMaxBytes) {
        setPreview({ fileError: "Файл больше 1 МБ. Предпросмотр его не читает.", rows: [], saved: false });
        return;
      }
      const bytes = new Uint8Array(await chosen.arrayBuffer());
      const next = currentPreview(token, readToken.current, await previewStaffImport(bytes, inflateRaw));
      if (!next) return;
      setFile(bytes);
      setPreview(next);
    } catch {
      if (readToken.current === token) setPreview({ fileError: "Файл не читается как книга Excel.", rows: [], saved: false });
    } finally {
      if (readToken.current === token) setReading(false);
    }
  }

  async function check() {
    if (!file || !employer) return;
    const token = ++readToken.current;
    setBusy("check");
    setNotice("");
    try {
      const next = await v1<Verdict>(session, "/staff-imports/checks", { organizationId: employer, fileBase64: base64(file) });
      if (readToken.current !== token) return;
      setVerdict(next);
      requestId.current = "";
    } catch (error) {
      if (readToken.current === token) setNotice(importError(error));
    } finally {
      if (readToken.current === token) setBusy("");
    }
  }

  async function confirm() {
    if (!file || !verdict?.acceptable) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    const token = readToken.current;
    setBusy("confirm");
    setNotice("");
    try {
      const result = await v1<SavedImport>(session, "/staff-imports", {
        requestId: requestId.current,
        organizationId: employer,
        fileBase64: base64(file),
        verdictHash: verdict.verdictHash,
      });
      if (readToken.current !== token) return;
      requestId.current = "";
      setSaved(result);
      setVerdict(null);
      setPreview(null);
      setFile(null);
      setPulse((value) => value + 1);
      setNotice("Сотрудники сохранены.");
      onImported();
    } catch (error) {
      if (readToken.current !== token) return;
      if (error instanceof ApiError) requestId.current = "";
      setNotice(importError(error));
    } finally {
      if (readToken.current === token) setBusy("");
    }
  }

  const problems = preview?.rows.reduce((sum, row) => sum + row.errors.length, 0) ?? 0;
  const serverByRow = new Map(verdict?.rows.map((row) => [row.row, row]));
  return (
    <section className="import-preview">
      <Flash message={notice === "Сотрудники сохранены." ? notice : ""} pulse={pulse} />
      <DeskSelect label="Работодатель" value={employer} options={[{ value: "", label: "Выберите работодателя" }, ...organizations.map((item) => ({ value: item.id, label: item.name }))]} onChange={(value) => { setEmployer(value); setVerdict(null); requestId.current = ""; }} />
      <div className="import-actions">
        <button className="ghost desk-action" type="button" onClick={() => input.current?.click()}>Проверить файл</button>
        <button className="ghost desk-action" type="button" onClick={downloadExample}>Скачать пример</button>
        <button className="ghost desk-action" type="button" disabled={!file || !employer || busy !== ""} onClick={() => void check()}>{busy === "check" ? "Проверяем…" : "Проверить на сервере"}</button>
        <NoteMark label="Состав примера">
          <p>Колонки примера: «{staffImportColumns.join("», «")}». Это синтетический файл. Образец заказчика ещё не подтверждён. ФИО не является ключом, табельный номер не записывается в номер документа, существующая карточка не перезаписывается.</p>
        </NoteMark>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Файл сотрудников Excel" hidden onChange={(event) => { void open(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {reading ? <p className="quiet">Читаем файл на этом устройстве.</p> : null}
      {notice && notice !== "Сотрудники сохранены." ? <p role="alert">{notice}</p> : null}
      {saved ? <ImportResult item={saved} /> : null}
      {preview ? (
        <motion.div ref={summary} tabIndex={-1} role="alert" aria-labelledby="import-summary" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.26 }}>
          <h2 id="import-summary">{verdict ? (verdict.acceptable ? "Сервер готов сохранить пакет" : "Сервер пакет не примет") : "Сотрудники ещё не сохранены"}</h2>
          <p>{verdict ? "Проверка сервера сравнивает табельный номер и телефон с карточками выбранного работодателя. Совпадение только по ФИО карточку не находит." : "Это проверка только этого файла. Совпадения внутри него не означают, что такая запись уже есть в базе."}</p>
          {preview.fileError ? <p>{preview.fileError}</p> : <p>{preview.rows.length === 0 ? "В файле нет строк сотрудников." : `Строк в предпросмотре: ${preview.rows.length}. Замечаний в файле: ${problems}.`}</p>}
          {verdict?.fileError ? <p>{verdict.fileError}</p> : null}
          <div className="import-rows">
            {(verdict?.rows.length ? verdict.rows.map((row) => ({ row: row.row, fullName: row.fullName, key: row.personnelNumber, phone: row.phone, errors: [] as string[] })) : preview.rows).map((row) => {
              const server = serverByRow.get(row.row);
              return (
                <article className="panel import-row" id={`import-row-${row.row}`} key={row.row}>
                  <b>Строка {row.row}</b>
                  <p>{row.fullName || "Имя не прочитано"}</p>
                  <p>{row.key ? `Табельный номер ${row.key}` : "Табельный номер не прочитан"}{row.phone ? ` · ${row.phone}` : ""}</p>
                  {row.errors.map((error) => <p className={error.includes("не проверка базы") ? "import-warn" : undefined} key={error}>{error}</p>)}
                  {server ? <p className={server.disposition === "conflict" || server.disposition === "ambiguous" || server.disposition === "foreign" ? "import-warn" : undefined}>{server.detail}</p> : null}
                </article>
              );
            })}
          </div>
          {verdict?.acceptable ? <button className="fill desk-action" type="button" disabled={busy !== ""} onClick={() => void confirm()}>{busy === "confirm" ? "Сохраняем…" : "Подтвердить импорт"}</button> : null}
        </motion.div>
      ) : null}
    </section>
  );
}

function ImportResult({ item }: { item: SavedImport }) {
  const when = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt));
  const skipped = item.rows.filter((row) => row.outcome === "present");
  return (
    <div className="panel import-row">
      <b>Результат импорта</b>
      <p>{item.actorName} · {when}</p>
      <p>Создано карточек: {item.createdCount}. Строк без создания: {item.presentCount}.</p>
      {skipped.map((row) => <p key={row.row}>Строка {row.row}: {row.fullName} уже была в карточках.</p>)}
    </div>
  );
}

function importError(error: unknown) {
  if (!(error instanceof ApiError)) return "Нет ответа сервера. Повторите подтверждение: уже созданные карточки не будут созданы второй раз.";
  if (error.status === 403) return "Этой роли импорт сотрудников недоступен.";
  if (error.status === 409) return "Данные изменились после проверки. Проверьте файл на сервере ещё раз. Ничего не записано.";
  if (error.status === 422) return "Сервер не принял пакет. Карточки из него не сохранены.";
  if (error.status === 400) return "Сервер не принял работодателя или файл.";
  return "Сервер не подтвердил импорт.";
}

function base64(bytes: Uint8Array) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function downloadExample() {
  const bytes = staffImportExample();
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sotrudniki-primer.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

async function inflateRaw(data: Uint8Array, limit: number) {
  const stream = new Blob([Uint8Array.from(data)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  return collectBounded(reader, limit);
}
