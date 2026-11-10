import { useState } from "react";
import type { Desk } from "./api";
import { AcceptDialog } from "./dialog";
import { SelfCheck, checkReady, readCheck, useBook } from "./book";
import { DeskBadge, DeskCrumbs, DeskEmpty, DeskStepper, DeskTimeline, SmoothButton, StatGrid } from "./kit";
import { amount, clock, laneOf, laneTone, permitState, personName, statusLabel, todayKey, type Lane, type Remark } from "./model";

const lanes: Lane[] = ["assigned", "shift", "submitted", "accepted"];

export function TaskList({
  data, tasks, onOpen, laneFor,
}: {
  data: Desk;
  tasks: Desk["tasks"];
  onOpen: (id: string) => void;
  laneFor?: (id: string) => Lane;
}) {
  const laneOfTask = (id: string) => laneFor?.(id) ?? laneOf(id, data);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Lane | "all">("all");
  const needle = query.trim().toLowerCase();
  const visible = tasks.filter((task) => {
    const hay = `${task.title} ${personName(data, task.assignee_employee_id)}`.toLowerCase();
    if (needle && !hay.includes(needle)) return false;
    if (status !== "all" && laneOfTask(task.id) !== status) return false;
    return true;
  });
  const accepted = tasks.filter((task) => laneOfTask(task.id) === "accepted").length;
  const waiting = tasks.filter((task) => laneOfTask(task.id) === "submitted").length;
  const project = data.projects[0]?.name ?? "Объект";
  return (
    <section className="page">
      <div className="passport-head">
        <p className="sub">{dayLabel(todayKey())} · {project}</p>
          <SmoothButton tone="ghost" onClick={() => save(`zadaniya-${todayKey()}.txt`, visible.map((task) => line(data, task, laneOfTask(task.id))))}>Выгрузить список</SmoothButton>
      </div>
      <StatGrid items={[
        { value: String(tasks.length), label: "задания" },
        { value: String(accepted), label: "приняты" },
        { value: String(waiting), label: "ждут приёмки" },
      ]} />
      <div className="object-tools">
        <input className="object-search" type="search" value={query} placeholder="Поиск по заданиям" aria-label="Поиск по заданиям" onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Состояние" value={status} onChange={(event) => setStatus(event.target.value as Lane | "all")}>
          <option value="all">Все состояния</option>
          {lanes.map((lane) => <option key={lane} value={lane}>{statusLabel(lane)}</option>)}
        </select>
      </div>
      {visible.length === 0 ? (
        <DeskEmpty title={tasks.length === 0 ? "На сегодня заданий нет" : "Такого задания нет"} description={tasks.length === 0 ? "Новое задание появится в списке после постановки." : "Проверьте название или снимите фильтр состояния."} />
      ) : (
        <div className="sheet-wrap">
          <table className="sheet">
            <thead>
              <tr><th>Задание</th><th>Исполнитель</th><th>План / факт</th><th>Состояние</th></tr>
            </thead>
            <tbody>
              {visible.map((task) => {
                const lane = laneOfTask(task.id);
                return (
                  <tr className="is-link" key={task.id} tabIndex={0} onClick={() => onOpen(task.id)} onKeyDown={(event) => { if (event.key === "Enter") onOpen(task.id); }}>
                    <td><b>{task.title}</b></td>
                    <td>{personName(data, task.assignee_employee_id)}</td>
                    <td>{fact(task, data.reports.find((item) => item.task_id === task.id))}</td>
                    <td><DeskBadge tone={laneTone(lane)}>{statusLabel(lane)}</DeskBadge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="quiet">Показано {visible.length} из {tasks.length}. Факт исполнителя и принятый объём разделены в карточке. Участок и шифр видны у задания, которое поставили в этом браузере.</p>
    </section>
  );
}

export function TaskCard({
  task, data, canAccept, onBack, onStart, onAskVolume,   onAccept, remarks = [], permitUntil, onResubmit,
}: {
  task: Desk["tasks"][number];
  data: Desk;
  canAccept: boolean;
  onBack: () => void;
  onStart: () => void;
  onAskVolume: () => void;
  onAccept: (acceptedQuantity: string) => void;
  remarks?: Remark[];
  permitUntil?: string;
  onResubmit?: (id: string) => void;
}) {
  const { book, tenantId, userId } = useBook();
  const [accepting, setAccepting] = useState(false);
  const lane = laneOf(task.id, data);
  const report = data.reports.find((item) => item.task_id === task.id);
  const person = data.employees.find((item) => item.id === task.assignee_employee_id);
  const fact = book.tasks[task.id];
  const lot = book.lots.find((item) => item.id === fact?.lotId);
  const ready = checkReady(readCheck(tenantId, userId, task.id));
  const pto = book.pto[task.id];
  const customer = book.customer[task.id];
  const current = lane === "assigned" ? 0 : lane === "shift" ? 1 : lane === "submitted" ? 3 : 5;
  const chain = ["Задание", "Работа", "Самоконтроль", "Проверка", "Заказчик", "Акт"];
  const docsDone = fact?.needsHiddenAct ? Boolean(book.acts[task.id]?.confirmed) : lane === "accepted";
  const done = [current > 0, current > 1, ready, pto?.result === "accepted", customer?.result === "accepted", docsDone];
  return (
    <section className="page">
      <DeskCrumbs items={[{ label: "Задания", onClick: onBack }, { label: task.title }]} />
      <div className="passport-head">
        <div>
          <h1>{task.title}</h1>
          <p className="sub">{dayLabel(task.work_date.slice(0, 10))} · {person?.full_name ?? "Без исполнителя"}</p>
        </div>
        <DeskBadge tone={laneTone(lane)}>{statusLabel(lane)}</DeskBadge>
      </div>
      <DeskStepper current={current} done={done} steps={chain.map((label) => ({ label }))} />
      <p className="quiet">Самоконтроль — три пункта на этой карточке. Наша проверка и результат заказчика записываются в приёмке. Открытое замечание ждёт повторную сдачу.</p>
      <StatGrid items={[
        { value: `${amount(task.planned_quantity)} ${task.unit}`, label: "план" },
        { value: report ? `${amount(report.submitted_quantity)} ${task.unit}` : "—", label: "предъявлено" },
        { value: report?.accepted_quantity ? `${amount(report.accepted_quantity)} ${task.unit}` : "—", label: "принято" },
      ]} />
      <div className="task-grid">
        <section className="panel">
          <h2>Исполнитель</h2>
          <dl className="kv">
            <div><dt>Имя</dt><dd>{person?.full_name ?? "Не назначен"}</dd></div>
            <div><dt>Телефон</dt><dd>{person?.phone || "не указан"}</dd></div>
            <div><dt>Бригада</dt><dd>не заведена</dd></div>
            <div><dt>Участок</dt><dd>{fact?.zone || "не указан"}</dd></div>
            <div><dt>Шифр</dt><dd>{fact?.cipher || "не указан"}</dd></div>
            <div><dt>Листы</dt><dd>{fact?.sheets || "не указаны"}</dd></div>
            <div><dt>Поставка</dt><dd>{lot ? lot.name : "не выбрана"}</dd></div>
          </dl>
        </section>
        <section className="panel">
          <h2>Проверки</h2>
          <dl className="kv">
            <div><dt>Самоконтроль</dt><dd>{ready ? "три пункта отмечены" : "не закрыт"}</dd></div>
            <div><dt>Наша проверка</dt><dd>{pto ? (pto.result === "accepted" ? "принято" : "замечание") : "не записано"}</dd></div>
            <div><dt>СК заказчика</dt><dd>{customer ? (customer.result === "accepted" ? "принято" : "замечание") : "не записан"}</dd></div>
            <div><dt>Допуск</dt><dd>{permitLabel(permitUntil)}</dd></div>
          </dl>
          <SelfCheck key={task.id} taskId={task.id} />
          {remarks.length === 0 ? <p className="quiet person-note">Замечаний к работе нет.</p> : remarks.map((remark) => (
            <div className="person-job" key={remark.id}>
              <div>
                <b>{remark.text}</b>
                <span className="quiet">{personName(data, remark.ownerId)} · до {dayLabel(remark.due)}</span>
              </div>
              {remark.resubmitted ? <DeskBadge>Сдано повторно</DeskBadge> : <button className="ghost" type="button" onClick={() => onResubmit?.(remark.id)}>Повторная сдача</button>}
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>Что дальше</h2>
          <p className="quiet person-note">{nextCopy(lane)}</p>
          <div className="person-note">
            {lane === "assigned" ? <button className="fill" type="button" onClick={onStart}>Начать смену</button> : null}
            {lane === "shift" ? <button className="fill" type="button" onClick={onAskVolume}>Сдать объём</button> : null}
            {lane === "submitted" && canAccept && report ? <button className="fill" type="button" onClick={() => setAccepting(true)}>Принять</button> : null}
          </div>
        </section>
      </div>
      <section className="panel">
        <div className="passport-head">
          <h2>Ход задания</h2>
          <SmoothButton tone="ghost" onClick={() => save(`hod-${task.id.slice(0, 8)}.txt`, story(task, data).map((row) => `${row.when}\t${row.title}\t${row.detail}`))}>Выгрузить ход</SmoothButton>
        </div>
        <DeskTimeline events={story(task, data).map((row) => ({ id: row.id, title: row.title, detail: row.detail, when: row.when }))} />
      </section>
      {accepting && report ? <AcceptDialog submitted={report.submitted_quantity} unit={task.unit} onClose={() => setAccepting(false)} onSubmit={(quantity) => { onAccept(quantity); setAccepting(false); }} /> : null}
    </section>
  );
}

function story(task: Desk["tasks"][number], data: Desk) {
  const report = data.reports.find((item) => item.task_id === task.id);
  const shifts = data.shifts.filter((shift) => shift.task_id === task.id);
  const rows = [
    { id: `${task.id}-day`, title: "Задание на день", detail: task.title, when: dayLabel(task.work_date.slice(0, 10)), sort: task.work_date.slice(0, 10) },
    ...shifts.flatMap((shift) => {
      const start = shift.started_at ?? "";
      const items = [{ id: `${shift.id}-start`, title: "Смена открыта", detail: personName(data, shift.employee_id ?? task.assignee_employee_id), when: whenOf(start), sort: start || task.work_date }];
      if (shift.finished_at) items.push({ id: `${shift.id}-end`, title: "Смена закрыта", detail: "", when: whenOf(shift.finished_at), sort: shift.finished_at });
      return items;
    }),
  ];
  if (report) rows.push({ id: `${report.id}-in`, title: "Объём сдан", detail: `${amount(report.submitted_quantity)} ${task.unit}`, when: "", sort: "9999-12-30" });
  if (report?.accepted_quantity) rows.push({ id: `${report.id}-ok`, title: "Объём принят", detail: `${amount(report.accepted_quantity)} ${task.unit}`, when: "", sort: "9999-12-31" });
  return rows.sort((a, b) => a.sort.localeCompare(b.sort));
}

function fact(task: Desk["tasks"][number], report?: Desk["reports"][number]) {
  const plan = `${amount(task.planned_quantity)} ${task.unit}`;
  if (!report) return `${plan} / —`;
  return `${plan} / ${amount(report.submitted_quantity)} ${task.unit}`;
}

function line(data: Desk, task: Desk["tasks"][number], lane: Lane) {
  return `${task.title}\t${personName(data, task.assignee_employee_id)}\t${fact(task, data.reports.find((item) => item.task_id === task.id))}\t${statusLabel(lane)}`;
}

function permitLabel(until?: string) {
  const state = permitState(until);
  if (state === "ok" && until) return `до ${dayLabel(until)}`;
  if (state === "expired") return "истёк";
  return "не проверен";
}

function nextCopy(lane: Lane) {
  if (lane === "assigned") return "Смена ещё не открыта.";
  if (lane === "shift") return "Объём ещё не сдан.";
  if (lane === "submitted") return "Объём ждёт приёмки.";
  return "Работа принята.";
}

function dayLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function localDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function whenOf(value: string) {
  if (!value) return "";
  const local = clock(value);
  const day = dayLabel(localDay(value));
  return local ? `${day} ${local}` : day;
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
