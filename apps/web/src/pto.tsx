import { useState } from "react";
import type { Desk } from "./api";
import { useBook, type ControlMark } from "./book";
import { DeskBadge, DeskEmpty } from "./kit";
import { amount, personName } from "./model";

export function PtoDesk({ data, embedded = false, writeCheck = true, writeCustomer = true }: { data: Desk; embedded?: boolean; writeCheck?: boolean; writeCustomer?: boolean }) {
  const { book, update } = useBook();
  const rows = rowsOf(data);
  const [selected, setSelected] = useState<string | null>(null);
  const current = rows.find((row) => row.taskId === selected) ?? rows[0];

  return (
    <section className={embedded ? "stack" : "page"}>
      {embedded ? <p className="quiet person-note">{writeCheck || writeCustomer ? "Наша проверка — техническая проверка компании. Рядом пишется, что сказал заказчик. Объём принимается на вкладке «Предъявления»." : "Решение ПТО и результат заказчика этому входу не записываются. Сервер не отличает такую запись от решения текущего пользователя."}</p> : (
      <div>
        <h1>Наша проверка</h1>
        <p className="sub">Техническая проверка компании и результат заказчика. Объём принимается отдельно.</p>
      </div>
      )}
      {rows.length === 0 ? (
        <DeskEmpty title="Предъявлений нет" description="Когда рабочий сдаст объём, здесь можно записать нашу проверку и результат заказчика." />
      ) : (
        <div className="sheet-split">
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr><th>Работа</th><th>Кто</th><th>Объём</th><th>Наша проверка</th><th>Заказчик</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.taskId} className={current?.taskId === row.taskId ? "is-link is-on" : "is-link"} tabIndex={0} onClick={() => setSelected(row.taskId)} onKeyDown={(event) => { if (event.key === "Enter") setSelected(row.taskId); }}>
                    <td><b>{row.title}</b></td>
                    <td>{row.who}</td>
                    <td>{amount(row.submitted)} {row.unit}</td>
                    <td><DeskBadge tone={tone(book.pto[row.taskId])}>{markLabel(book.pto[row.taskId])}</DeskBadge></td>
                    <td><DeskBadge tone={tone(book.customer[row.taskId])}>{markLabel(book.customer[row.taskId])}</DeskBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {current ? (
            <div className="stack">
              {writeCheck ? (
                <ControlForm
                  key={`${current.taskId}-pto`}
                  title="Наша проверка"
                  value={book.pto[current.taskId]}
                  onSave={(mark) => update((item) => ({ ...item, pto: { ...item.pto, [current.taskId]: mark } }))}
                />
              ) : null}
              {writeCustomer ? (
                <ControlForm
                  key={`${current.taskId}-customer`}
                  title="Контроль заказчика"
                  value={book.customer[current.taskId]}
                  onSave={(mark) => update((item) => ({ ...item, customer: { ...item.customer, [current.taskId]: mark } }))}
                />
              ) : null}
              <p className="quiet person-note">Запись остаётся в этом браузере. Скана заказчика кабинет не хранит.</p>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function ControlForm({ title, value, onSave }: { title: string; value?: ControlMark; onSave: (mark: ControlMark) => void }) {
  const [result, setResult] = useState<ControlMark["result"]>(value?.result ?? "accepted");
  const [note, setNote] = useState(value?.note ?? "");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <form className="panel" onSubmit={(event) => {
      event.preventDefault();
      if (result === "remark" && !note.trim()) { setError("Напишите, в чём замечание."); setSaved(false); return; }
      onSave({ result, note: note.trim() });
      setError("");
      setSaved(true);
    }}>
      <h2>{title}</h2>
      <label className="field">
        <span>Результат</span>
        <select value={result} onChange={(event) => { setResult(event.target.value as ControlMark["result"]); setSaved(false); }}>
          <option value="accepted">Принято</option>
          <option value="remark">Замечание</option>
        </select>
      </label>
      <label className="field">
        <span>Запись</span>
        <textarea className="note" value={note} onChange={(event) => { setNote(event.target.value); setSaved(false); }} />
      </label>
      {error ? <p role="alert">{error}</p> : null}
      {saved ? <p className="quiet">Записано.</p> : null}
      <button className="fill" type="submit">Записать</button>
    </form>
  );
}

function rowsOf(data: Desk) {
  const seen = new Set<string>();
  const rows: { taskId: string; title: string; who: string; submitted: string; unit: string }[] = [];
  for (const report of data.reports) {
    if (seen.has(report.task_id)) continue;
    const task = data.tasks.find((item) => item.id === report.task_id);
    if (!task) continue;
    seen.add(report.task_id);
    rows.push({
      taskId: task.id,
      title: task.title,
      who: personName(data, task.assignee_employee_id),
      submitted: report.submitted_quantity,
      unit: task.unit,
    });
  }
  return rows;
}

function markLabel(mark?: ControlMark) {
  if (!mark) return "нет записи";
  return mark.result === "accepted" ? "принято" : "замечание";
}

function tone(mark?: ControlMark): "neutral" | "done" | "warn" {
  if (!mark) return "neutral";
  return mark.result === "accepted" ? "done" : "warn";
}
