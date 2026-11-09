import { LayoutGroup, motion } from "motion/react";
import { useRef, useState } from "react";
import type { Desk } from "./api";
import { Dialog } from "./dialog";
import { amount, laneOf, personName, type Lane } from "./model";

const spring = { type: "spring" as const, bounce: 0, visualDuration: 0.26 };

const columns: { id: Lane; title: string; empty: string }[] = [
  { id: "assigned", title: "Назначено", empty: "Новое задание. Перетащите вправо или нажмите карточку." },
  { id: "shift", title: "На смене", empty: "Открытая смена. Дальше — сдать объём." },
  { id: "submitted", title: "Сдано", empty: "Объём ждёт приёмки." },
  { id: "accepted", title: "Принято", empty: "Принятая работа остаётся здесь." },
];

const nextLane: Partial<Record<Lane, Lane>> = {
  assigned: "shift",
  shift: "submitted",
  submitted: "accepted",
};

function isLane(value: string | null): value is Lane {
  return value === "assigned" || value === "shift" || value === "submitted" || value === "accepted";
}

export function WorkBoard({
  data,
  tasks,
  canAccept,
  onStart,
  onSubmit,
  onAccept,
  onCreate,
}: {
  data: Desk;
  tasks: Desk["tasks"];
  canAccept: boolean;
  onStart: (taskId: string, employeeId: string) => void;
  onSubmit: (taskId: string, quantity: string) => void;
  onAccept: (reportId: string) => void;
  onCreate: (title: string, employeeId: string) => Promise<void>;
}) {
  const [over, setOver] = useState<Lane | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [volumeFor, setVolumeFor] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("18");
  const [volumeError, setVolumeError] = useState("");
  const [title, setTitle] = useState("Облицовка стен, зона 3-01");
  const [employeeId, setEmployeeId] = useState(data.employees[0]?.id ?? "");
  const moved = useRef(false);

  function laneAt(x: number, y: number): Lane | null {
    const lane = document.elementFromPoint(x, y)?.closest("[data-lane]")?.getAttribute("data-lane") ?? null;
    return isLane(lane) ? lane : null;
  }

  function move(id: string, from: Lane, to: Lane) {
    if (nextLane[from] !== to) return;
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    if (to === "shift") onStart(task.id, task.assignee_employee_id);
    if (to === "submitted") {
      setQuantity("18");
      setVolumeError("");
      setVolumeFor(task.id);
    }
    if (to === "accepted" && canAccept) {
      const report = data.reports.find((item) => item.task_id === task.id && !item.accepted_quantity);
      if (report) onAccept(report.id);
    }
  }

  const open = tasks.find((task) => task.id === selected);

  return (
    <div className="kanban-wrap">
      <h1 className="sr-only">Задания</h1>
      <form
        className="kanban-bar"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!employeeId) return;
          await onCreate(title, employeeId);
        }}
      >
        <label className="field grow">
          <span>Задание</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="field">
          <span>Исполнитель</span>
          <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            {data.employees.map((person) => (
              <option key={person.id} value={person.id}>{person.full_name}</option>
            ))}
          </select>
        </label>
        <button className="fill" type="submit">Поставить</button>
      </form>
      <LayoutGroup>
        <div className="kanban">
          {columns.map((column) => {
            const items = tasks.filter((task) => laneOf(task.id, data) === column.id);
            return (
              <section className={over === column.id ? "column is-over" : "column"} data-lane={column.id} key={column.id}>
                <header>
                  <h3>{column.title}<span className="sr-only">, {items.length}</span></h3>
                  <span className="count" aria-hidden="true">{items.length}</span>
                </header>
                <div className="drop">
                  {items.length === 0 ? <p className="empty">{column.empty}</p> : null}
                  {items.map((task) => {
                    const report = data.reports.find((item) => item.task_id === task.id);
                    const lane = column.id;
                    const meta = [
                      personName(data, task.assignee_employee_id),
                      `${amount(task.planned_quantity)} ${task.unit}`,
                      report ? `сдано ${amount(report.submitted_quantity)}` : "",
                    ].filter(Boolean).join(" · ");
                    return (
                      <motion.article
                        key={task.id}
                        layout="position"
                        transition={{ layout: spring }}
                        drag
                        dragSnapToOrigin
                        dragElastic={0.12}
                        dragMomentum={false}
                        role="button"
                        aria-label={task.title}
                        aria-keyshortcuts="ArrowRight"
                        className={selected === task.id ? "card is-selected" : "card"}
                        whileDrag={{ scale: 1.03, zIndex: 30 }}
                        tabIndex={0}
                        onDragStart={(event) => {
                          moved.current = false;
                          if (event.currentTarget instanceof HTMLElement) event.currentTarget.style.pointerEvents = "none";
                        }}
                        onDrag={(_, info) => {
                          moved.current = moved.current || Math.hypot(info.offset.x, info.offset.y) > 6;
                          const next = laneAt(info.point.x, info.point.y);
                          setOver((current) => (current === next ? current : next));
                        }}
                        onDragEnd={(event, info) => {
                          const target = laneAt(info.point.x, info.point.y);
                          if (event.currentTarget instanceof HTMLElement) event.currentTarget.style.pointerEvents = "";
                          setOver(null);
                          if (target && target !== lane) move(task.id, lane, target);
                        }}
                        onClick={() => {
                          if (moved.current) return;
                          setSelected(task.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowRight") return;
                          const target = nextLane[lane];
                          if (!target) return;
                          event.preventDefault();
                          move(task.id, lane, target);
                        }}
                      >
                        <div className="meta">{meta}</div>
                        <p className="title">{task.title}</p>
                      </motion.article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </LayoutGroup>
      {open ? (
        <Dialog title={open.title} onClose={() => setSelected(null)}>
          <p className="quiet">{personName(data, open.assignee_employee_id)} · {amount(open.planned_quantity)} {open.unit}</p>
          <div className="rowline">
            {laneOf(open.id, data) === "assigned" ? (
              <button className="fill" type="button" onClick={() => { onStart(open.id, open.assignee_employee_id); setSelected(null); }}>Начать смену</button>
            ) : null}
            {laneOf(open.id, data) === "shift" ? (
              <button className="fill" type="button" onClick={() => { setSelected(null); setQuantity("18"); setVolumeError(""); setVolumeFor(open.id); }}>Сдать объём</button>
            ) : null}
            {laneOf(open.id, data) === "submitted" && canAccept ? (
              <button
                className="fill"
                type="button"
                onClick={() => {
                  const report = data.reports.find((item) => item.task_id === open.id && !item.accepted_quantity);
                  if (report) onAccept(report.id);
                  setSelected(null);
                }}
              >
                Принять 17
              </button>
            ) : null}
            <button className="ghost" type="button" onClick={() => setSelected(null)}>Закрыть</button>
          </div>
        </Dialog>
      ) : null}
      {volumeFor ? (
        <Dialog title="Сколько сделано" onClose={() => setVolumeFor(null)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!quantity.trim()) {
                setVolumeError("Укажите объём.");
                return;
              }
              onSubmit(volumeFor, quantity);
              setVolumeFor(null);
            }}
          >
            <label className="field"><span>Объём</span><input value={quantity} onChange={(event) => { setQuantity(event.target.value); setVolumeError(""); }} inputMode="decimal" aria-invalid={volumeError ? true : undefined} /></label>
            {volumeError ? <p role="alert">{volumeError}</p> : null}
            <button className="fill" type="submit">Сдать</button>
            <button className="ghost" type="button" onClick={() => setVolumeFor(null)}>Закрыть</button>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
