import { useState } from "react";
import type { Session } from "./api";
import { ApiError, v1 } from "./v1";

type Item = { id: string; prompt: string; kind: string; critical: boolean };
type Template = { id: string; title: string; edition: number; items: Item[] };
type Choice = { id: string; name: string };
type ReadyDoc = { id: string; filename: string; state: "pending" | "ready" };
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

export function MaterialControl({ session, projectId, batchId, documents, control, intake, onDone }: {
  session: Session;
  projectId: string;
  batchId: string;
  documents: ReadyDoc[];
  control: ControlCard | null;
  intake: { zones: Choice[]; workTypes: Choice[]; templates: Template[] };
  onDone: (message: string) => void;
}) {
  const [zoneId, setZoneId] = useState(control?.zoneId ?? intake.zones[0]?.id ?? "");
  const [workTypeId, setWorkTypeId] = useState(control?.workTypeId ?? intake.workTypes[0]?.id ?? "");
  const [templateId, setTemplateId] = useState(control?.templateId ?? intake.templates[0]?.id ?? "");
  const template = intake.templates.find((item) => item.id === templateId) ?? null;
  const items = control?.items ?? template?.items ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const role = session.role;
  const version = control?.version ?? 0;

  async function send(body: Record<string, unknown>, message: string) {
    setBusy(true); setProblem("");
    try {
      await v1(session, `/projects/${projectId}/material-batches/${batchId}/control`, { requestId: crypto.randomUUID(), expectedVersion: version, ...body });
      onDone(message);
    } catch (error) {
      const code = error instanceof ApiError ? error.message : "";
      setProblem(code === "stale_version" ? "Контроль уже изменили. Открыта последняя версия." : code === "control_refused" ? "Критичный пункт не пройден. Согласование его не отменяет." : code === "route_incomplete" ? "Маршрут ещё не собран: нужны данные ОМТС и ответственность РП." : code === "route_denied" ? "Этот шаг назначен другой роли." : code === "template_not_approved" ? "Нужен утверждённый чек-лист." : code === "document_not_ready" ? "Документ пункта ещё не загружен." : "Сервер не записал шаг контроля.");
    } finally { setBusy(false); }
  }

  const prepare = (role === "master" || role === "supply") && control?.verdict !== "accepted";
  return (
    <div className="material-control">
      <p>{control?.verdictLabel ?? "Входной контроль ещё не начат"}</p>
      {problem ? <p role="alert">{problem}</p> : null}
      {prepare ? (
        <form onSubmit={(event) => {
          event.preventDefault();
          const payload = items.map((item) => ({ itemId: item.id, value: item.kind === "batch" ? batchId : answers[item.id] ?? "" }));
          void send({ action: "prepare", zoneId, workTypeId, templateId, answers: payload }, "Ответы записаны.");
        }}>
          <label className="field"><span>Зона</span><select value={zoneId} onChange={(event) => setZoneId(event.target.value)}>{intake.zones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Вид работ</span><select value={workTypeId} onChange={(event) => setWorkTypeId(event.target.value)}>{intake.workTypes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="field"><span>Чек-лист</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{intake.templates.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
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
    </div>
  );
}

function field(item: Item, batchId: string, documents: ReadyDoc[], value: string, change: (value: string) => void) {
  if (item.kind === "yes_no") return <select value={value} onChange={(event) => change(event.target.value)}><option value="">Выберите</option><option value="yes">Да</option><option value="no">Нет</option></select>;
  if (item.kind === "batch") return <input value={batchId} readOnly />;
  if (item.kind === "document" || item.kind === "photo") {
    const ready = documents.filter((document) => document.state === "ready");
    return <select value={value} onChange={(event) => change(event.target.value)}><option value="">Документ не выбран</option>{ready.map((document) => <option key={document.id} value={document.id}>{document.filename}</option>)}</select>;
  }
  return <input value={value} onChange={(event) => change(event.target.value)} />;
}
