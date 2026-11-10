import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Desk } from "./api";
import { useBook } from "./book";
import { Icon, paths } from "./icons";
import { AcceptForm, Dialog } from "./dialog";
import { DeskBadge, FluidTabs } from "./kit";
import { amount, laneOf, personName, todayKey, type Remark } from "./model";

type Slice = "today" | "overdue" | "all";
type Kind = "acceptance" | "shift" | "pending";

type Item = {
  id: string;
  kind: Kind;
  title: string;
  document: string;
  place: string;
  who: string;
  date: string;
  note: string;
  action: string;
  reportId?: string;
  submitted?: string;
  unit?: string;
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

function rowTone(item: Item): "neutral" | "accent" | "warn" | "done" {
  if (item.action === "Принять" || item.action === "К приёмке") return "warn";
  if (item.action === "Закрыть день") return "done";
  if (item.kind === "shift" || item.action === "К акту") return "accent";
  return "neutral";
}

function statusText(item: Item) {
  if (item.action === "Принять") return "Сдано";
  if (item.action === "Закрыть день") return "Смены есть";
  if (item.kind === "shift") return "Смена открыта";
  if (item.document === "Замечание") return "Замечание";
  if (item.document === "АОСР") return "Черновик";
  return "Не начато";
}

function actionClass(tone: "neutral" | "accent" | "warn" | "done") {
  if (tone === "warn") return "fill is-warn";
  if (tone === "done") return "fill is-done";
  if (tone === "accent") return "fill";
  return "ghost";
}

function actionAllowed(item: Item, access: { canAccept: boolean; canApprove: boolean; canOpenBoard: boolean; canOpenQuality: boolean; canOpenDocuments: boolean }) {
  if (item.action === "Принять") return access.canAccept;
  if (item.action === "Закрыть день") return access.canApprove;
  if (item.action === "К приёмке") return access.canOpenQuality;
  if (item.action === "К акту") return access.canOpenDocuments;
  return access.canOpenBoard;
}

function shortName(name: string) {
  const [first, last] = name.split(" ").filter(Boolean);
  if (!last) return name;
  return `${first.slice(0, 1)}. ${last}`;
}

function itemsOf(data: Desk, remarks: Remark[]): Item[] {
  const today = todayKey();
  const place = data.projects[0]?.name ?? "Объект";
  const rows = data.tasks.flatMap((task): Item[] => {
    const lane = laneOf(task.id, data);
    if (lane === "accepted") return [];
    const date = String(task.work_date).slice(0, 10);
    const report = data.reports.find((item) => item.task_id === task.id && !item.accepted_quantity);
    if (lane === "submitted" && report) {
      return [{
        id: task.id,
        kind: "acceptance" as const,
        title: task.title,
        document: "Приёмка",
        place,
        who: data.actor.name,
        date,
        note: `Сдано ${amount(report.submitted_quantity)} ${task.unit} · ${personName(data, task.assignee_employee_id)}`,
        action: "Принять",
        reportId: report.id,
        submitted: report.submitted_quantity,
        unit: task.unit,
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
        document: "Задание",
        note: "Смена открыта, объём ещё не сдан",
        action: "К заданию",
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
        document: "Задание",
        note: "Назначено и не начато",
        action: "К заданию",
      }];
    }
    return [];
  });
  const extra: Item[] = [
    ...remarks.filter((item) => !item.resubmitted).map((item) => ({
      id: item.id,
      kind: "pending" as const,
      title: item.text,
      document: "Замечание",
      place,
      who: personName(data, item.ownerId),
      date: item.due,
      note: "Ждёт повторной сдачи",
      action: "К приёмке",
    })),
  ];
  return [...rows, ...extra];
}

function dayKey(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function routeItems(items: Item[], data: Desk, book: ReturnType<typeof useBook>["book"]): Item[] {
  const today = todayKey();
  const place = data.projects[0]?.name ?? "Объект";
  const acts = Object.entries(book.acts).flatMap(([taskId, act]) => {
    if (act.sent) return [];
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return [];
    return [{
      id: `act-${taskId}`,
      kind: "pending" as const,
      title: task.title,
      document: "АОСР",
      place,
      who: data.actor.name,
      date: today,
      note: act.confirmed ? "Черновик подтверждён, ждёт передачи" : "Черновик ждёт подтверждения",
      action: "К акту",
    }];
  });
  const day = data.shifts.some((shift) => dayKey(shift.started_at) === today) && !book.closedDays.includes(today)
    ? [{
      id: `day-${today}`,
      kind: "pending" as const,
      title: "Закрытие дня",
      document: "День",
      place,
      who: data.actor.name,
      date: today,
      note: "Смены есть. Это не утверждение табеля.",
      action: "Закрыть день",
    }]
    : [];
  return [...items, ...acts, ...day];
}

export function Inbox({
  data,
  remarks,
  canAccept,
  canApprove,
  canOpenBoard,
  canOpenQuality,
  canOpenDocuments,
  onAccept,
  onOpenBoard,
  onOpenQuality,
  onOpenDocuments,
}: {
  data: Desk;
  remarks: Remark[];
  canAccept: boolean;
  canApprove: boolean;
  canOpenBoard: boolean;
  canOpenQuality: boolean;
  canOpenDocuments: boolean;
  onAccept: (reportId: string, acceptedQuantity: string) => void;
  onOpenBoard: () => void;
  onOpenQuality: () => void;
  onOpenDocuments: () => void;
}) {
  const { book, update } = useBook();
  const today = todayKey();
  const items = routeItems(itemsOf(data, remarks), data, book);
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

  function run(item: Item) {
    if (item.action === "Закрыть день") {
      update((current) => current.closedDays.includes(item.date) ? current : { ...current, closedDays: [...current.closedDays, item.date] });
      return;
    }
    if (item.action === "К приёмке") { onOpenQuality(); return; }
    if (item.action === "К акту") { onOpenDocuments(); return; }
    if (item.reportId) { setOpenId(item.id); return; }
    onOpenBoard();
  }

  function exportList() {
    const text = visible.map((item) => `${item.document}\t${item.title}\t${shortName(item.who)}\t${dayLabel(item.date, today)}\t${item.action}`).join("\n");
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
        <FluidTabs name="inbox-tabs" label="Срез дел" value={slice} onChange={(id) => setSlice(id as Slice)} tabs={slices} />
        <div className="inbox-stat is-warn">
          <span className="ico is-warn"><Icon d={paths.alert} size={16} /></span>
          <b>{overdue}</b>
          <span>Просрочено</span>
        </div>
        <div className="inbox-stat is-accent">
          <span className="ico is-accent"><Icon d={paths.calendar} size={16} /></span>
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
            {visible.length > 0 ? (
              <div className="inbox-head">
                <span />
                <span>Дело</span>
                <span>Ответственный</span>
                <span>Срок</span>
                <span />
              </div>
            ) : null}
            <AnimatePresence initial={false} mode="popLayout">
              {visible.map((item) => {
                const tone = rowTone(item);
                return (
                  <motion.article
                    key={item.id}
                    className={tone === "neutral" ? "inbox-row" : `inbox-row is-${tone}`}
                    layout="position"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ ...fade, layout: spring }}
                  >
                    <span className={tone === "neutral" ? "ico" : `ico is-${tone}`}><Icon d={kindIcon[item.kind]} /></span>
                    <div>
                      <b>{item.title}</b>
                      <div className="quiet">{item.document} · {item.place}</div>
                      <DeskBadge tone={tone}>{statusText(item)}</DeskBadge>
                    </div>
                    <div className="inbox-who">
                      <span className="quiet inbox-label">Ответственный</span>
                      <b>{shortName(item.who)}</b>
                    </div>
                    <div className="inbox-when">
                      <span className="quiet inbox-label">Срок</span>
                      <b>{dayLabel(item.date, today)}</b>
                    </div>
                    {actionAllowed(item, { canAccept, canApprove, canOpenBoard, canOpenQuality, canOpenDocuments }) ? (
                      <motion.button className={actionClass(tone)} type="button" whileTap={{ scale: 0.98 }} onClick={() => run(item)}>
                        {item.action}
                      </motion.button>
                    ) : <span />}
                  </motion.article>
                );
              })}
            </AnimatePresence>
            {visible.length === 0 ? (
              <div className="inbox-empty">
                <p>{slice === "overdue" ? "Просроченных дел нет." : slice === "today" ? "На сегодня решений нет." : "Открытых дел нет."}</p>
                {canOpenBoard ? <button className="ghost" type="button" onClick={onOpenBoard}>К заданиям</button> : null}
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
          {deadlines.map((task) => {
            const late = String(task.work_date).slice(0, 10) < today;
            return (
            <div className="deadline" key={task.id}>
              <span className={late ? "ico is-warn" : "ico is-accent"}><Icon d={paths.calendar} size={16} /></span>
              <div>
                <b>{dayLabel(String(task.work_date).slice(0, 10), today)}</b>
                <div>{task.title}</div>
                <span className="quiet">{shortName(personName(data, task.assignee_employee_id))} · {data.projects[0]?.name ?? "Объект"}</span>
              </div>
            </div>
            );
          })}
        </aside>
      </div>
      {open ? (
        <Dialog title={open.title} onClose={() => setOpenId(null)}>
          <p className="quiet">{open.place} · {shortName(open.who)} · {dayLabel(open.date, today)}</p>
          <p>{open.note}</p>
          {open.reportId && open.submitted && open.unit ? (
            <AcceptForm submitted={open.submitted} unit={open.unit} onSubmit={(quantity) => { onAccept(open.reportId!, quantity); setOpenId(null); }} />
          ) : (
            <button className="fill" type="button" onClick={() => run(open)}>{open.action}</button>
          )}
          <button className="ghost" type="button" onClick={() => setOpenId(null)}>Закрыть</button>
        </Dialog>
      ) : null}
    </section>
  );
}
