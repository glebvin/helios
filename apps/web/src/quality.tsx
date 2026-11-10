import { useState } from "react";
import type { Desk } from "./api";
import { AcceptDialog, Dialog } from "./dialog";
import { SelfCheck, checkReady, readCheck, useBook } from "./book";
import { DeskBadge, DeskCrumbs, DeskEmpty, DeskStepper, DeskTimeline, FluidTabs, SmoothButton, StatGrid } from "./kit";
import { amount, personName, todayKey, type Remark } from "./model";
import { PtoDesk } from "./pto";
import type { QualityTab } from "./roles";

const tabLabel: Record<QualityTab, string> = {
  queue: "Предъявления",
  check: "Наша проверка",
  remarks: "Замечания",
  history: "История",
};

export function Quality({
  data, tabs, first, canAccept, writeCheck, writeCustomer, writeRemark, canResubmit, editCheck, onAccept, remarks, onRemark, onResubmit,
}: {
  data: Desk;
  tabs: QualityTab[];
  first: QualityTab;
  canAccept: boolean;
  writeCheck: boolean;
  writeCustomer: boolean;
  writeRemark: boolean;
  canResubmit: boolean;
  editCheck: boolean;
  onAccept: (reportId: string, acceptedQuantity: string) => void;
  remarks: Remark[];
  onRemark: (remark: Remark) => void;
  onResubmit: (id: string) => void;
}) {
  const [tab, setTab] = useState<QualityTab>(tabs.includes(first) ? first : tabs[0] ?? "queue");
  const [openId, setOpenId] = useState<string | null>(null);
  const [writing, setWriting] = useState<string | null>(null);
  const rows = queue(data);
  const open = rows.find((row) => row.id === openId) ?? null;
  const openRemarks = remarks.filter((item) => !item.resubmitted);
  const late = openRemarks.filter((item) => item.due < todayKey()).length;
  if (open) {
    return (
      <>
        <Submission data={data} row={open} remarks={remarks.filter((item) => item.taskId === open.taskId)} canAccept={canAccept} writeRemark={writeRemark} canResubmit={canResubmit} editCheck={editCheck} onBack={() => setOpenId(null)} onAccept={onAccept} onWrite={() => setWriting(open.taskId)} onResubmit={onResubmit} />
        {writing ? <RemarkDialog data={data} taskId={writing} onClose={() => setWriting(null)} onRemark={(item) => { onRemark(item); setWriting(null); }} /> : null}
      </>
    );
  }

  const waiting = rows.filter((row) => !row.accepted);
  const accepted = rows.filter((row) => row.accepted);

  return (
    <section className="page">
      <div>
        <h1>Приёмка</h1>
        <p className="sub">{data.projects[0]?.name ?? "Объект"} · {dayLabel(todayKey())}. Сначала объём, потом наша проверка и результат заказчика.</p>
      </div>
      <FluidTabs
        name="quality-tabs"
        label="Приёмка"
        value={tab}
        onChange={(id) => setTab(id as QualityTab)}
        tabs={tabs.map((id) => ({ id, label: tabLabel[id] }))}
      />
      <StatGrid items={[
        { value: String(waiting.length), label: "ждут проверки" },
        { value: String(openRemarks.length), label: "открытых замечаний", tone: openRemarks.length ? "warn" : undefined },
        { value: String(late), label: "просрочено", tone: late ? "warn" : undefined },
      ]} />
      {tab === "queue" ? (
        <>
          <div className="passport-head">
            <h2>Предъявления на проверку</h2>
            {waiting.length > 0 ? <SmoothButton tone="ghost" onClick={() => save("priemka.txt", waiting.map((row) => `${row.title}\t${row.who}\t${row.submitted} ${row.unit}\tждёт`))}>Выгрузить</SmoothButton> : null}
          </div>
          {waiting.length === 0 ? <DeskEmpty title="На проверке пусто" description="Сданный объём появится здесь. Принятые работы можно открыть ниже." /> : (
            <div className="sheet-wrap">
              <table className="sheet">
                <thead>
                  <tr><th>Работа</th><th>Объём</th><th>Ответственный</th><th>Срок</th><th>Состояние</th></tr>
                </thead>
                <tbody>
                  {waiting.map((row) => (
                    <tr key={row.id} className="is-link" tabIndex={0} onClick={() => setOpenId(row.id)} onKeyDown={(event) => { if (event.key === "Enter") setOpenId(row.id); }}>
                      <td><b>{row.title}</b></td>
                      <td>{amount(row.submitted)} {row.unit}</td>
                      <td>{row.who}</td>
                      <td>{row.when}</td>
                      <td><DeskBadge tone="warn">Ждёт проверки</DeskBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {accepted.length > 0 ? (
            <>
              <div className="passport-head">
                <h2>Уже принято</h2>
              </div>
              <div className="sheet-wrap">
                <table className="sheet">
                  <thead><tr><th>Работа</th><th>Кто</th><th>Объём</th><th>Состояние</th></tr></thead>
                  <tbody>
                    {accepted.map((row) => (
                      <tr key={row.id} className="is-link" tabIndex={0} onClick={() => setOpenId(row.id)} onKeyDown={(event) => { if (event.key === "Enter") setOpenId(row.id); }}>
                        <td><b>{row.title}</b></td>
                        <td>{row.who}</td>
                        <td>{amount(row.acceptedQty ?? "0")} из {amount(row.submitted)} {row.unit}</td>
                        <td><DeskBadge tone="done">Принято</DeskBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {tab === "check" ? <PtoDesk data={data} embedded writeCheck={writeCheck} writeCustomer={writeCustomer} /> : null}
      {tab === "remarks" ? (
        <>
          <div className="passport-head">
            <h2>Замечания</h2>
            <SmoothButton onClick={() => setWriting(data.tasks[0]?.id ?? "")}>Записать замечание</SmoothButton>
          </div>
          {remarks.length === 0 ? <DeskEmpty title="Замечаний нет" description="Текст, срок и ответственный появятся здесь, когда замечание запишут." /> : (
            <div className="sheet-wrap">
              <table className="sheet">
                <thead><tr><th>Замечание</th><th>Работа</th><th>Ответственный</th><th>Срок</th><th>Состояние</th><th></th></tr></thead>
                <tbody>
                  {remarks.map((item) => (
                    <tr key={item.id}>
                      <td><b>{item.text}</b></td>
                      <td>{data.tasks.find((task) => task.id === item.taskId)?.title ?? "Задание"}</td>
                      <td>{personName(data, item.ownerId)}</td>
                      <td>{dayLabel(item.due)}</td>
                      <td><DeskBadge tone={item.resubmitted ? "neutral" : "warn"}>{remarkLabel(item)}</DeskBadge></td>
                      <td>{item.resubmitted ? null : <button className="ghost" type="button" onClick={() => onResubmit(item.id)}>Повторная сдача</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="quiet">Замечание и повторная сдача остаются на этой странице, пока сервер их не хранит.</p>
          {writing !== null ? <RemarkDialog data={data} taskId={writing} onClose={() => setWriting(null)} onRemark={(item) => { onRemark(item); setWriting(null); }} /> : null}
        </>
      ) : null}
      {tab === "history" ? (
        rows.length === 0 ? <DeskEmpty title="История пустая" description="Сданный и принятый объём появятся на линии." /> : <section className="panel"><h2>История</h2><DeskTimeline events={rows.map((row) => ({ id: row.id, title: row.accepted ? "Объём принят" : "Объём сдан", detail: `${row.title} · ${row.who}`, when: row.when }))} /></section>
      ) : null}
    </section>
  );
}

function Submission({
  data, row, remarks, canAccept, writeRemark, canResubmit, editCheck, onBack, onAccept, onWrite, onResubmit,
}: {
  data: Desk;
  row: QueueRow;
  remarks: Remark[];
  canAccept: boolean;
  writeRemark: boolean;
  canResubmit: boolean;
  editCheck: boolean;
  onBack: () => void;
  onAccept: (reportId: string, acceptedQuantity: string) => void;
  onWrite: () => void;
  onResubmit: (id: string) => void;
}) {
  const { book, tenantId, userId } = useBook();
  const [accepting, setAccepting] = useState(false);
  const gap = row.accepted ? Math.max(0, Number(row.submitted) - Number(row.acceptedQty)) : null;
  const openRemarks = remarks.filter((item) => !item.resubmitted);
  const current = openRemarks.length ? 3 : row.accepted ? 2 : 1;
  return (
    <section className="page">
      <DeskCrumbs items={[{ label: "Приёмка", onClick: onBack }, { label: row.title }]} />
      <div className="passport-head">
        <div>
          <h1>{row.title}</h1>
          <p className="sub">{row.who} · {row.when}</p>
        </div>
        <DeskBadge tone={row.accepted ? "done" : "warn"}>{row.accepted ? "Принято" : "Ждёт проверки"}</DeskBadge>
      </div>
      <StatGrid items={[
        { value: `${amount(row.submitted)} ${row.unit}`, label: "предъявлено" },
        { value: row.acceptedQty ? `${amount(row.acceptedQty)} ${row.unit}` : "—", label: "принято" },
        { value: gap === null ? "—" : `${amount(String(gap))} ${row.unit}`, label: "не принято" },
      ]} />
      <div className="sheet-split">
        <section className="panel">
          <h2>Чек-лист</h2>
          <SelfCheck key={row.taskId} taskId={row.taskId} locked={!editCheck} />
        </section>
        <section className="panel">
          <h2>Устранение</h2>
          {remarks.length === 0 ? <p className="quiet person-note">Замечания к этой работе нет.</p> : remarks.map((item) => (
            <div className="person-job" key={item.id}>
              <div>
                <b>{item.text}</b>
                <span className="quiet">{personName(data, item.ownerId)} · до {dayLabel(item.due)}</span>
              </div>
              {item.resubmitted ? <DeskBadge>Сдано повторно</DeskBadge> : canResubmit ? <button className="ghost" type="button" onClick={() => onResubmit(item.id)}>Повторная сдача</button> : <DeskBadge tone="warn">Открыто</DeskBadge>}
            </div>
          ))}
          <div className="person-note">
            {writeRemark ? <SmoothButton onClick={onWrite}>Замечание</SmoothButton> : null}
            {!row.accepted && canAccept ? <SmoothButton onClick={() => setAccepting(true)}>Принять</SmoothButton> : null}
          </div>
        </section>
      </div>
      <DeskStepper
        current={current}
        done={[checkReady(readCheck(tenantId, userId, row.taskId)), book.pto[row.taskId]?.result === "accepted", book.customer[row.taskId]?.result === "accepted", remarks.length > 0 && openRemarks.length === 0]}
        steps={[{ label: "Самоконтроль" }, { label: "Наша проверка" }, { label: "Заказчик" }, { label: "Замечание" }]}
      />
      <p className="quiet">Три пункта самоконтроля отмечаются здесь. Наша проверка и результат заказчика — на вкладке «Наша проверка». Повторная сдача закрывает замечание на этой странице.</p>
      {accepting ? <AcceptDialog submitted={row.submitted} unit={row.unit} onClose={() => setAccepting(false)} onSubmit={(quantity) => { onAccept(row.id, quantity); setAccepting(false); }} /> : null}
    </section>
  );
}

type QueueRow = {
  id: string;
  taskId: string;
  title: string;
  who: string;
  submitted: string;
  acceptedQty: string | null;
  accepted: boolean;
  unit: string;
  when: string;
};

function queue(data: Desk): QueueRow[] {
  return data.reports.flatMap((report) => {
    const task = data.tasks.find((item) => item.id === report.task_id);
    if (!task) return [];
    return [{
      id: report.id,
      taskId: task.id,
      title: task.title,
      who: personName(data, task.assignee_employee_id),
      submitted: report.submitted_quantity,
      acceptedQty: report.accepted_quantity,
      accepted: Boolean(report.accepted_quantity),
      unit: task.unit,
      when: dayLabel(task.work_date.slice(0, 10)),
    }];
  });
}

function RemarkDialog({ data, taskId, onClose, onRemark }: { data: Desk; taskId: string; onClose: () => void; onRemark: (remark: Remark) => void }) {
  const [task, setTask] = useState(taskId && data.tasks.some((item) => item.id === taskId) ? taskId : data.tasks[0]?.id ?? "");
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [ownerId, setOwnerId] = useState(data.employees[0]?.id ?? "");
  const [error, setError] = useState("");
  return (
    <Dialog title="Замечание" onClose={onClose}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!task) { setError("Нет задания, к которому можно привязать замечание."); return; }
        if (!text.trim()) { setError("Напишите, что исправить."); return; }
        if (!due) { setError("Укажите срок."); return; }
        if (!ownerId) { setError("Выберите ответственного."); return; }
        onRemark({ id: crypto.randomUUID(), taskId: task, text: text.trim(), due, ownerId, resubmitted: false });
      }}>
        <label className="field"><span>Работа</span>
          <select value={task} onChange={(event) => { setTask(event.target.value); setError(""); }}>
            {data.tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
          </select>
        </label>
        <label className="field"><span>Что исправить</span><input value={text} onChange={(event) => { setText(event.target.value); setError(""); }} /></label>
        <label className="field"><span>Срок</span><input type="date" value={due} onChange={(event) => { setDue(event.target.value); setError(""); }} /></label>
        <label className="field"><span>Ответственный</span>
          <select value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setError(""); }}>
            {data.employees.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}
          </select>
        </label>
        <p className="quiet form-note">Повторная сдача появится в списке, когда объём по этому замечанию сдадут снова.</p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="fill" type="submit">Записать</button>
        <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
      </form>
    </Dialog>
  );
}

function remarkLabel(item: Remark) {
  if (item.resubmitted) return "Сдано повторно";
  if (item.due < todayKey()) return "Просрочено";
  return "Открыто";
}

function dayLabel(value: string) {
  if (value === todayKey()) return "сегодня";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function save(name: string, lines: string[]) {
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
