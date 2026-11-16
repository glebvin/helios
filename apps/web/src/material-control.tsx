import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { ApiError, v1 } from "./v1";
import {clearMaterialCommand, keepMaterialCommand, readMaterialCommand} from "./material-command";

type Item = { id: string; prompt: string; kind: string; critical: boolean };
type Template = { id: string; title: string; edition: number; items: Item[] };
type Choice = { id: string; name: string };
type ReadyDoc = { id: string; filename: string; state: "pending" | "ready"; contentType: string };
export type ControlCard = {
  id: string;
  version: number;
  verdict: "awaiting" | "accepted" | "rejected";
  verdictLabel: string;
  zoneId: string;
  workTypeId: string;
  templateId: string;
  items: Item[];
  steps: { version: number; action: string; decision: string | null; dataMark: string | null; verdict: string; actorRole: string; reason: string | null; createdAt: string }[];
};

const stepLabel: Record<string, string> = { prepare: "Ответы", data: "Данные ОМТС", responsible: "Ответственность РП", review: "Согласование ПТО" };

export function controlStepLabel(step: ControlCard["steps"][number]) {
  const name = stepLabel[step.action] ?? step.action;
  if (step.action === "data") return `${name}: ${step.dataMark === "overdue" ? "срок прошёл" : "переданы"}`;
  if (step.action === "review") return `${name}: ${step.decision === "agree" ? "согласовано" : "возврат"}`;
  return name;
}

export function MaterialControl({ session, projectId, batchId, documents, control, intake, onDone, onRefresh }: {
  session: Session;
  projectId: string;
  batchId: string;
  documents: ReadyDoc[];
  control: ControlCard | null;
  intake: { zones: Choice[]; workTypes: Choice[]; templates: Template[] };
  onDone: (message: string) => void;
  onRefresh: () => void;
}) {
  const [zoneId, setZoneId] = useState(control?.zoneId ?? intake.zones[0]?.id ?? "");
  const [workTypeId, setWorkTypeId] = useState(control?.workTypeId ?? intake.workTypes[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(control?.templateId ?? intake.templates[0]?.id ?? "");
  const template = intake.templates.find((item) => item.id === templateId) ?? null;
  const items = template?.items ?? control?.items ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const commandKey = `helios.material-control:${session.tenantId}:${session.userId}:${projectId}:${batchId}`;
  const [pending, setPending] = useState(() => readMaterialCommand(commandKey));
  const mutation = useRef(false), live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const role = session.role;
  const version = control?.version ?? 0;

  async function send(body: Record<string, unknown>, message: string) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setProblem("");
    const command = readMaterialCommand(commandKey) ?? keepMaterialCommand(commandKey, {path: `/projects/${projectId}/material-batches/${batchId}/control`, body: {requestId: crypto.randomUUID(), expectedVersion: version, ...body}});
    setPending(command);
    try {
      await v1(session, command.path, command.body);
      if (readMaterialCommand(commandKey)?.body.requestId === command.body.requestId) clearMaterialCommand(commandKey);
      if (live.current) { setPending(null); onDone(message); }
    } catch (error) {
      if (!live.current) return;
      const code = error instanceof ApiError ? error.message : "";
      const known = error instanceof ApiError && error.status < 500 && error.status !== 429;
      if (known) { clearMaterialCommand(commandKey); setPending(null); }
      setProblem(code === "stale_version" ? "Контроль уже изменили. Обновите карточку и проверьте шаг." : code === "control_outdated" ? "Реквизиты партии изменены. Нужна новая подготовка контроля." : code === "control_completed" ? "Этот маршрут уже согласован." : code === "control_refused" ? "Критичный пункт не пройден. Согласование его не отменяет." : code === "route_incomplete" ? "Маршрут ещё не собран: нужны данные ОМТС и ответственность РП." : code === "route_denied" || code === "role_denied" ? "Этот шаг входу не разрешён." : code === "template_not_approved" ? "Нужен утверждённый чек-лист." : code === "document_not_ready" ? "Нужен загруженный документ подходящего типа." : known ? "Сервер отклонил шаг контроля." : "Ответ сервера не получен. Повторите исходный шаг.");
    } finally { mutation.current = false; if (live.current) setBusy(false); }
  }

  const prepare = (role === "master" || role === "supply") && control?.verdict !== "accepted";
  return (
    <div className="material-control">
      <p>{control?.verdictLabel ?? "Входной контроль ещё не начат"}</p>
      {problem ? <p role="alert">{problem}</p> : null}
      {pending ? <p role="status">Исходный шаг ждёт подтверждения. <button className="desk-action" type="button" disabled={busy} onClick={() => void send({}, "Сервер подтвердил исходный шаг.")}>Повторить шаг контроля</button></p> : null}
      {!pending && problem ? <button className="desk-action" type="button" disabled={busy} onClick={onRefresh}>Обновить контроль</button> : null}
      <fieldset style={{border:0,padding:0,margin:0,minWidth:0}} disabled={busy || Boolean(pending)}>
      {prepare ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          const payload = items.map((item) => ({ itemId: item.id, value: item.kind === "batch" ? batchId : answers[item.id] ?? "" })).filter(answer => answer.value.trim());
          void send({ action: "prepare", zoneId, workTypeId, templateId, answers: payload }, "Ответы записаны.");
        }}>
          <label className="field"><span>Зона</span><select disabled={Boolean(control)} value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{intake.zones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Вид работ</span><select disabled={Boolean(control)} value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)}>{intake.workTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Чек-лист</span><select disabled={Boolean(control)} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{intake.templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          {items.map((item) => (
            <label className="field" key={item.id}><span>{item.prompt}{item.critical ? " · критичный" : ""}</span>{field(item, batchId, documents, answers[item.id] ?? "", (value) => setAnswers({ ...answers, [item.id]: value }))}</label>
          ))}
          <button className="desk-action" type="submit" disabled={busy || !zoneId || !workTypeId || !templateId}>Записать ответы</button>
        </form>
      ) : null}
      {role === "supply" && control && control.verdict === "awaiting" ? (
        <div className="material-actions">
          <button className="desk-action" type="button" disabled={busy} onClick={() => void send({ action: "data", dataMark: "provided" }, "Данные ОМТС записаны.")}>Данные переданы</button>
          <button className="desk-action" type="button" disabled={busy} onClick={() => void send({ action: "data", dataMark: "overdue" }, "Пропуск срока данных отмечен.")}>Срок данных прошёл</button>
        </div>
      ) : null}
      {role === "director" && control && control.verdict === "awaiting" ? <button className="desk-action" type="button" disabled={busy} onClick={() => void send({ action: "responsible" }, "Ответственность РП записана.")}>Взять ответственность</button> : null}
      {role === "pto" && control && control.verdict !== "accepted" ? (
        <div className="material-actions">
          <button className="desk-action" type="button" disabled={busy} onClick={() => void send({ action: "review", decision: "agree" }, "ПТО согласовало шаг.")}>Согласовать</button>
          <label className="field"><span>Причина возврата</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button className="desk-action" type="button" disabled={busy || !reason.trim()} onClick={() => void send({ action: "review", decision: "return", reason }, "ПТО вернуло шаг.")}>Вернуть</button>
        </div>
      ) : null}
      </fieldset>
    </div>
  );
}

function field(item: Item, batchId: string, documents: ReadyDoc[], value: string, change: (value: string) => void) {
  if (item.kind === "yes_no") return <select aria-label={item.prompt} value={value} onChange={(event) => change(event.target.value)}><option value="">Выберите</option><option value="yes">Да</option><option value="no">Нет</option></select>;
  if (item.kind === "batch") return <input value={batchId} readOnly />;
  if (item.kind === "document" || item.kind === "photo") {
    const ready = documents.filter((document) => document.state === "ready" && (item.kind === "photo" ? document.contentType?.startsWith("image/") : document.contentType === "application/pdf"));
    return <select aria-label={item.prompt} value={value} onChange={(event) => change(event.target.value)}><option value="">Документ не выбран</option>{ready.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}</select>;
  }
  return <input aria-label={item.prompt} value={value} onChange={(event) => change(event.target.value)} />;
}
