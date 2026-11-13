import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { reportDependency, reportFiles, sendEvidence, watchDelivery } from "./delivery";
import { ApiError, v1Collection } from "./v1";
import { canWriteEvidence, evidenceError, evidenceKind, evidenceListPath, evidenceName, evidenceProblem, evidenceQueueError, evidenceReuse, evidenceSaved, evidenceStageLabel, filesForReport, type EvidenceAttempt, type EvidenceFileRow, type EvidenceStep } from "./evidence";

type Page<T> = { items: T[]; total: number };

export function EvidenceFiles({ session, projectId, employeeId, reportId, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  reportId: string;
  onDone: (message: string) => void;
}) {
  const writable = canWriteEvidence(session.role);
  const [pass, setPass] = useState(0);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<EvidenceFileRow[]>([]);
  const [local, setLocal] = useState<Awaited<ReturnType<typeof reportFiles>>>([]);
  const [openError, setOpenError] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await v1Collection<EvidenceFileRow>(session, evidenceListPath(projectId, employeeId));
        if (!live) return;
        const found = filesForReport(page.items, page.total, reportId, projectId, employeeId);
        setFiles(found.kind === "ready" ? found.items : []);
        setNote(found.kind === "ready" ? "" : "Список файлов неполный. Новый файл не отправляем.");
      } catch (reason) {
        if (!live) return;
        setFiles([]);
        setNote(reason instanceof ApiError ? evidenceError(reason.status, reason.message) : "Файлы прочитать не удалось. Сохранёнными они не считаются.");
      }
    })();
    return () => { live = false; };
  }, [session.token, session.tenantId, projectId, employeeId, reportId, pass]);
  useEffect(() => {
    let live = true;
    const read = () => { void reportFiles(reportId).then((rows) => { if (live) setLocal(rows); }).catch(() => { if (live) setLocal([]); }); };
    read();
    const stop = watchDelivery(() => { read(); setPass((value) => value + 1); });
    return () => { live = false; stop(); };
  }, [session.token, reportId, pass]);
  return <div>
    {note ? <p className="quiet">{note}</p> : null}
    {openError ? <p role="alert">{openError}</p> : null}
    {local.filter((file) => file.state !== "synced" || file.stage !== "synced").map((file) => <p className="quiet" role="status" key={file.id}>{file.filename}: {file.stage === "queued" ? "В очереди" : evidenceStageLabel(file.stage === "reserved" ? "reserve" : file.stage === "uploaded" ? "upload" : "attach")}. {file.state === "blocked" || file.state === "auth-required" ? "Сервер не принял файл. Он не сохранён." : "Ожидает отправки"}</p>)}
    {files.map((file) => <p className="quiet" key={file.id}>{evidenceSaved(file, reportId) ? `Сохранён ${file.filename}.` : `${file.filename} не догружен.`} {evidenceSaved(file, reportId) ? <button className="ghost desk-action" type="button" onClick={() => void openFile(session, projectId, file).then(() => setOpenError(""), (reason: unknown) => setOpenError(reason instanceof ApiError ? evidenceError(reason.status, reason.message) : evidenceError(null, "")))}>Открыть</button> : null}</p>)}
    {writable && !note ? <div className="template-bar"><button className="ghost desk-action" type="button" onClick={() => setOpen(true)}>Добавить фото</button></div> : null}
    {open ? <EvidenceDialog session={session} projectId={projectId} employeeId={employeeId} reportId={reportId} needsReason={session.role === "director"} onClose={() => setOpen(false)} onDone={(message) => { setOpen(false); setPass((value) => value + 1); onDone(message); }} /> : null}
  </div>;
}

function EvidenceDialog({ session, projectId, employeeId, reportId, needsReason, onClose, onDone }: {
  session: Session;
  projectId: string;
  employeeId: string;
  reportId: string;
  needsReason: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [stage, setStage] = useState<EvidenceStep | "chosen" | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const pending = useRef<EvidenceAttempt | null>(null);
  const problem = formProblem(file, reason, needsReason);
  useEffect(() => { if (error) alertRef.current?.focus(); }, [error]);
  async function submit() {
    if (lock.current || !file) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const detected = evidenceKind(bytes);
      const invalid = evidenceProblem(navigator.onLine, file.name, detected, bytes.byteLength, reason, needsReason);
      if (invalid || !detected || !evidenceName(file.name)) throw new Error(invalid || "Файл не подходит.");
      const blob = new Blob([bytes], { type: detected });
      const dependencyRequestId = await reportDependency(reportId);
      const sha256 = await sha256Hex(bytes);
      const key = `helios.evidence:${session.tenantId}:${session.userId}:${projectId}:${reportId}:${sha256}`;
      let stored: EvidenceAttempt | null = null;
      try { stored = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { stored = null; }
      if (pending.current?.sha256 === sha256) stored = pending.current;
      const reuse = evidenceReuse(stored, sha256, needsReason ? reason : "");
      if (reuse.kind === "reason") throw new Error("Эти байты уже отправлялись с другой причиной. Новый файл не создаётся.");
      const attempt: EvidenceAttempt = reuse.kind === "same" ? reuse.attempt : {
        requestId: crypto.randomUUID(), fileId: crypto.randomUUID(), attachRequestId: crypto.randomUUID(),
        filename: evidenceName(file.name), contentType: detected, sizeBytes: bytes.byteLength, sha256, onBehalfReason: needsReason ? reason.trim() : "",
      };
      pending.current = attempt;
      try { sessionStorage.setItem(key, JSON.stringify(attempt)); } catch { /* The open form still repeats this attempt. */ }
      const outcome = await sendEvidence({
        projectId, employeeId, filename: attempt.filename, contentType: detected, blob,
        target: { kind: "final_report", reportId }, ...(dependencyRequestId ? { dependencyRequestId } : {}),
        fileId: attempt.fileId, reserveRequestId: attempt.requestId, attachRequestId: attempt.attachRequestId,
        ...(attempt.onBehalfReason ? { onBehalfReason: attempt.onBehalfReason } : {}),
      });
      if (outcome.stage === "reserved") setStage("reserve");
      else if (outcome.stage === "uploaded") setStage("upload");
      else if (outcome.stage === "synced") setStage("saved");
      if (outcome.state === "synced" && outcome.stage === "synced") {
        onDone(`Сохранён ${attempt.filename}.`);
        return;
      }
      if (outcome.state === "blocked" || outcome.state === "auth-required") throw new Error("Сервер не принял файл. Он не сохранён.");
      onDone("Ожидает отправки");
    } catch (failure) {
      setError(queueFailure(failure));
    } finally { lock.current = false; setBusy(false); }
  }
  return <Dialog title="Фото к отчёту" onClose={() => { if (!lock.current) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {error ? <p ref={alertRef} tabIndex={-1} role="alert">{error}</p> : null}
      <p role="status">{stage ? `Стадия: ${evidenceStageLabel(stage)}.` : "Файл сохранится только после привязки к отчёту."}</p>
      <label className="field"><span>Файл</span><input type="file" accept="image/jpeg,image/png,application/pdf" aria-describedby="evidence-note" onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); setStage(next ? "chosen" : ""); }} /></label>
      <p id="evidence-note" className="quiet">{problem || "Повтор тех же байтов не создаёт второй файл."}</p>
      {needsReason ? <label className="field"><span>Почему за работника</span><input maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label> : null}
      <button className="ghost desk-action" type="button" disabled={busy} onClick={onClose}>Отмена</button>
      <button className="fill desk-action" type="submit" disabled={busy || !!problem}>{busy ? "Записываем…" : "Отправить файл"}</button>
    </form>
  </Dialog>;
}

function queueFailure(failure: unknown) {
  if (failure instanceof DOMException && (failure.name === "QuotaExceededError" || failure.name === "UnknownError")) return evidenceQueueError("quota_exceeded");
  if (failure instanceof Error && "code" in failure && typeof failure.code === "string") return evidenceQueueError(failure.code);
  return failure instanceof Error ? failure.message : evidenceQueueError("");
}

function formProblem(file: File | null, reason: string, needsReason: boolean) {
  if (!file) return "Выберите JPEG, PNG или PDF.";
  if (!evidenceName(file.name)) return "Имя файла не подходит.";
  if (file.size < 1 || file.size > 8 * 1024 * 1024) return "Файл пустой или больше 8 МБ. Другой файл вместо него не отправляется.";
  if (needsReason && !reason.trim()) return "Напишите, почему файл записывается за работника.";
  return "";
}

async function openFile(session: Session, projectId: string, file: EvidenceFileRow) {
  const response = await fetch(`/api/v1/projects/${projectId}/evidence/${file.id}/content`, {
    headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId },
  });
  if (!response.ok) {
    const text = await response.text();
    let code = "";
    try { code = text ? (JSON.parse(text) as { error?: string }).error ?? "" : ""; } catch { code = ""; }
    throw new ApiError(response.status, code);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function sha256Hex(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
