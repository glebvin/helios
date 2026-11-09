import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Desk } from "./api";
import { Icon, paths } from "./icons";
import { Dialog } from "./dialog";
import { amount, laneOf, personName, todayKey } from "./model";

type Slice = "today" | "overdue" | "all";
type Kind = "acceptance" | "shift" | "pending";

type Item = {
  id: string;
  kind: Kind;
  title: string;
  place: string;
  who: string;
  date: string;
  note: string;
  reportId?: string;
};

const spring = { type: "spring" as const, bounce: 0, visualDuration: 0.22 };
const fade = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

const slices: { id: Slice; label: string }[] = [
  { id: "today", label: "Сегодня" },
  { id: "overdue", label: "Просрочено" },
  { id: "all", label: "Все" },
];

const kinds: { id: Kind; label: string }[] = [
  { id: "acceptance", label: "Приёмка" },
  { id: "shift", label: "Смена без объёма" },
  { id: "pending", label: "Не начато" },
];

const kindIcon: Record<Kind, string> = {
  acceptance: paths.check,
  shift: paths.alert,
  pending: paths.list,
};

function dayLabel(date: string, today: string) {
  if (date === today) {
    const parsed = new Date(`${date}T12:00:00`);
    return `Сегодня, ${parsed.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`;
  }
  const diff = Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (diff === -1) return "Вчера";
  if (diff === 1) return "Завтра";
  return new Date(`${date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function shortName(name: string) {
  const [first, last] = name.split(" ").filter(Boolean);
  if (!last) return name;
  return `${first.slice(0, 1)}. ${last}`;
}

function itemsOf(data: Desk): Item[] {
  const today = todayKey();
  const place = data.projects[0]?.name ?? "Объект";
  return data.tasks.flatMap((task): Item[] => {
    const lane = laneOf(task.id, data);
    if (lane === "accepted") return [];
    const date = String(task.work_date).slice(0, 10);
    const report = data.reports.find((item) => item.task_id === task.id && !item.accepted_quantity);
    if (lane === "submitted" && report) {
      return [{
        id: task.id,
        kind: "acceptance" as const,
        title: task.title,
        place,
        who: personName(data, task.assignee_employee_id),
        date,
        note: `Ждёт приёмки · сдано ${amount(report.submitted_quantity)} ${task.unit}`,
        reportId: report.id,
      }];
    }
    if (lane === "shift") {
      return [{
        id: task.id,
        kind: "shift" as const,
        title: task.title,
        place,
        who: personName(data, task.assignee_employee_id),
        date,
        note: "Смена открыта, объём ещё не сдан",
      }];
    }
    if (lane === "assigned" && date <= today) {
      return [{
        id: task.id,
        kind: "pending" as const,
        title: task.title,
        place,
        who: personName(data, task.assignee_employee_id),
        date,
        note: "Назначено и не начато",
      }];
    }
    return [];
  });
}

export function Inbox({
  data,
  onAccept,
  onOpenBoard,
}: {
  data: Desk;
  onAccept: (reportId: string) => void;
  onOpenBoard: () => void;
}) {
  const today = todayKey();
  const items = itemsOf(data);
  const [slice, setSlice] = useState<Slice>("today");
  const [enabled, setEnabled] = useState<Kind[]>(["acceptance", "shift", "pending"]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const visible = items.filter((item) => {
    if (!enabled.includes(item.kind)) return false;
    if (slice === "today") return item.date === today;
    if (slice === "overdue") return item.date < today;
    return true;
  });
  const overdue = items.filter((item) => item.date < today).length;
  const dueToday = items.filter((item) => item.date === today).length;
  const deadlines = [...data.tasks]
    .filter((task) => laneOf(task.id, data) !== "accepted")
    .sort((a, b) => {
      const left = String(a.work_date).slice(0, 10);
      const right = String(b.work_date).slice(0, 10);
      const rank = (date: string) => (date < today ? 1 : 0);
      if (rank(left) !== rank(right)) return rank(left) - rank(right);
      return rank(left) === 0 ? left.localeCompare(right) : right.localeCompare(left);
    })
    .slice(0, 5);
  const open = items.find((item) => item.id === openId);

  function toggleKind(kind: Kind) {
    setEnabled((current) => (current.includes(kind) ? current.filter((item) => item !== kind) : [...current, kind]));
  }

  function exportList() {
    const text = visible.map((item) => `${item.title}\t${shortName(item.who)}\t${dayLabel(item.date, today)}\t${item.note}`).join("\n");
    const url = URL.createObjectURL(new Blob([text || "Список пуст"], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "moi-dela.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page inbox-page">
      <div>
        <h1>Мои дела</h1>
        <p className="sub">Решения и вопросы, требующие внимания</p>
      </div>
      <div className="inbox-toolbar">
        <div className="seg" role="tablist" aria-label="Срез дел">
          {slices.map((item) => (
            <button
              key={item.id}
              className={slice === item.id ? "is-on" : ""}
              type="button"
              role="tab"
              aria-selected={slice === item.id}
              onClick={() => setSlice(item.id)}
            >
              {slice === item.id ? <motion.span className="seg-pill" layoutId="inbox-tab" transition={spring} /> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="inbox-stat">
          <Icon d={paths.alert} size={16} />
          <b>{overdue}</b>
          <span>Просрочено</span>
        </div>
        <div className="inbox-stat">
          <Icon d={paths.calendar} size={16} />
          <b>{dueToday}</b>
          <span>На сегодня</span>
        </div>
      </div>
      <p className="sr-only" role="status">
        {slice === "today" ? "Сегодня" : slice === "overdue" ? "Просрочено" : "Все"}: {visible.length}
      </p>
      <div className="inbox">
        <div>
          <AnimatePresence initial={false}>
            {filtersOpen ? (
              <motion.div
                key="kinds"
                className="kind-row"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={fade}
              >
                {kinds.map((kind) => (
                  <button
                    key={kind.id}
                    className={enabled.includes(kind.id) ? "chip is-on" : "chip"}
                    type="button"
                    aria-pressed={enabled.includes(kind.id)}
                    onClick={() => toggleKind(kind.id)}
                  >
                    {kind.label}
                  </button>
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div className="inbox-list">
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((item) => (
                <motion.article
                  key={item.id}
                  className="inbox-row"
                  layout="position"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ ...fade, layout: spring }}
                >
                  <span className="ico"><Icon d={kindIcon[item.kind]} /></span>
                  <div>
                    <b>{item.title}</b>
                    <div className="quiet">{item.place}</div>
                    <div className="chip"><i />{item.note}</div>
                  </div>
                  <div className="inbox-who">
                    <span className="quiet">Ответственный</span>
                    <b>{shortName(item.who)}</b>
                  </div>
                  <div className="inbox-when">
                    <span className="quiet">Срок</span>
                    <b>{dayLabel(item.date, today)}</b>
                  </div>
                  <motion.button className="ghost" type="button" whileTap={{ scale: 0.98 }} onClick={() => setOpenId(item.id)}>
                    Открыть
                  </motion.button>
                </motion.article>
              ))}
            </AnimatePresence>
            {visible.length === 0 ? (
              <div className="inbox-empty">
                <p>{slice === "overdue" ? "Просроченных дел нет." : slice === "today" ? "На сегодня решений нет." : "Открытых дел нет."}</p>
                <button className="ghost" type="button" onClick={onOpenBoard}>К заданиям</button>
              </div>
            ) : null}
          </div>
          <div className="inbox-actions">
            <button className="ghost" type="button" onClick={exportList}><Icon d={paths.down} size={16} />Экспорт списка</button>
            <button className="ghost" type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
              <Icon d={paths.list} size={16} />Фильтры
            </button>
          </div>
        </div>
        <aside className="deadlines">
          <h2>Ближайшие сроки</h2>
          {deadlines.length === 0 ? <p className="quiet">Сроков нет: принятая работа сюда не попадает.</p> : null}
          {deadlines.map((task) => (
            <div className="deadline" key={task.id}>
              <span className="ico"><Icon d={paths.calendar} size={16} /></span>
              <div>
                <b>{dayLabel(String(task.work_date).slice(0, 10), today)}</b>
                <div>{task.title}</div>
                <span className="quiet">{shortName(personName(data, task.assignee_employee_id))} · {data.projects[0]?.name ?? "Объект"}</span>
              </div>
            </div>
          ))}
        </aside>
      </div>
      {open ? (
        <Dialog title={open.title} onClose={() => setOpenId(null)}>
          <p className="quiet">{open.place} · {shortName(open.who)} · {dayLabel(open.date, today)}</p>
          <p>{open.note}</p>
          <div className="rowline">
            {open.reportId ? (
              <button className="fill" type="button" onClick={() => { onAccept(open.reportId!); setOpenId(null); }}>Принять 17</button>
            ) : (
              <button className="fill" type="button" onClick={onOpenBoard}>К заданию</button>
            )}
            <button className="ghost" type="button" onClick={() => setOpenId(null)}>Закрыть</button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
