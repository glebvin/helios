import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Session } from "./api";
import { ApiError, v1 } from "./v1";
import { NoteMark } from "./note-mark";
import { Flash } from "./flash";
import { staffRequest } from "./staff-form";

type Catalog = { employees: { id: string; name: string; organizationId: string; organizationName: string }[]; projects: { id: string; name: string }[]; documentTypes: { code: string; title: string }[] };
type History = { version: number; action: string; createdAt: string };
type Order = { id: string; employeeId: string; employeeName: string; organizationId: string; organizationName: string; projectId: string; projectName: string; documentTypes: string[]; orderNumber: string; orderDate: string; validFrom: string; validUntil: string; status: "active" | "revoked"; revocationReason: string | null; version: number; expiringWithin30Days: boolean; history?: History[] };
type List = { today: string; projectId: string; items: Order[]; catalog: Catalog };
const reasons: Record<string, string> = { active: "Приказ действует на эту дату.", revoked: "Приказ отозван. Отзыв действует сразу.", expired: "Срок приказа истёк.", not_started: "Срок приказа ещё не начался.", type: "Этот тип документа приказом не разрешён.", object: "Приказ выдан на другой объект.", company: "Приказ относится к другой компании.", person: "На этого человека приказа нет." };
const actions: Record<string, string> = { created: "Создан", corrected: "Изменён", revoked: "Отозван" };
function problem(reason: unknown) {
  if (!(reason instanceof ApiError)) return "Нет ответа сервера. Повтор отправит тот же запрос.";
  if (reason.status === 409 && reason.message === "stale_version") return "Приказ уже изменён. Прочитайте текущую версию.";
  if (reason.status === 409 && reason.message === "order_revoked") return "Отозванный приказ не меняется.";
  if (reason.status === 403) return "Реестр доступен службе персонала своей компании и своего объекта.";
  if (reason.status === 422) return "Человек не относится к выбранной компании или уже в архиве.";
  return "Сервер не принял приказ.";
}
export function ResponsibilityOrders({ session, projectId }: { session: Session; projectId: string }) {
  const reduce = useReducedMotion();
  const [list, setList] = useState<List | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Order | null>(null);
  const [filter, setFilter] = useState<"all" | "soon" | "revoked">("all");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pulse, setPulse] = useState(0);
  const [check, setCheck] = useState<{ key: string; text: string } | null>(null);
  const [employeeId, setEmployeeId] = useState("");
  const [types, setTypes] = useState<string[]>(["hidden-works-act"]);
  const [number, setNumber] = useState("");
  const [orderDate, setOrderDate] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [createdUntil, setCreatedUntil] = useState("");
  const [editedUntil, setEditedUntil] = useState("");
  const [reason, setReason] = useState("");
  const [objectId, setObjectId] = useState(projectId);
  const request = useRef({ id: "", key: "" });
  const generation = useRef(0);
  const checkPass = useRef(0);
  const writable = session.role === "hr";
  const currentList = list?.projectId === objectId ? list : null;
  const rows = (currentList?.items ?? []).filter((row) => filter === "all" || (filter === "soon" ? row.expiringWithin30Days : row.status === "revoked"));
  const selected = currentList && detail?.id === selectedId ? detail : rows.find((row) => row.id === selectedId) ?? null;
  useEffect(() => { setEditedUntil(selected?.status === "active" ? selected.validUntil : ""); }, [selected?.id, selected?.version, selected?.validUntil, selected?.status]);
  async function read(nextId = selectedId) {
    const pass = ++generation.current;
    setReading(true); setError("");
    try {
      const next = await v1<List>(session, objectId ? `/responsibility-orders?projectId=${objectId}` : "/responsibility-orders");
      if (pass !== generation.current) return;
      if (!objectId && next.catalog.projects[0]) { setObjectId(next.catalog.projects[0].id); return; }
      setList(next);
      const id = next.items.some((row) => row.id === nextId) ? nextId : next.items[0]?.id ?? "";
      setSelectedId(id);
      const nextDetail = id ? await v1<Order>(session, `/responsibility-orders/${id}`) : null;
      if (pass !== generation.current) return;
      setDetail(nextDetail);
      if (!orderDate) { setOrderDate(next.today); setValidFrom(next.today); }
    } catch (cause) { if (pass === generation.current) setError(problem(cause)); }
    finally { if (pass === generation.current) setReading(false); }
  }
  useEffect(() => { setObjectId(projectId); }, [projectId]);
  useEffect(() => { if (writable) void read(""); return () => { generation.current += 1; }; }, [session.token, objectId, writable]);
  async function send(path: string, body: Record<string, unknown>, key: string) {
    const pending = `helios.orders:${session.tenantId}:${session.userId}:${key}`;
    if (!request.current.id) { try { const saved = JSON.parse(sessionStorage.getItem(pending) ?? "null"); if (typeof saved?.id === "string" && saved.key === key) request.current = saved; } catch { /* новый запрос */ } }
    request.current = staffRequest(request.current, key, () => crypto.randomUUID());
    try { sessionStorage.setItem(pending, JSON.stringify(request.current)); } catch { /* память вкладки сохраняет тот же запрос */ }
    const saved = await v1<Order>(session, path, { requestId: request.current.id, ...body });
    try { sessionStorage.removeItem(pending); } catch { /* повтор без хранилища остаётся в памяти */ }
    request.current = { id: "", key: "" };
    return saved;
  }
  async function create() {
    if (!writable || busy || !currentList) return;
    const employee = currentList.catalog.employees.find((item) => item.id === employeeId);
    if (!employee || !number.trim() || !orderDate || !validFrom || !createdUntil || !types.length) { setError("Укажите человека, номер, даты и хотя бы один тип документа."); return; }
    setBusy(true); setError("");
    const body = { employeeId: employee.id, organizationId: employee.organizationId, projectId: objectId, documentTypes: types, orderNumber: number.trim(), orderDate, validFrom, validUntil: createdUntil };
    try {
      const saved = await send("/responsibility-orders", body, JSON.stringify(body));
      setMessage(`Сервер записал приказ ${saved.orderNumber}.`); setPulse((value) => value + 1); setNumber("");
      await read(saved.id);
    } catch (cause) { setError(problem(cause)); }
    finally { setBusy(false); }
  }
  async function correct() {
    if (!selected || selected.status !== "active" || busy) return;
    if (!editedUntil) { setError("Укажите новый срок."); return; }
    setBusy(true); setError("");
    const body = { expectedVersion: selected.version, documentTypes: selected.documentTypes, orderNumber: selected.orderNumber, orderDate: selected.orderDate, validFrom: selected.validFrom, validUntil: editedUntil };
    try {
      const saved = await send(`/responsibility-orders/${selected.id}`, body, JSON.stringify({ id: selected.id, ...body }));
      setMessage(`Версия ${saved.version} записана.`); setPulse((value) => value + 1); await read(saved.id);
    } catch (cause) { setError(problem(cause)); if (cause instanceof ApiError && cause.status === 409) await read(selected.id); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!selected || busy) return;
    if (!reason.trim()) { setError("Укажите основание отзыва."); return; }
    setBusy(true); setError("");
    const body = { expectedVersion: selected.version, reason: reason.trim() };
    try {
      const saved = await send(`/responsibility-orders/${selected.id}/revoke`, body, JSON.stringify({ id: selected.id, ...body }));
      setMessage("Приказ отозван."); setPulse((value) => value + 1); setReason(""); await read(saved.id);
    } catch (cause) { setError(problem(cause)); }
    finally { setBusy(false); }
  }
  function applicabilityKey(order: Order, day: string) {
    return [session.token, session.tenantId, objectId, order.id, order.version, order.status, day].join(":");
  }
  async function applicability() {
    if (!selected || !list) return;
    const pass = ++checkPass.current;
    const key = applicabilityKey(selected, list.today);
    const path = `/responsibility-orders/applicability?employeeId=${selected.employeeId}&organizationId=${selected.organizationId}&projectId=${selected.projectId}&documentType=${selected.documentTypes[0]}&on=${list.today}`;
    setCheck(null); setError("");
    try {
      const result = await v1<{ applicable: boolean; reason: string }>(session, path);
      if (pass !== checkPass.current) return;
      setCheck({ key, text: reasons[result.reason] ?? "Сервер не подтвердил применимость." });
    } catch (cause) { if (pass === checkPass.current) setError(problem(cause)); }
  }
  if (!writable) return <section className="panel settings-wide" aria-label="Приказы"><h2>Приказы об ответственных</h2><p className="quiet">Просмотр кабинета не записывает приказы. Реестр открывается входом службы персонала.</p></section>;
  return <section className="panel settings-wide orders-screen" aria-label="Приказы об ответственных">
    <div className="documents-title"><h2>Приказы об ответственных</h2><NoteMark label="Что хранит реестр"><p>Запись связывает человека, его компанию и объект, разрешённые типы документов, номер и дату приказа и срок. Повтор той же команды не создаёт вторую запись.</p><p>Истечение в ближайшие 30 дней видно в списке. Письма не отправляются. Доверенности, электронная подпись и отметка П здесь не ставятся.</p></NoteMark></div>
    <p className="quiet">Объект для приказа выбирается здесь. Шапка по-прежнему показывает только назначения уже подключённых ролей.</p>
    <Flash message={message} pulse={pulse} />
    <div className={reading && !currentList ? "orders-layout is-reading" : "orders-layout"}>
      <div className="orders-list">
        <label className="desk-select">Объект<select value={objectId} onChange={(event) => setObjectId(event.target.value)}>{currentList?.catalog.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <div className="roles" role="tablist" aria-label="Состояние приказов">
          {([["all", "Все"], ["soon", "Истекают"], ["revoked", "Отозванные"]] as const).map(([id, label]) => <button key={id} type="button" className={filter === id ? "is-on" : ""} aria-selected={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
        {reading && !currentList ? <p className="quiet">Читаем приказы.</p> : null}
        {!reading && currentList && !rows.length ? <p className="quiet">{filter === "all" ? "По этому объекту приказов ещё нет. Строка появится после ответа сервера." : "В этом состоянии записей нет."}</p> : null}
        {rows.map((row) => <button key={row.id} type="button" className={row.id === selectedId ? "order-row is-on" : "order-row"} onClick={() => { setSelectedId(row.id); void v1<Order>(session, `/responsibility-orders/${row.id}`).then(setDetail).catch((cause) => setError(problem(cause))); }}>
          <b>{row.orderNumber}</b><span>{row.employeeName}</span>{row.expiringWithin30Days ? <small className="orders-warn">Истекает {row.validUntil}</small> : <small>{row.status === "revoked" ? "Отозван" : `до ${row.validUntil}`}</small>}
        </button>)}
        <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label className="desk-select">Человек<select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}><option value="">Выберите</option>{currentList?.catalog.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.organizationName}</option>)}</select></label>
          <label>Номер<input value={number} onChange={(event) => setNumber(event.target.value)} /></label>
          <label>Дата приказа<input type="date" value={orderDate} onChange={(event) => setOrderDate(event.target.value)} /></label>
          <label>Действует с<input type="date" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
          <label>Действует по<input type="date" value={createdUntil} onChange={(event) => setCreatedUntil(event.target.value)} /></label>
          <div className="order-types">{currentList?.catalog.documentTypes.map((type) => <label key={type.code}><input type="checkbox" checked={types.includes(type.code)} onChange={() => setTypes((current) => current.includes(type.code) ? current.filter((item) => item !== type.code) : [...current, type.code])} />{type.title}</label>)}</div>
          <button className="ghost desk-action" type="submit" disabled={busy || !objectId}>Записать приказ</button>
        </form>
      </div>
      <motion.div key={selected?.id ?? "empty"} className="orders-detail" initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={reduce ? { duration: 0 } : { type: "spring", bounce: 0, duration: 0.26 }}>
        {!selected ? <p className="quiet">Выберите приказ. История и срок остаются на этом месте.</p> : <>
          <h3>{selected.orderNumber}</h3>
          <p>{selected.employeeName}</p>
          <p>{selected.organizationName} · {selected.projectName}</p>
          <p>{selected.expiringWithin30Days ? <span className="orders-warn">Истекает в ближайшие 30 дней, {selected.validUntil}. Рассылки нет.</span> : `Срок ${selected.validFrom} — ${selected.validUntil}.`}</p>
          {selected.revocationReason ? <p>Основание отзыва: {selected.revocationReason}</p> : null}
          <ol className="timeline">{(selected.history ?? []).map((item, index, all) => <li key={item.version} className="timeline-item"><span className="timeline-rail"><i hidden={index === all.length - 1} /><b className={index === all.length - 1 ? "is-on" : ""} /></span><span><b>{actions[item.action] ?? item.action}</b><small>Версия {item.version}</small></span><time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time></li>)}</ol>
          <button className="ghost desk-action" type="button" onClick={() => void applicability()}>Проверить срок</button>
          {selected && list && check?.key === applicabilityKey(selected, list.today) ? <p>{check.text}</p> : null}
          {selected.status === "active" ? <form onSubmit={(event) => { event.preventDefault(); void revoke(); }}><label>Новый срок до<input type="date" value={editedUntil} onChange={(event) => setEditedUntil(event.target.value)} /></label><button className="ghost desk-action" type="button" disabled={busy} onClick={() => void correct()}>Сохранить срок</button><label>Основание отзыва<input value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="ghost desk-action" type="submit" disabled={busy}>Отозвать</button></form> : null}
        </>}
      </motion.div>
    </div>
    {error ? <p>{error}</p> : null}
  </section>;
}
