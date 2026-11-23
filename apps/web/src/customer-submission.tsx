import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { ApiError, v1, v1Collection } from "./v1";
import { useServerRead } from "./server-read";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { customerLine } from "./customer-submission-text";

type FileRow = { fileId: string; filename: string; contentType: string; attemptNumber?: number | null };
type Remark = { id: string; body: string; attemptNumber: number; dueOn: string; closedAt: string | null; photos: FileRow[]; taskId: string };
type Decision = { attemptNumber: number; quantity: string; scanId: string; customerSignerName: string; companySignerName: string };
type Card = { recorded: boolean; attemptNumber: number | null; quantity: string | null; openRemarks: number; remarks: Remark[]; scans: FileRow[]; decision: Decision | null; decisions: Decision[] };
type Person = { id: string; fullName: string };
const ease = [0.23, 1, 0.32, 1] as const;

function explain(error: unknown) {
  if (!(error instanceof ApiError)) return "Нет ответа сервера. Исходная команда ждёт подтверждения.";
  return ({
    self_control_required: "Нужен пройденный самоконтроль задания.",
    internal_inspection_required: "Сначала нужна приёмка нашего ПТО.",
    submission_required: "Сначала запишите внешнюю заявку.",
    remarks_required: "Повтор доступен после замечания и его закрытия.",
    remarks_open: "Пока замечание открыто, принятие и повтор не записываются.",
    scan_required: "Сначала приложите подписанный скан этой попытки.",
    signer_not_authorized: "У подписанта компании нет действующего полномочия на сдачу внешнему СК.",
    already_decided: "Решение по этой попытке уже записано.",
    remark_closed: "Замечание уже закрыто.",
    responsible_not_assigned: "Этот сотрудник не назначен на объект.",
    file_denied: "Файл не совпадает с заявленным типом.",
    invalid_file: "Нужен файл JPEG, PNG или PDF.",
    file_too_large: "Файл больше 8 МиБ.",
    stale_version: "Заявка изменилась в другом окне. Обновите карточку.",
    role_denied: "Этому входу запись внешней заявки недоступна.",
    not_found: "Часть или объект недоступны этому входу.",
  } as Record<string, string>)[error.message] ?? "Сервер не подтвердил действие. Обновите карточку и проверьте результат.";
}

function stored(key: string) {
  try {
    const row = JSON.parse(sessionStorage.getItem(key) ?? "null") as { path?: string; body?: Record<string, unknown> } | null;
    if (row?.path && row.body && typeof row.body.requestId === "string") return { path: row.path, body: row.body };
  } catch { /* Повтор живёт в памяти, если хранилище недоступно. */ }
  return null;
}

async function fileBody(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return { filename: file.name, contentType: file.type, contentBase64: btoa(text) };
}

export function CustomerSubmission({ session, projectId, partId }: { session: Session; projectId: string; partId: string }) {
  const path = `/projects/${projectId}/accepted-parts/${partId}/customer-submission`;
  const key = `helios.customer-submission:${session.tenantId}:${session.userId}:${partId}`;
  const read = useServerRead(session, path, "", () => v1<Card>(session, path), explain);
  const [saved, setSaved] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [body, setBody] = useState(""), [dueOn, setDueOn] = useState(""), [person, setPerson] = useState(""), [people, setPeople] = useState<Person[] | null>(null);
  const [customerSigner, setCustomerSigner] = useState(""), [companySigner, setCompanySigner] = useState("");
  const pending = useRef<{ path: string; body: Record<string, unknown> } | null>(stored(key));
  const reduce = useReducedMotion();
  const master = session.role === "master";
  const card = read.body;
  const held = Boolean(pending.current);

  async function post(command: { path: string; body: Record<string, unknown> }, done: string) {
    if (busy) return;
    pending.current = command;
    try { sessionStorage.setItem(key, JSON.stringify(command)); } catch { /* Большой файл остаётся в памяти этого окна. */ }
    setBusy(true); setError(""); setSaved("");
    try {
      await v1(session, command.path, command.body);
      pending.current = null;
      try { sessionStorage.removeItem(key); } catch { /* Повтор уже не нужен. */ }
      setSaved(done);
      setBody("");
      read.retry();
    } catch (problem) {
      const known = problem instanceof ApiError && problem.status < 500 && problem.status !== 429;
      if (known) { pending.current = null; try { sessionStorage.removeItem(key); } catch { /* Команда уже отвергнута. */ } }
      setError(explain(problem));
    } finally { setBusy(false); }
  }
  function send(target: string, payload: Record<string, unknown>, done: string) {
    if (pending.current) return;
    return post({ path: target, body: { requestId: crypto.randomUUID(), ...payload } }, done);
  }

  async function openPeople() {
    if (people) return;
    const page = await v1Collection<Person>(session, `/employees?projectId=${projectId}`).catch(() => ({ items: [] as Person[], total: 0 }));
    setPeople(page.items);
    setPerson(page.items[0]?.id ?? "");
  }
  const scans = card?.scans.filter((scan) => scan.attemptNumber === card.attemptNumber) ?? [];
  const [selectedScan, setSelectedScan] = useState("");
  const scanId = scans.length === 1 ? scans[0].fileId : scans.find((scan) => scan.fileId === selectedScan)?.fileId;
  const decisionReady = Boolean(master && card?.recorded && !card.decision && card.openRemarks === 0 && scans.length);
  useEffect(() => { if (decisionReady) void openPeople(); }, [decisionReady]);

  return (
    <section className="panel" aria-label="Внешняя заявка">
      <div className="panel-head"><h3>Внешняя заявка</h3><NoteMark label="О внешней заявке"><p>Мастер записывает результат заказчика. Заказчик подписывает бумагу и в систему не входит. Загрузка скана решение не меняет. Пока замечание открыто, принятие и следующая попытка не пишутся.</p></NoteMark></div>
      {saved ? <Flash message={saved} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {pending.current ? <p role="status">Исходная команда ждёт подтверждения. <button className="fill desk-action" type="button" disabled={busy} onClick={() => { const command = pending.current; if (command) void post(command, "Команда подтверждена сервером."); }}>Повторить команду</button></p> : null}
      {read.loading ? <p className="quiet task-hold" role="status">Читаем внешнюю заявку…</p> : null}
      {read.error ? <p role="alert">{read.error}</p> : null}
      {card ? (
        <motion.div initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease }}>
          <p>{customerLine(card)}</p>
          {card.remarks.length === 0 && card.recorded ? <p className="quiet">Замечаний нет.</p> : null}
          {card.remarks.map((remark) => (
            <div key={remark.id}>
              <p>{remark.body}</p>
              <p className="quiet">Срок {remark.dueOn}.{remark.closedAt ? " Закрыто." : " Открыто."} На это замечание есть отдельная задача.</p>
              {remark.photos.length ? <p className="quiet">{remark.photos.map((photo) => photo.filename).join(", ")}</p> : <p className="quiet">Фото к этому замечанию нет.</p>}
              {master && !remark.closedAt ? <button className="ghost desk-action" type="button" disabled={busy || held} onClick={() => void send(`${path}/remarks/${remark.id}/close`, {}, "Замечание закрыто сервером.")}>Закрыть замечание</button> : null}
              {master && !remark.closedAt ? <label className="field"><span>Фото JPEG или PNG</span><input aria-label={`Фото к замечанию ${remark.body}`} type="file" accept="image/jpeg,image/png" disabled={busy || held} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void fileBody(file).then((row) => send(`${path}/remarks/${remark.id}/photos`, row, "Фото записано сервером.")); }} /></label> : null}
            </div>
          ))}
          {card.scans.map((scan) => <p key={scan.fileId} className="quiet">{scan.attemptNumber === null ? "Скан без привязки к попытке" : `Скан попытки ${scan.attemptNumber}`}: {scan.filename}</p>)}
          {card.decisions.filter((item) => item.attemptNumber !== card.attemptNumber).map((item) => <p key={item.attemptNumber} className="quiet">Попытка {item.attemptNumber}: принято внешним СК, количество {item.quantity}, подписант заказчика {item.customerSignerName}, подписант компании {item.companySignerName}.</p>)}
          {master && card.recorded && !card.decision && card.openRemarks === 0 && card.scans.some((scan) => scan.attemptNumber === card.attemptNumber) ? (
            <form onSubmit={(event) => { event.preventDefault(); void send(`${path}/decision`, { expectedAttempt: card.attemptNumber, customerSignerName: customerSigner.trim(), companySignerEmployeeId: companySigner, scanId }, "Принятие внешним СК записано сервером."); }}>
              <label className="field"><span>Подписант заказчика</span><input aria-label="Подписант заказчика" required maxLength={200} disabled={busy || held} value={customerSigner} onChange={(event) => setCustomerSigner(event.target.value)} onFocus={() => void openPeople()} /></label>
              <label className="field"><span>Подписант компании</span><select aria-label="Подписант компании" required disabled={busy || held} value={companySigner} onFocus={() => void openPeople()} onChange={(event) => setCompanySigner(event.target.value)}><option value="">Выберите подписанта</option>{(people ?? []).map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
              {scans.length > 1 ? <label className="field"><span>Скан решения</span><select value={scanId ?? ""} required disabled={busy || held} onChange={(event) => setSelectedScan(event.target.value)}><option value="">Выберите PDF</option>{scans.map((scan) => <option key={scan.fileId} value={scan.fileId}>{scan.filename}</option>)}</select></label> : null}
              <button className="fill desk-action" type="submit" disabled={busy || held || !customerSigner.trim() || !companySigner || !scanId}>Записать принятие внешним СК</button>
            </form>
          ) : null}
          {master && card.recorded && !card.decision && card.openRemarks === 0 && !card.scans.some((scan) => scan.attemptNumber === card.attemptNumber) ? <p className="quiet">Сначала приложите подписанный скан этой попытки. Сам файл решение не записывает.</p> : null}
          {master && !card.recorded ? <button className="fill desk-action" type="button" disabled={busy || held} onClick={() => void send(path, { expectedVersion: 0 }, "Внешняя заявка записана сервером.")}>Записать внешнюю заявку</button> : null}
          {master && card.recorded && !card.decision && card.remarks.some((r) => r.attemptNumber === card.attemptNumber) && card.openRemarks === 0 ? <button className="fill desk-action" type="button" disabled={busy || held} onClick={() => void send(path, { expectedVersion: card.attemptNumber }, "Повтор заявки записан сервером.")}>Повторить заявку</button> : null}
          {master && card.recorded && !card.decision ? (
            <form onSubmit={(event) => { event.preventDefault(); void send(`${path}/remarks`, { body: body.trim(), responsibleEmployeeId: person, dueOn }, "Замечание записано сервером."); }}>
              <label className="field"><span>Замечание</span><textarea aria-label="Замечание" required maxLength={500} disabled={busy || held} value={body} onChange={(event) => setBody(event.target.value)} onFocus={() => void openPeople()} /></label>
              <label className="field"><span>Ответственный</span><select aria-label="Ответственный" required disabled={busy || held || !people?.length} value={person} onFocus={() => void openPeople()} onChange={(event) => setPerson(event.target.value)}>{(people ?? []).map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></label>
              {people && !people.length ? <p className="quiet">На объекте нет сотрудника, которого можно назначить.</p> : null}
              <label className="field"><span>Срок</span><input aria-label="Срок замечания" type="date" required disabled={busy || held} value={dueOn} onChange={(event) => setDueOn(event.target.value)} /></label>
              <button className="fill desk-action" type="submit" disabled={busy || held || !body.trim() || !person || !dueOn}>Добавить замечание</button>
            </form>
          ) : null}
          {master && card.recorded && !card.decision ? <label className="field"><span>Подписанный скан PDF</span><input aria-label="Подписанный скан" type="file" accept="application/pdf" disabled={busy || held} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void fileBody(file).then((row) => send(`${path}/scans`, row, "Скан записан сервером.")); }} /></label> : null}
        </motion.div>
      ) : null}
    </section>
  );
}

export function CustomerZones({ session, projectId }: { session: Session; projectId: string }) {
  const read = useServerRead(session, `${projectId}:zones`, !projectId ? "Выберите объект." : "", () => v1<{ zones: { zoneId: string; name: string; attemptCount: number; openRemarks: number; hasScan: boolean }[] }>(session, `/projects/${projectId}/customer-submission-zones`), explain);
  return (
    <section className="panel" aria-label="Приёмка по зонам">
      <h3>По зонам</h3>
      {read.loading ? <p className="quiet task-hold" role="status">Читаем показатели по зонам…</p> : null}
      {read.error ? <p role="alert">{read.error}</p> : null}
      {read.body && read.body.zones.length === 0 ? <p className="quiet">Зон с внешней заявкой ещё нет. Пустой список не означает, что работу приняли.</p> : null}
      {read.body?.zones.map((zone) => <p key={zone.zoneId}>{zone.name}: попыток {zone.attemptCount}, открытых замечаний {zone.openRemarks}. {zone.hasScan ? "Скан есть." : "Скана нет."}</p>)}
    </section>
  );
}
