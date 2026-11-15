import { templateCommand, confirmedTemplateCommand } from "./template-command";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { checklistPage, checklistPageCount, type ChecklistItem, type ChecklistKind } from "@helios/domain";
import type { Session } from "./api";
import { Flash } from "./flash";
import { NoteMark } from "./note-mark";
import { ApiError, v1 } from "./v1";

type Item = ChecklistItem;
type Status = "draft" | "pending_responsible" | "in_review" | "pending_approval" | "approved" | "returned";
type Action = "save" | "submit" | "accept" | "review" | "approve" | "return" | "revise";
type Card = { templateId: string; edition: number; title: string; status: Status; version: number; applicableEdition: number | null; waiting: boolean };
type HistoryEvent = { version: number; action: Action; fromStatus: string; toStatus: string; actorRole: string; actorName: string; reason: string | null; createdAt: string };
type Detail = Card & {
  items: Item[];
  history: HistoryEvent[];
  allowedActions: Action[];
  applicable: { edition: number; title: string; version: number } | null;
  editions: { edition: number; status: Status; version: number; title: string }[];
};
type List = { today: string; projectId: string | null; projects: { id: string; name: string }[]; items: Card[] };

const kinds: { id: ChecklistKind; label: string }[] = [
  { id: "yes_no", label: "Да или нет" },
  { id: "number", label: "Число" },
  { id: "photo", label: "Фото" },
  { id: "document", label: "Документ" },
  { id: "batch", label: "Партия" },
];
const steps: { id: Status; label: string }[] = [
  { id: "draft", label: "Черновик" },
  { id: "pending_responsible", label: "Ответственный" },
  { id: "in_review", label: "Согласование" },
  { id: "pending_approval", label: "Утверждение" },
  { id: "approved", label: "Утверждён" },
];
const actionLabel: Record<Action, string> = {
  save: "Сохранить черновик",
  submit: "Отправить по маршруту",
  accept: "Принять ответственность",
  review: "Согласовать",
  approve: "Утвердить",
  return: "Вернуть",
  revise: "Новая редакция",
};
const statusLabel: Record<Status, string> = {
  draft: "Черновик", pending_responsible: "У ответственного", in_review: "На согласовании",
  pending_approval: "На утверждении", approved: "Утверждён", returned: "Возвращён",
};

function freshItem(items: Item[]): Item {
  let number = items.length + 1;
  while (items.some((item) => item.id === `item-${number}`)) number += 1;
  return { id: `item-${number}`, prompt: "", kind: "yes_no", pass: "yes", required: true, critical: false };
}

function forServer(item: Item) {
  const base = { id: item.id.trim(), prompt: item.prompt.trim(), kind: item.kind, required: item.required, critical: item.critical };
  if (item.kind === "yes_no") return { ...base, pass: item.pass === "no" ? "no" : "yes" };
  if (item.kind === "number") {
    const number: Item = { ...base, unit: item.unit?.trim() ?? "" };
    if (item.min?.trim()) number.min = item.min.trim();
    if (item.max?.trim()) number.max = item.max.trim();
    return number;
  }
  return base;
}

function problem(title: string, items: Item[]) {
  if (!title.trim()) return "Укажите название шаблона.";
  if (!items.length) return "Добавьте хотя бы один пункт.";
  if (items.some((item) => !item.prompt.trim())) return "Заполните формулировку каждого пункта.";
  if (items.some((item) => item.kind === "number" && !item.unit?.trim())) return "У числа укажите единицу.";
  return "";
}

function explain(reason: unknown) {
  const code = reason instanceof ApiError ? reason.message : "";
  if (code === "stale_version") return "Шаблон уже изменён. Прочитайте текущую версию.";
  if (code === "reviews_required") return "Нельзя утвердить, пока оба согласования не записаны.";
  if (code === "review_recorded") return "Это согласование уже записано.";
  if (code === "role_denied") return "Это действие вашей роли не разрешено.";
  if (code === "reason_required") return "Укажите причину возврата.";
  if (code === "invalid_template") return "Проверьте пункты: тип, допуск и обязательные поля.";
  if (code === "route_not_configured") return "Маршрут шаблона на объекте не назначен.";
  if (code === "edition_open") return "Сначала завершите открытую редакцию.";
  if (reason instanceof ApiError) return "Сервер не записал это действие.";
  return "Нет ответа сервера.";
}

export function ChecklistTemplates({ session, projectId }: { session: Session; projectId: string }) {
  const reduce = useReducedMotion();
  const generation = useRef(0);
  const [list, setList] = useState<List | null>(null);
  const [selected, setSelected] = useState("");
  const [edition, setEdition] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("Шаблон сдачи");
  const [items, setItems] = useState<Item[]>([{ id: "item-1", prompt: "", kind: "yes_no", pass: "yes", required: true, critical: true }]);
  const [page, setPage] = useState(0);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [pulse, setPulse] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(true);
  const project = projectId || list?.projectId || "";

  function note(message: string) {
    setFlash(message);
    setPulse((value) => value + 1);
  }

  async function loadList(token: number) {
    const query = projectId ? `?projectId=${projectId}` : "";
    const next = await v1<List>(session, `/checklist-templates${query}`);
    if (token !== generation.current) return null;
    setList(next);
    return next;
  }

  async function loadDetail(token: number, templateId: string, scope: string, editionNumber?: number) {
    if (!scope) return;
    const query = editionNumber ? `?edition=${editionNumber}` : "";
    const next = await v1<Detail>(session, `/projects/${scope}/checklist-templates/${templateId}${query}`);
    if (token !== generation.current) return;
    setDetail(next);
    setSelected(next.templateId);
    setEdition(next.edition);
    setTitle(next.title);
    setItems(next.items);
    setPage(0);
    setCreating(false);
  }

  useEffect(() => {
    const token = ++generation.current;
    setReading(true);
    setError("");
    setDetail(null);
    setCreating(false);
    void loadList(token).then((next) => {
      if (token !== generation.current || !next) return;
      const first = next.items[0];
      const scope = projectId || next.projectId || "";
      if (first && scope) return loadDetail(token, first.templateId, scope);
      setSelected("");
    }).catch((reason) => {
      if (token !== generation.current) return;
      setError(explain(reason));
    }).finally(() => { if (token === generation.current) setReading(false); });
  }, [session.token, session.tenantId, projectId]);

  async function refresh(templateId = selected, editionNumber: number | null = edition) {
    const token = ++generation.current;
    setError("");
    try {
      const next = await loadList(token);
      const scope = projectId || next?.projectId || project;
      if (templateId && scope) await loadDetail(token, templateId, scope, editionNumber === null ? undefined : editionNumber ?? undefined);
    } catch (reason) {
      if (token === generation.current) setError(explain(reason));
    }
  }

  const currentScope = useRef("");
  currentScope.current = [session.token, session.tenantId, projectId].join(":");
  const mutation = useRef(false);
  async function write<T>(path: string, payload: Record<string, unknown>) {
    const origin = currentScope.current;
    const key = `helios.checklist:${session.tenantId}:${session.userId}:${path}`;
    const requestId = templateCommand(key, JSON.stringify(payload), () => crypto.randomUUID());
    try {
      const result = await v1<T>(session, path, { requestId, ...payload });
      confirmedTemplateCommand(key);
      if (origin !== currentScope.current) throw new Error("scope_changed");
      return result;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status < 500) confirmedTemplateCommand(key);
      throw cause;
    }
  }
  async function create() {
    if (mutation.current) return;
    const found = problem(title, items);
    if (found || !project) { setError(found || "Объект ещё не подтверждён."); return; }
    const origin = currentScope.current;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await write<Detail>(`/projects/${project}/checklist-templates`, { title: title.trim(), items: items.map(forServer) });
      note("Черновик сохранён.");
      setCreating(false);
      await refresh(saved.templateId, saved.edition);
    } catch (reason) {
      if (origin !== currentScope.current) return;
      setError(explain(reason));
    } finally { mutation.current = false; setBusy(false); }
  }

  async function act(action: Action) {
    if (mutation.current) return;
    if (!detail || !project) return;
    if ((action === "save" || action === "revise") && problem(title, items)) { setError(problem(title, items)); return; }
    if (action === "return" && !reason.trim()) { setError("Укажите причину возврата."); return; }
    const origin = currentScope.current;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      if (action === "save") {
        await write(`/projects/${project}/checklist-templates/${detail.templateId}`, { expectedVersion: detail.version, title: title.trim(), items: items.map(forServer) });
        note("Черновик сохранён.");
      } else if (action === "submit") {
        await write(`/projects/${project}/checklist-templates/${detail.templateId}/submit`, { expectedVersion: detail.version });
        note("Шаблон отправлен ответственному.");
      } else {
        const body: Record<string, unknown> = { expectedVersion: detail.version, action, reason: action === "return" ? reason.trim() : null };
        if (action === "revise") { body.title = title.trim(); body.items = items.map(forServer); }
        await write(`/projects/${project}/checklist-templates/${detail.templateId}/decision`, body);
        note(action === "approve" ? "Версия утверждена." : action === "return" ? "Шаблон возвращён." : action === "revise" ? "Открыта новая редакция." : action === "accept" ? "Ответственность принята." : "Согласование записано.");
        if (action === "return") setReason("");
      }
      await refresh(detail.templateId, action === "revise" ? null : detail.edition);
    } catch (reason) {
      if (origin !== currentScope.current) return;
      setError(explain(reason));
      if (reason instanceof ApiError && (reason.message === "stale_version" || reason.message === "review_recorded")) await refresh(detail.templateId, detail.edition);
    } finally { mutation.current = false; setBusy(false); }
  }

  const editable = creating || !!detail?.allowedActions.includes("save") || !!detail?.allowedActions.includes("revise");
  const source = editable ? items : detail?.items ?? [];
  const shown = checklistPage(source, page);
  const pages = checklistPageCount(source.length);
  const current = detail?.status === "returned" ? "draft" : detail?.status;

  return (
    <section className="page checklist-templates">
      <div>
        <h1>Шаблоны сдачи <NoteMark label="Как проходит шаблон">Инженер ПТО готовит черновик. ПТО принимает ответственность. РП и ОТиПБ согласуют. ЗДС СОСО утверждает. Новая правка открывает следующую редакцию.</NoteMark></h1>
        <p className="sub">{list?.projects.find((item) => item.id === project)?.name || "Объект появится после ответа сервера."}</p>
      </div>
      <Flash message={flash} pulse={pulse} />
      <div className="checklist-layout" aria-busy={reading}>
        <div className="panel checklist-list">
          <div className="checklist-list-head">
            <h2>Редакции</h2>
            {session.role === "engineer-pto" ? <button className="ghost desk-action" type="button" onClick={() => { setCreating(true); setDetail(null); setSelected(""); setTitle("Шаблон сдачи"); setItems([{ id: "item-1", prompt: "", kind: "yes_no", pass: "yes", required: true, critical: true }]); setPage(0); setError(""); }}>Новый черновик</button> : null}
          </div>
          {reading && !list ? <p className="quiet">Читаем шаблоны.</p> : null}
          {list && !list.items.length && !creating ? <p className="quiet">Список пуст. Черновик появится здесь после ответа сервера.</p> : null}
          <div className="checklist-rows">
            {list?.items.map((item) => (
              <button className={item.templateId === selected && !creating ? "checklist-row is-on" : "checklist-row"} type="button" key={item.templateId} onClick={() => { setCreating(false); void refresh(item.templateId, null); }}>
                <b>{item.title}</b>
                <span>{statusLabel[item.status]} · редакция {item.edition}</span>
                {item.waiting ? <em>Ваше действие</em> : null}
                {item.applicableEdition ? <span>Для применения: редакция {item.applicableEdition}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <motion.div className="panel checklist-card" key={creating ? "new" : `${selected}:${edition ?? ""}`} initial={{ opacity: 0, y: reduce ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, duration: reduce ? 0 : 0.26 }}>
          {!creating && !detail ? <p className="quiet">{reading ? "Открываем карточку." : "Выберите шаблон. Карточка версии остаётся справа."}</p> : (
            <>
              <div className="checklist-steps" aria-label="Маршрут шаблона">
                {steps.map((step) => <b className={step.id === current ? "is-on" : ""} key={step.id}>{step.label}</b>)}
                {detail?.status === "returned" ? <b className="is-warn">Возвращён</b> : null}
              </div>
              {detail?.applicable ? <p className="quiet">Для применения доступна редакция {detail.applicable.edition}, версия {detail.applicable.version}.</p> : null}
              {detail && detail.editions.length > 1 ? (
                <label className="field"><span>Редакция</span>
                  <select value={detail.edition} onChange={(event) => void refresh(detail.templateId, Number(event.target.value))}>
                    {detail.editions.map((item) => <option value={item.edition} key={item.edition}>{item.edition} · {statusLabel[item.status]}</option>)}
                  </select>
                </label>
              ) : null}
              <label className="field"><span>Название</span><input value={title} maxLength={120} disabled={!editable || busy} onChange={(event) => setTitle(event.target.value)} /></label>
              <div className="checklist-items">
                {shown.map((item) => {
                  const index = items.findIndex((candidate) => candidate.id === item.id);
                  const live = index >= 0 ? items[index]! : item;
                  return (
                    <div className="checklist-item" key={live.id}>
                      <label className="field"><span>Пункт</span><input value={live.prompt} maxLength={200} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, prompt: event.target.value } : candidate))} /></label>
                      <label className="field"><span>Тип</span>
                        <select value={live.kind} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, kind: event.target.value as ChecklistKind, pass: event.target.value === "yes_no" ? candidate.pass ?? "yes" : undefined, unit: event.target.value === "number" ? candidate.unit ?? "мм" : undefined } : candidate))}>
                          {kinds.map((kind) => <option value={kind.id} key={kind.id}>{kind.label}</option>)}
                        </select>
                      </label>
                      {live.kind === "yes_no" ? <label className="field"><span>Ответ для сдачи</span><select value={live.pass ?? "yes"} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, pass: event.target.value as "yes" | "no" } : candidate))}><option value="yes">Да</option><option value="no">Нет</option></select></label> : null}
                      {live.kind === "number" ? (
                        <div className="checklist-bounds">
                          <label className="field"><span>Единица</span><input value={live.unit ?? ""} maxLength={40} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, unit: event.target.value } : candidate))} /></label>
                          <label className="field"><span>Допуск от</span><input value={live.min ?? ""} maxLength={40} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, min: event.target.value } : candidate))} /></label>
                          <label className="field"><span>Допуск до</span><input value={live.max ?? ""} maxLength={40} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, max: event.target.value } : candidate))} /></label>
                        </div>
                      ) : null}
                      <label className="checkline"><input type="checkbox" checked={live.critical} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, critical: event.target.checked } : candidate))} />Критичный</label>
                      <label className="checkline"><input type="checkbox" checked={live.required} disabled={!editable || busy} onChange={(event) => setItems(items.map((candidate) => candidate.id === live.id ? { ...candidate, required: event.target.checked } : candidate))} />Обязательный</label>
                      {editable ? <button className="ghost desk-action" type="button" disabled={busy || items.length < 2} onClick={() => setItems(items.filter((candidate) => candidate.id !== live.id))}>Убрать пункт</button> : null}
                    </div>
                  );
                })}
              </div>
              <div className="checklist-actions">
                {pages > 1 ? <button className="ghost desk-action" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</button> : null}
                {pages > 1 ? <span className="quiet">{page + 1} из {pages}</span> : null}
                {pages > 1 ? <button className="ghost desk-action" type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Далее</button> : null}
                {editable ? <button className="ghost desk-action" type="button" disabled={busy} onClick={() => { setItems([...items, freshItem(items)]); setPage(checklistPageCount(items.length + 1) - 1); }}>Добавить пункт</button> : null}
              </div>
              {detail?.allowedActions.includes("return") ? <label className="field"><span>Причина возврата</span><input value={reason} maxLength={500} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label> : null}
              {error ? <p role="alert">{error}</p> : null}
              <div className="checklist-actions">
                {creating ? <button className="fill desk-action" type="button" disabled={busy} onClick={() => void create()}>Сохранить черновик</button> : null}
                {detail?.allowedActions.map((action) => <button className={action === "return" ? "ghost desk-action" : "fill desk-action"} type="button" key={action} disabled={busy} onClick={() => void act(action)}>{actionLabel[action]}</button>)}
              </div>
              {detail ? (
                <ol className="checklist-history">
                  {detail.history.length ? detail.history.map((event) => (
                    <li key={event.version}><b>{actionLabel[event.action] ?? event.action}</b><span>{event.actorName}</span>{event.reason ? <p>{event.reason}</p> : null}</li>
                  )) : <li><span className="quiet">История появится после первого действия.</span></li>}
                </ol>
              ) : null}
            </>
          )}
        </motion.div>
      </div>
    </section>
  );
}
