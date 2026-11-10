import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Desk, NewTask } from "./api";
import { AcceptDialog, Dialog } from "./dialog";
import { blockedZone, useBook } from "./book";
import { amount, laneOf, permitState, personName, todayKey, type Admission, type Lane, type Remark } from "./model";
import { FluidTabs, SmoothButton } from "./kit";
import { TaskCard, TaskList } from "./tasks";

const columns: { id: Lane; title: string; empty: string }[] = [
  { id: "assigned", title: "Назначено", empty: "Новое задание. Карточку можно перенести в любой статус." },
  { id: "shift", title: "На смене", empty: "Открытая смена." },
  { id: "submitted", title: "Сдано", empty: "Объём ждёт приёмки." },
  { id: "accepted", title: "Принято", empty: "Принятая работа." },
];

const order: Lane[] = ["assigned", "shift", "submitted", "accepted"];

function isLane(value: string | null): value is Lane {
  return value === "assigned" || value === "shift" || value === "submitted" || value === "accepted";
}

export function WorkBoard({
  data,
  tasks,
  canAccept,
  canCreate,
  onStart,
  onEnd,
  onSubmit,
  onAccept,
  onCreate,
  openTask = null,
  admissions = [],
  remarks = [],
  onResubmit,
}: {
  data: Desk;
  tasks: Desk["tasks"];
  canAccept: boolean;
  canCreate: boolean;
  onStart: (taskId: string, employeeId: string) => void;
  onEnd: (taskId: string) => void;
  onSubmit: (taskId: string, quantity: string) => void;
  onAccept: (reportId: string, acceptedQuantity: string) => void;
  onCreate: (input: NewTask) => Promise<string>;
  openTask?: { id: string; token: number } | null;
  admissions?: Admission[];
  remarks?: Remark[];
  onResubmit?: (id: string) => void;
}) {
  const [view, setView] = useState<"board" | "list">("board");
  const [selected, setSelected] = useState<string | null>(null);
  const [volumeFor, setVolumeFor] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [volumeError, setVolumeError] = useState("");
  const [acceptFor, setAcceptFor] = useState<{ id: string; submitted: string; unit: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [placed, setPlaced] = useState<Partial<Record<string, Lane>>>({});
  const board = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const pending = useRef<string | null>(null);

  function laneFor(id: string): Lane {
    return placed[id] ?? laneOf(id, data);
  }

  useEffect(() => {
    setPlaced((current) => {
      let changed = false;
      const next = { ...current };
      for (const [id, lane] of Object.entries(next)) {
        if (lane && laneOf(id, data) === lane) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [data]);

  useEffect(() => {
    if (openTask) setSelected(openTask.id);
  }, [openTask]);

  function laneNodes() {
    return [...(board.current?.querySelectorAll<HTMLElement>("[data-lane]") ?? [])];
  }

  function laneAt(x: number, y: number): Lane | null {
    const hit = laneNodes().find((column) => {
      const box = column.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    });
    const lane = hit?.dataset.lane ?? null;
    return isLane(lane) ? lane : null;
  }

  function paint(lane: Lane | null) {
    for (const column of laneNodes()) column.classList.toggle("is-over", column.dataset.lane === lane);
  }

  function place(id: string, from: Lane, to: Lane) {
    if (from === to) return;
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    setPlaced((current) => ({ ...current, [id]: to }));
    const openShift = data.shifts.some((shift) => shift.task_id === id && shift.status === "open");
    const report = data.reports.find((item) => item.task_id === id && !item.accepted_quantity);
    if (to === "shift" && !openShift) onStart(task.id, task.assignee_employee_id);
    if (to === "assigned" && openShift) onEnd(task.id);
    if (to === "submitted" && !data.reports.some((item) => item.task_id === id)) {
      pending.current = id;
      setQuantity("");
      setVolumeError("");
      setVolumeFor(id);
    }
    if (to === "accepted" && report && canAccept) setAcceptFor({ id: report.id, submitted: report.submitted_quantity, unit: task.unit });
  }

  function cancelVolume() {
    const id = pending.current;
    pending.current = null;
    setVolumeFor(null);
    if (!id) return;
    setPlaced((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const open = tasks.find((task) => task.id === selected);

  if (open) {
    return (
      <div className="kanban-wrap">
        <TaskCard
          task={open}
          data={data}
          canAccept={canAccept}
          onBack={() => setSelected(null)}
          onStart={() => onStart(open.id, open.assignee_employee_id)}
          onAskVolume={() => { setQuantity(""); setVolumeError(""); setVolumeFor(open.id); }}
          onAccept={(acceptedQuantity) => {
            const report = data.reports.find((item) => item.task_id === open.id && !item.accepted_quantity);
            if (report) onAccept(report.id, acceptedQuantity);
          }}
          remarks={remarks.filter((item) => item.taskId === open.id)}
          permitUntil={admissions.find((item) => item.employeeId === open.assignee_employee_id)?.until}
          onResubmit={onResubmit}
        />
        {volumeFor ? <VolumeDialog quantity={quantity} error={volumeError} onQuantity={(value) => { setQuantity(value); setVolumeError(""); }} onClose={() => setVolumeFor(null)} onSubmit={() => {
          if (!quantity.trim()) { setVolumeError("Укажите объём."); return; }
          onSubmit(volumeFor, quantity);
          setVolumeFor(null);
        }} /> : null}
      </div>
    );
  }

  return (
    <div className="kanban-wrap">
      <div className="tasks-head">
        <h1>Задания</h1>
        <div className="rowline">
          <FluidTabs name="task-view" label="Вид заданий" value={view} onChange={(id) => setView(id as "board" | "list")} tabs={[{ id: "board", label: "Доска" }, { id: "list", label: "Список" }]} />
          {canCreate ? <SmoothButton onClick={() => setCreating(true)}>Создать задание</SmoothButton> : null}
        </div>
      </div>
      {view === "list" ? <TaskList data={data} tasks={tasks} onOpen={setSelected} laneFor={laneFor} /> : (
        <div className="kanban" ref={board}>
          {columns.map((column) => {
            const items = tasks.filter((task) => laneFor(task.id) === column.id);
            return (
              <section className="column" data-lane={column.id} key={column.id}>
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
                      <article
                        key={task.id}
                        role="button"
                        aria-label={task.title}
                        aria-keyshortcuts="ArrowLeft ArrowRight"
                        className="card"
                        tabIndex={0}
                        onPointerDown={(event) => {
                          if (event.button !== 0) return;
                          const node = event.currentTarget;
                          const startX = event.clientX;
                          const startY = event.clientY;
                          let dragging = false;
                          moved.current = false;
                          node.setPointerCapture(event.pointerId);
                          const onMove = (ev: PointerEvent) => {
                            const dx = ev.clientX - startX;
                            const dy = ev.clientY - startY;
                            if (!dragging && Math.hypot(dx, dy) > 6) {
                              dragging = true;
                              moved.current = true;
                              node.classList.add("is-dragging");
                              board.current?.classList.add("is-dragging");
                              node.closest(".column")?.classList.add("is-source");
                            }
                            if (!dragging) return;
                            node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
                            const next = laneAt(ev.clientX, ev.clientY);
                            paint(next && next !== lane ? next : null);
                          };
                          const onUp = (ev: PointerEvent) => {
                            node.removeEventListener("pointermove", onMove);
                            node.removeEventListener("pointerup", onUp);
                            const target = laneAt(ev.clientX, ev.clientY);
                            node.style.transform = "";
                            node.classList.remove("is-dragging");
                            node.closest(".column")?.classList.remove("is-source");
                            board.current?.classList.remove("is-dragging");
                            paint(null);
                            if (dragging && target && target !== lane) place(task.id, lane, target);
                          };
                          node.addEventListener("pointermove", onMove);
                          node.addEventListener("pointerup", onUp);
                        }}
                        onClick={() => {
                          if (moved.current) return;
                          setSelected(task.id);
                        }}
                        onKeyDown={(event) => {
                          const index = order.indexOf(lane);
                          const target = event.key === "ArrowRight" ? order[index + 1] : event.key === "ArrowLeft" ? order[index - 1] : null;
                          if (!target) return;
                          event.preventDefault();
                          place(task.id, lane, target);
                        }}
                      >
                        <div className="meta">{meta}</div>
                        <p className="title">{task.title}</p>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {creating ? <CreateDialog people={data.employees} organizations={data.organizations} projects={data.projects} admissions={admissions} onClose={() => setCreating(false)} onCreate={onCreate} /> : null}
      {acceptFor ? <AcceptDialog submitted={acceptFor.submitted} unit={acceptFor.unit} onClose={() => {
        const reportId = acceptFor.id;
        setAcceptFor(null);
        const taskId = data.reports.find((item) => item.id === reportId)?.task_id;
        if (!taskId) return;
        setPlaced((current) => {
          if (!(taskId in current)) return current;
          const next = { ...current };
          delete next[taskId];
          return next;
        });
      }} onSubmit={(acceptedQuantity) => { onAccept(acceptFor.id, acceptedQuantity); setAcceptFor(null); }} /> : null}
      {volumeFor ? <VolumeDialog quantity={quantity} error={volumeError} onQuantity={(value) => { setQuantity(value); setVolumeError(""); }} onClose={cancelVolume} onSubmit={() => {
        if (!quantity.trim()) { setVolumeError("Укажите объём."); return; }
        onSubmit(volumeFor, quantity);
        pending.current = null;
        setVolumeFor(null);
      }} /> : null}
    </div>
  );
}

const units = ["м²", "м", "м³", "шт"];

function permitNote(until?: string) {
  const state = permitState(until);
  if (state === "ok" && until) {
    const [year, month, day] = until.split("-").map(Number);
    const label = new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    return `Допуск действует до ${label}. Назначение можно поставить.`;
  }
  if (state === "expired") return "Допуск истёк. Назначение остановлено.";
  return "Допуск не проверен. Назначение остановлено.";
}

function CreateDialog({
  people, organizations, projects, admissions, onClose, onCreate,
}: {
  people: Desk["employees"];
  organizations: Desk["organizations"];
  projects: Desk["projects"];
  admissions: Admission[];
  onClose: () => void;
  onCreate: (input: NewTask) => Promise<string>;
}) {
  const [title, setTitle] = useState("");
  const [zone, setZone] = useState("");
  const [workDate, setWorkDate] = useState(todayKey());
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [employeeId, setEmployeeId] = useState("");
  const [crewId, setCrewId] = useState("");
  const [needsHiddenAct, setNeedsHiddenAct] = useState(false);
  const [drawingCipher, setDrawingCipher] = useState("");
  const [drawingSheets, setDrawingSheets] = useState("");
  const [lotId, setLotId] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const { book, update } = useBook();
  const acceptedLots = book.lots.filter((item) => item.result === "accepted");
  return (
    <Dialog title="Новое задание" onClose={onClose}>
      <form onSubmit={async (event) => {
        event.preventDefault();
        const planned = quantity.trim().replace(",", ".");
        if (!organizationId) { setError("Выберите организацию."); return; }
        if (!projectId) { setError("Выберите объект."); return; }
        if (!zone.trim()) { setError("Укажите участок."); return; }
        if (!title.trim()) { setError("Напишите вид работ."); return; }
        if (!workDate) { setError("Укажите день."); return; }
        if (!(Number(planned) > 0)) { setError("Укажите объём больше нуля."); return; }
        if (!unit) { setError("Выберите единицу."); return; }
        if (!employeeId) { setError("Выберите исполнителя из подсказок."); return; }
        const gate = permitState(admissions.find((item) => item.employeeId === employeeId)?.until);
        if (gate === "none") { setError("Допуск не проверен. Назначение остановлено."); return; }
        if (gate === "expired") { setError("Допуск истёк. Назначение остановлено."); return; }
        if (needsHiddenAct && !drawingCipher.trim()) { setError("Укажите шифр чертежа."); return; }
        if (needsHiddenAct && !drawingSheets.trim()) { setError("Укажите листы."); return; }
        const held = blockedZone(book, zone);
        if (held) { setError(`На участке «${held}» скрытые работы ждут подтверждённый акт. Следующее задание не ставится.`); return; }
        if (book.lots.some((item) => item.id === lotId && item.result === "rejected")) { setError("Отклонённую поставку выбрать нельзя."); return; }
        setPending(true);
        try {
          const id = await onCreate({
            title: title.trim(),
            organizationId,
            projectId,
            zone: zone.trim(),
            employeeId,
            crewId,
            plannedQuantity: planned,
            unit,
            workDate,
            needsHiddenAct,
            drawingCipher: drawingCipher.trim(),
            drawingSheets: drawingSheets.trim(),
            lotId,
          });
          update((current) => ({
            ...current,
            tasks: {
              ...current.tasks,
              [id]: {
                zone: zone.trim(),
                cipher: drawingCipher.trim(),
                sheets: drawingSheets.trim(),
                needsHiddenAct,
                lotId,
              },
            },
          }));
          onClose();
        } finally {
          setPending(false);
        }
      }}>
        <Suggest label="Организация" placeholder="Название организации" listId="org-suggestions" items={organizations.map((item) => ({ id: item.id, title: item.name }))} empty="Организаций в кабинете нет." value={organizationId} onChange={(id) => { setOrganizationId(id); setError(""); }} />
        <Suggest label="Объект" placeholder="Название объекта" listId="project-suggestions" items={projects.map((item) => ({ id: item.id, title: item.name }))} empty="Объектов в кабинете нет." value={projectId} onChange={(id) => { setProjectId(id); setError(""); }} />
        <label className="field"><span>Участок</span><input value={zone} onChange={(event) => { setZone(event.target.value); setError(""); }} /></label>
        <label className="field"><span>Вид работ</span><input value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} /></label>
        <label className="field"><span>День</span><input type="date" value={workDate} onChange={(event) => { setWorkDate(event.target.value); setError(""); }} /></label>
        <div className="pair-fields">
          <label className="field"><span>Объём</span><input value={quantity} inputMode="decimal" onChange={(event) => { setQuantity(event.target.value); setError(""); }} /></label>
          <label className="field"><span>Единица</span>
            <select value={unit} onChange={(event) => { setUnit(event.target.value); setError(""); }}>
              <option value="">Выберите</option>
              {units.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <Suggest
          label="Исполнитель"
          placeholder="Имя, телефон или документ"
          listId="person-suggestions"
          items={people.map((person) => ({ id: person.id, title: person.full_name, hint: [person.phone, person.document_number].filter(Boolean).join(" · "), search: `${person.full_name} ${person.phone} ${person.document_number ?? ""}` }))}
          empty="В кабинете такого человека нет."
          value={employeeId}
          onChange={(id) => { setEmployeeId(id); setError(""); }}
        />
        {employeeId ? <p className="quiet form-note">{permitNote(admissions.find((item) => item.employeeId === employeeId)?.until)}</p> : null}
        <Suggest label="Бригада" placeholder="Название бригады" listId="crew-suggestions" items={[]} empty="Бригад в кабинете нет." value={crewId} onChange={setCrewId} />
        <label className="check"><input type="checkbox" checked={needsHiddenAct} onChange={(event) => { setNeedsHiddenAct(event.target.checked); setError(""); }} />Нужен акт скрытых работ</label>
        {needsHiddenAct ? (
          <div className="pair-fields">
            <label className="field"><span>Шифр</span><input value={drawingCipher} onChange={(event) => { setDrawingCipher(event.target.value); setError(""); }} /></label>
            <label className="field"><span>Листы</span><input value={drawingSheets} onChange={(event) => { setDrawingSheets(event.target.value); setError(""); }} /></label>
          </div>
        ) : null}
        <Suggest label="Поставка" placeholder="Что приехало или номер" listId="lot-suggestions" items={acceptedLots.map((item) => ({ id: item.id, title: item.name, hint: item.batch }))} empty="Принятых поставок нет. Отклонённую выбрать нельзя." value={lotId} onChange={setLotId} />
        <div className="field">
          <span>Готовность фронта</span>
          <p className="quiet form-note">Пунктов в кабинете нет. Незакрытый пункт остановит постановку, когда чек-лист появится.</p>
        </div>
        <p className="quiet form-note">Если на участке нужны скрытые работы, следующее задание ждёт подписанный акт.</p>
        <p className="quiet form-note">Сервер сохраняет вид работ, день, объём и исполнителя. Участок, шифр, листы и поставка остаются на карточке в этом браузере.</p>
        {error ? <p role="alert">{error}</p> : null}
        <button className="fill" type="submit" disabled={pending}>Поставить</button>
        <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
      </form>
    </Dialog>
  );
}

function Suggest({
  label, placeholder, listId, items, empty, value, onChange,
}: {
  label: string;
  placeholder: string;
  listId: string;
  items: { id: string; title: string; hint?: string; search?: string }[];
  empty: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const chosen = items.find((item) => item.id === value);
  const [query, setQuery] = useState(chosen?.title ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const shown = items.filter((item) => {
    if (!needle) return true;
    const card = `${item.title} ${item.hint ?? ""} ${item.search ?? ""}`.toLowerCase();
    if (card.includes(needle)) return true;
    return Boolean(digits) && (item.search ?? item.hint ?? "").replace(/\D/g, "").includes(digits);
  });
  const current = shown[Math.min(active, Math.max(shown.length - 1, 0))];

  function choose(item: { id: string; title: string }) {
    setQuery(item.title);
    onChange(item.id);
    setOpen(false);
  }

  return (
    <div className="field suggest">
      <span>{label}</span>
      <input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && current ? `${listId}-${current.id}` : undefined}
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          onChange("");
          setActive(0);
          setOpen(true);
        }}
        onPointerDown={() => setOpen(true)}
        onFocus={(event) => { if (event.currentTarget.matches(":focus-visible")) setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) { setOpen(true); return; }
          if (!open) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, Math.max(shown.length - 1, 0))); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
          if (event.key === "Enter") { event.preventDefault(); if (current) choose(current); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        }}
      />
      <AnimatePresence>
        {open ? (
          <motion.ul
            id={listId}
            role="listbox"
            className="suggest-list"
            initial={reduce ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: 6 }}
            transition={{ duration: reduce ? 0 : 0.16 }}
          >
            {shown.length === 0 ? <li className="quiet">{empty}</li> : null}
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  id={`${listId}-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={item.id === current?.id}
                  className={item.id === current?.id ? "is-on" : ""}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item)}
                >
                  <b>{item.title}</b>
                  {item.hint ? <small>{item.hint}</small> : null}
                </button>
              </li>
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function VolumeDialog({ quantity, error, onQuantity, onClose, onSubmit }: { quantity: string; error: string; onQuantity: (value: string) => void; onClose: () => void; onSubmit: () => void }) {
  return (
    <Dialog title="Сколько сделано" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <label className="field"><span>Объём</span><input value={quantity} onChange={(event) => onQuantity(event.target.value)} inputMode="decimal" aria-invalid={error ? true : undefined} /></label>
        {error ? <p role="alert">{error}</p> : null}
        <button className="fill" type="submit">Сдать</button>
        <button className="ghost" type="button" onClick={onClose}>Закрыть</button>
      </form>
    </Dialog>
  );
}
