import { useState, type ReactNode } from "react";
import type { Desk } from "./api";
import { Icon, paths } from "./icons";
import { DeskBadge, DeskCrumbs, DeskEmpty, FluidTabs, LiquidGauge, SmoothButton } from "./kit";
import { SiteMap, type MapPoint } from "./map";
import { laneOf, personName } from "./model";

type Slice = "active" | "archive";
type Place = { address: string; latitude: number; longitude: number };

export function Objects({ data, canEdit, normsNote = false, onSavePlace, onTasks, lead = null }: { data: Desk; canEdit: boolean; normsNote?: boolean; onSavePlace: (projectId: string, place: Place) => Promise<void>; onTasks: () => void; lead?: ReactNode }) {
  const [query, setQuery] = useState("");
  const [slice, setSlice] = useState<Slice>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const open = data.projects.find((project) => project.id === openId) ?? null;

  if (open) return <Passport lead={lead} project={open} data={data} canEdit={canEdit} normsNote={normsNote} onSavePlace={onSavePlace} onBack={() => setOpenId(null)} onTasks={onTasks} />;

  const needle = query.trim().toLowerCase();
  const active = data.projects.filter((project) => project.name.toLowerCase().includes(needle));
  const shown = slice === "active" ? active : [];

  return (
    <section className="page">
      <div>
        <h1>Объекты</h1>
        <p className="sub">Площадки кабинета. Карточка открывает паспорт объекта.</p>
      </div>
      {lead}
      <div className="object-tools">
        <input
          className="object-search"
          type="search"
          value={query}
          placeholder="Найти объект"
          aria-label="Найти объект"
          onChange={(event) => setQuery(event.target.value)}
        />
        <FluidTabs name="object-tabs" label="Состояние объектов" value={slice} onChange={(id) => setSlice(id as Slice)} tabs={[{ id: "active", label: "Активные" }, { id: "archive", label: "Архив" }]} />
      </div>
      {shown.length === 0 ? (
        <DeskEmpty
          title={slice === "archive" ? "В архиве пусто" : needle ? "Такого объекта нет" : "Объектов пока нет"}
          description={slice === "archive" ? "Сюда попадут площадки, которые снимут с работ." : needle ? "Проверьте название или откройте вкладку «Активные»." : "Площадка появится, когда её заведут в кабинете."}
        />
      ) : (
        <div className="site-grid">
          {shown.map((project) => {
            const accepted = acceptedCount(data);
            return (
              <button className="site-card" type="button" key={project.id} onClick={() => setOpenId(project.id)}>
                <span className="ico"><Icon d={paths.pin} /></span>
                <b>{project.name}</b>
                <small>{place(data)}{project.address.trim() ? ` · ${project.address.trim()}` : ""}</small>
                <DeskBadge tone={working(data) ? "accent" : "neutral"}>{working(data) ? "Работы идут" : "Без открытой смены"}</DeskBadge>
                <span className="site-card-meta">
                  <span><b>{data.employees.length}</b> {word(data.employees.length, "работник", "работника", "работников")}</span>
                  <span><b>{data.tasks.length}</b> {word(data.tasks.length, "задание", "задания", "заданий")}</span>
                  <span><b>{accepted}</b> принято</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Passport({ lead, project, data, canEdit, normsNote, onSavePlace, onBack, onTasks }: { lead: ReactNode; project: Desk["projects"][number]; data: Desk; canEdit: boolean; normsNote: boolean; onSavePlace: (projectId: string, place: Place) => Promise<void>; onBack: () => void; onTasks: () => void }) {
  const saved = pointOf(project.latitude, project.longitude);
  const [view, setView] = useState<"map" | "sheet">("map");
  const [address, setAddress] = useState(project.address);
  const [point, setPoint] = useState<MapPoint | null>(saved);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const dirty = address.trim() !== project.address || !samePoint(point, saved);
  const events = activity(data);
  const lanes = { assigned: 0, shift: 0, submitted: 0, accepted: 0 };
  for (const task of data.tasks) lanes[laneOf(task.id, data)] += 1;
  const onShift = new Set(data.shifts.filter((shift) => shift.status === "open" && shift.employee_id).map((shift) => shift.employee_id)).size;
  const ratio = data.tasks.length ? Math.round((lanes.accepted / data.tasks.length) * 100) : 0;
  const org = place(data);

  async function save() {
    if (!point) return;
    setSaving(true);
    setError("");
    try {
      await onSavePlace(project.id, { address: address.trim(), latitude: point.latitude, longitude: point.longitude });
      setNote("Точка сохранена");
    } catch (reason) {
      setError(placeError(reason instanceof Error ? reason.message : ""));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page">
      {lead}
      <DeskCrumbs items={[{ label: "Объекты", onClick: onBack }, { label: project.name }]} />
      <div className="passport-head">
        <div>
          <h1>{project.name}</h1>
          <p className="sub">{org} · {data.actor.name}</p>
        </div>
        <DeskBadge tone={working(data) ? "accent" : "neutral"}>{working(data) ? "Работы идут" : "Без открытой смены"}</DeskBadge>
      </div>
      <div className="passport">
        <section className="panel scheme">
          <div className="panel-bar">
            <h2>Площадка</h2>
            <FluidTabs name="site-view" label="Вид площадки" value={view} onChange={(id) => setView(id as "map" | "sheet")} tabs={[{ id: "map", label: "Карта" }, { id: "sheet", label: "Схема" }]} />
          </div>
          <label className="field address-line">
            <span>Адрес</span>
            <input value={address} placeholder="Улица и дом" disabled={!canEdit} onChange={(event) => { setAddress(event.target.value); setNote(""); setError(""); }} />
          </label>
          {view === "map" ? (
            <>
              <SiteMap point={point} onPoint={(next) => { if (!canEdit) return; setPoint(next); setNote(""); setError(""); }} />
              <div className="map-actions">
                <p className="quiet">{point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "Нажмите на карту, чтобы поставить точку объекта. Сейчас показана Москва, это не место площадки."}</p>
                {canEdit ? (
                  <button className="fill" type="button" disabled={!point || !dirty || saving} onClick={() => void save()}>
                    {saving ? "Сохраняем" : "Сохранить точку"}
                  </button>
                ) : null}
                {note ? <p className="quiet">{note}</p> : null}
                {error ? <p className="alert">{error}</p> : null}
              </div>
            </>
          ) : <Sheet name={project.name} org={org} />}
        </section>
        <section className="panel passport-facts">
          <h2>Аналитика</h2>
          {normsNote ? <p className="quiet person-note">Нормы трудозатрат пока не реализованы.</p> : null}
          <div className="day-facts">
            <div><b>{data.employees.length}</b><span>{word(data.employees.length, "работник", "работника", "работников")}</span></div>
            <div><b>{onShift}</b><span>на смене</span></div>
            <div><b>{data.tasks.length}</b><span>{word(data.tasks.length, "задание", "задания", "заданий")}</span></div>
            <div><b>{lanes.accepted}</b><span>принято</span></div>
          </div>
          <p className="quiet person-note">Назначено {lanes.assigned} · в работе {lanes.shift} · ждёт {lanes.submitted}</p>
          <div className="readiness">
            <LiquidGauge value={ratio} label="Принято заданий" />
            <p className="quiet">Доля принятых заданий. Готовности ИД в кабинете нет.</p>
          </div>
          <SmoothButton onClick={onTasks}>Задания объекта</SmoothButton>
        </section>
      </div>
      <section className="panel">
        <h2>Последние события</h2>
        {events.length === 0 ? <DeskEmpty title="Событий нет" description="Здесь появятся открытые смены и сданные объёмы." /> : (
          <ul className="plain-events">
            {events.map((event) => (
              <li key={event.id}>
                <span><b>{event.title}</b><small>{event.detail}</small></span>
                <time>{event.when}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Sheet({ name, org }: { name: string; org: string }) {
  return (
    <svg className="drawing" viewBox="0 0 640 360" role="img" aria-label={`Чертёж ${name}`}>
      <rect x="12" y="12" width="616" height="336" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="20" y="20" width="600" height="320" fill="none" stroke="currentColor" />
      <text className="ink" x="36" y="52">{name}</text>
      <text x="36" y="76">Участки не нанесены</text>
      <rect x="372" y="268" width="232" height="60" fill="var(--surface)" stroke="currentColor" />
      <text className="ink" x="384" y="292">{name}</text>
      <text x="384" y="312">{org}</text>
    </svg>
  );
}

function pointOf(latitude: number | null, longitude: number | null): MapPoint | null {
  if (latitude == null || longitude == null) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { latitude: lat, longitude: lng };
}

function samePoint(left: MapPoint | null, right: MapPoint | null) {
  if (!left || !right) return left === right;
  return left.latitude === right.latitude && left.longitude === right.longitude;
}

function placeError(code: string) {
  if (code === "invalid_place") return "Точка или адрес не подходят. Укажите место на карте.";
  if (code === "role_denied") return "Этой роли действие недоступно.";
  if (code === "not_found") return "Объект не найден.";
  if (code === "unauthorized" || code === "tenant_denied") return "Сессия закончилась. Войдите снова.";
  return "Не удалось сохранить точку";
}

function word(value: number, one: string, few: string, many: string) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function acceptedCount(data: Desk) {
  return data.tasks.filter((task) => laneOf(task.id, data) === "accepted").length;
}

function place(data: Desk) {
  const org = data.organizations.map((item) => item.name).filter(Boolean).join(", ");
  return org || data.cabinet.name;
}

function working(data: Desk) {
  return data.shifts.some((shift) => shift.status === "open");
}

function activity(data: Desk) {
  const shifts = data.shifts.flatMap((shift) => {
    if (!shift.started_at) return [];
    const task = data.tasks.find((item) => item.id === shift.task_id);
    return [{
      id: `shift-${shift.id}`,
      at: shift.started_at,
      title: `${short(personName(data, shift.employee_id ?? ""))} открыл смену`,
      detail: task?.title ?? "Задание",
      when: when(shift.started_at),
    }];
  });
  const reports = data.reports.flatMap((report) => {
    const task = data.tasks.find((item) => item.id === report.task_id);
    const accepted = Boolean(report.accepted_quantity);
    return [{
      id: `report-${report.id}`,
      at: task?.work_date ?? "",
      title: accepted ? "Объём принят" : "Объём сдан",
      detail: task?.title ?? "Задание",
      when: task?.work_date ? when(task.work_date) : "",
    }];
  });
  return [...shifts, ...reports].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
}

function short(name: string) {
  const [first, last] = name.split(" ").filter(Boolean);
  if (!last) return name;
  return `${first.slice(0, 1)}. ${last}`;
}

function when(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}
