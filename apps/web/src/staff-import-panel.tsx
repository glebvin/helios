import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { NoteMark } from "./note-mark";
import { collectBounded, currentPreview, previewStaffImport, staffImportColumns, staffImportExample, staffImportMaxBytes, type StaffImportPreview } from "./staff-import";

export function StaffImportPanel() {
  const reduce = useReducedMotion();
  const input = useRef<HTMLInputElement>(null);
  const summary = useRef<HTMLDivElement>(null);
  const readToken = useRef(0);
  const [preview, setPreview] = useState<StaffImportPreview | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (preview) summary.current?.focus();
  }, [preview]);

  async function open(file: File | undefined) {
    if (!file) return;
    const token = ++readToken.current;
    setReading(true);
    setPreview(null);
    try {
      if (file.size > staffImportMaxBytes) {
        setPreview({ fileError: "Файл больше 1 МБ. Предпросмотр его не читает.", rows: [], saved: false });
        return;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const next = currentPreview(token, readToken.current, await previewStaffImport(bytes, inflateRaw));
      if (next) setPreview(next);
    } catch {
      if (readToken.current === token) setPreview({ fileError: "Файл не читается как книга Excel.", rows: [], saved: false });
    } finally {
      if (readToken.current === token) setReading(false);
    }
  }

  const problems = preview?.rows.reduce((sum, row) => sum + row.errors.length, 0) ?? 0;
  return (
    <section className="import-preview">
      <div className="import-actions">
        <button className="ghost desk-action" type="button" onClick={() => input.current?.click()}>Проверить файл</button>
        <button className="ghost desk-action" type="button" onClick={downloadExample}>Скачать пример</button>
        <NoteMark label="Состав примера">
          <p>Колонки примера: «{staffImportColumns.join("», «")}». Это синтетический файл. Образец заказчика ещё не подтверждён, поэтому другие колонки не угадываются. Совпадение ФИО дублем не считается.</p>
        </NoteMark>
        <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Файл сотрудников Excel" hidden onChange={(event) => { void open(event.target.files?.[0]); event.target.value = ""; }} />
      </div>
      {reading ? <p className="quiet">Читаем файл на этом устройстве.</p> : null}
      {preview ? (
        <motion.div ref={summary} tabIndex={-1} role="alert" aria-labelledby="import-summary" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.26 }}>
          <h2 id="import-summary">Сотрудники ещё не сохранены</h2>
          <p>Это проверка только этого файла. Совпадения внутри него не означают, что такая запись уже есть в базе.</p>
          {preview.fileError ? <p>{preview.fileError}</p> : <p>{preview.rows.length === 0 ? "В файле нет строк сотрудников." : `Строк в предпросмотре: ${preview.rows.length}. Замечаний: ${problems}.`}</p>}
          <div className="import-rows">
            {preview.rows.map((row) => (
              <article className="panel import-row" id={`import-row-${row.row}`} key={row.row}>
                <b>Строка {row.row}</b>
                <p>{row.fullName || "Имя не прочитано"}</p>
                <p>{row.key ? `Табельный номер ${row.key}` : "Табельный номер не прочитан"}{row.phone ? ` · ${row.phone}` : ""}</p>
                {row.errors.map((error) => <p className={error.includes("не проверка базы") ? "import-warn" : undefined} key={error}>{error}</p>)}
              </article>
            ))}
          </div>
        </motion.div>
      ) : null}
    </section>
  );
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
