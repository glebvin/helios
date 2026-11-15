import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { DeskEmpty, DeskTimeline } from "./kit";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { ApiError, moscowDay, v1 } from "./v1";
import { durationLabel } from "./worker-day";

type Facts = { sourceHash: string; presenceMs: string; idleMs: string; workMs: string; breakMs: string; downtimeMs: string; shifts: { shiftId: string; mode: string; ms: string; open: boolean }[] };
type Employee = { employeeId: string; fullName: string; live: Facts | null; snapshot: Facts | null };
type Revision = { revision: number; previousRevision: number | null; issuedAt: string; issuedByName: string; correctionId: string | null };
type Correction = { id: string; reason: string; acceptedRevision: number | null };
type PrimaryDay = {
  organizationId: string;
  organizationName: string;
  day: string;
  timezone: string;
  closeVersion: number;
  closedAt: string | null;
  closedByName: string | null;
  liveHash: string;
  snapshotHash: string | null;
  diverged: boolean;
  employees: Employee[];
  revision: number;
  revisions: Revision[];
  correction: Correction | null;
};

const modes: Record<string, string> = { idle: "Ожидание", work: "Работа", break: "Перерыв", downtime: "Простой" };

export function PrimaryDay({ session, projectId, organizations }: { session: Session; projectId: string; organizations: { id: string; name: string }[] }) {
  const reduce = useReducedMotion();
  const [day, setDay] = useState(moscowDay());
  const [organizationId, setOrganizationId] = useState(organizations[0]?.id ?? "");
  const [pass, setPass] = useState(0);
  const [reading, setReading] = useState<{ scope: string; day: PrimaryDay | null; error: string } | null>(null);
  const [picked, setPicked] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [pulse, setPulse] = useState(0);
  const scope = JSON.stringify([session.token, session.tenantId, projectId, day, session.role === "hr" ? organizationId : "", pass]);
  const sameDay = reading?.day?.day === day && (session.role !== "hr" || reading.day.organizationId === organizationId);
  const page = reading?.scope === scope ? reading.day : sameDay ? reading.day : null;
  const error = reading?.scope === scope ? reading.error : "";
  const loading = Boolean(projectId && !page && reading?.scope !== scope);
  useEffect(() => { setPicked(""); }, [projectId, day, organizationId]);
  useEffect(() => {
    if (!projectId || (session.role === "hr" && !organizationId)) return;
    let live = true;
    const query = session.role === "hr" ? `?organizationId=${organizationId}` : "";
    void v1<PrimaryDay>(session, `/projects/${projectId}/time/primary-days/${day}${query}`).then((body) => {
      if (live) setReading({ scope, day: body, error: "" });
    }, (cause: unknown) => {
      if (live) setReading({ scope, day: null, error: cause instanceof ApiError ? message(cause.message) : "Не удалось прочитать день." });
    });
    return () => { live = false; };
  }, [scope, projectId, day, organizationId, session]);
  const selected = page?.employees.find((item) => item.employeeId === picked) ?? page?.employees[0] ?? null;
  const facts = selected?.live ?? selected?.snapshot ?? null;
  const waiting = page?.correction && page.correction.acceptedRevision === null;
  return <section className="panel" aria-label="Первичный день">
    <div className="panel-bar">
      <h2>Первичный день <NoteMark label="Как закрывается день"><p>Мастер закрывает факт своего работодателя. Снимок, автор и время остаются. Служба персонала выпускает свод. Поздний факт показывает расхождение и идёт отдельной корректировкой, не правкой старого свода.</p></NoteMark></h2>
      <div className="panel-tools">
        <label className="field"><span>День</span><input aria-label="День" type="date" value={day} onChange={(event) => setDay(event.target.value)} /></label>
        {session.role === "hr" ? <label className="field"><span>Работодатель</span><select aria-label="Работодатель" value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
      </div>
    </div>
    {error ? <p role="alert">{error} <button className="ghost desk-action" type="button" onClick={() => setPass((value) => value + 1)}>Повторить чтение</button></p> : null}
    {loading && !page ? <p className="quiet task-hold" role="status">Читаем день…</p> : null}
    {page && page.employees.length === 0 ? <DeskEmpty title="Записанного времени нет" description="В этот день сервер не отдал смен, работы, перерывов и простоев этого работодателя." /> : null}
    {page && page.employees.length > 0 ? <motion.div key={scope} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.26 }}>
      <p className="quiet">{page.organizationName} · {page.timezone}{page.closedAt ? ` · закрыл ${page.closedByName} ${stamp(page.closedAt)}` : " · день ещё не закрыт"}</p>
      {page.diverged ? <p className="alert" role="status">После закрытия пришёл ещё один факт. Снимок и выпущенный свод не изменились. Дальше — корректировка.</p> : null}
      <div className="panel-tools">
        {session.role === "master" && page.closeVersion === 0 ? <button className="fill desk-action" type="button" disabled={busy} onClick={() => void send("close", page)}>Закрыть первичный день</button> : null}
        {session.role === "hr" && page.closeVersion === 1 && page.revision === 0 ? <button className="fill desk-action" type="button" disabled={busy} onClick={() => void send("issue", page)}>Выпустить свод</button> : null}
        {session.role === "hr" && waiting ? <button className="fill desk-action" type="button" disabled={busy} onClick={() => void send("next", page)}>Выпустить следующую ревизию</button> : null}
      </div>
      <div className="sheet-split">
        <div className="sheet-wrap">
          <table className="sheet">
            <thead><tr><th>Сотрудник</th><th>Смена</th><th>Работа</th><th>Перерыв</th><th>Простой</th></tr></thead>
            <tbody>
              {page.employees.map((item) => {
                const row = item.live ?? item.snapshot;
                return <tr key={item.employeeId} className={selected?.employeeId === item.employeeId ? "is-link is-on" : "is-link"} tabIndex={0} onClick={() => setPicked(item.employeeId)} onKeyDown={(event) => { if (event.key === "Enter") setPicked(item.employeeId); }}>
                  <td><b>{item.fullName}</b></td>
                  <td>{row ? durationLabel(row.presenceMs) : "—"}</td>
                  <td>{row ? durationLabel(row.workMs) : "—"}</td>
                  <td>{row ? durationLabel(row.breakMs) : "—"}</td>
                  <td>{row ? durationLabel(row.downtimeMs) : "—"}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div>
          {facts ? <ul>{facts.shifts.map((shift) => <li key={`${shift.shiftId}:${shift.mode}:${shift.ms}`}>{modes[shift.mode] ?? shift.mode} · {durationLabel(shift.ms)}{shift.open ? " · интервал открыт" : ""}</li>)}</ul> : null}
          {session.role === "master" && page.revision > 0 && !waiting ? <label className="field"><span>Причина корректировки</span><textarea aria-label="Причина корректировки" value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} /></label> : null}
          {session.role === "master" && page.revision > 0 && !waiting ? <button className="fill desk-action" type="button" disabled={busy || !reason.trim()} onClick={() => void send("correct", page)}>Подготовить корректировку</button> : null}
          {page.correction ? <p className="quiet">Корректировка: {page.correction.reason}{page.correction.acceptedRevision ? ` · в своде ${page.correction.acceptedRevision}` : " · ждёт свод"}</p> : null}
          {page.revisions.length ? <DeskTimeline events={page.revisions.map((item) => ({ id: String(item.revision), title: `Свод ${item.revision}`, detail: item.correctionId ? `${item.issuedByName} принял корректировку` : `${item.issuedByName} выпустил по первичному закрытию`, when: stamp(item.issuedAt) }))} /> : <p className="quiet">Свод ещё не выпущен.</p>}
        </div>
      </div>
    </motion.div> : null}
    <Flash message={saved} pulse={pulse} />
  </section>;

  async function send(action: "close" | "correct" | "issue" | "next", body: PrimaryDay) {
    setBusy(true);
    setSaved("");
    try {
      const requestId = crypto.randomUUID();
      if (action === "close") await v1(session, `/projects/${projectId}/time/primary-days/${day}/close`, { requestId, expectedCloseVersion: body.closeVersion, organizationId: body.organizationId, sourceHash: body.liveHash });
      if (action === "correct") await v1(session, `/projects/${projectId}/time/primary-days/${day}/corrections`, { requestId, organizationId: body.organizationId, reason: reason.trim(), expectedCorrectionVersion: body.correction ? 1 : 0 });
      if (action === "issue" || action === "next") await v1(session, `/projects/${projectId}/time/consolidated/${day}/revisions`, { requestId, expectedRevision: body.revision, ...(action === "next" && body.correction ? { correctionId: body.correction.id } : {}) });
      setReason("");
      setSaved(action === "close" ? "Первичный день закрыт." : action === "correct" ? "Корректировка подготовлена." : "Свод выпущен.");
      setPulse((value) => value + 1);
      setPass((value) => value + 1);
    } catch (cause) {
      setSaved("");
      setReading({ scope, day: body, error: cause instanceof ApiError ? message(cause.message) : "Команда не выполнена." });
    } finally {
      setBusy(false);
    }
  }
}

function stamp(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(value));
}
function message(code: string) {
  if (code === "stale_version") return "Версия уже другая. Решение не повторяю.";
  if (code === "stale_source") return "Факт дня уже другой. Закрытие не повторяю.";
  if (code === "correction_open") return "Уже есть корректировка, которую свод ещё не принял.";
  if (code === "revision_required") return "Сначала нужен выпущенный свод.";
  if (code === "primary_close_required") return "Нет закрытого первичного дня.";
  if (code === "employer_denied") return "Этот работодатель вне области входа.";
  if (code === "role_denied") return "Этому входу это действие не разрешено.";
  if (code === "open_intervals") return "Есть незакрытый интервал. День пока не закрывается.";
  if (code === "future_day") return "Этот день ещё не наступил.";
  if (code === "recorded_time_required") return "Записанного времени нет.";
  return "Сервер не принял команду.";
}
