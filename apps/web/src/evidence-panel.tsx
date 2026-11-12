import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";
import { Dialog } from "./dialog";
import { ApiError, v1, v1Collection } from "./v1";
import { canWriteEvidence, evidenceAttachBody, evidenceError, evidenceKind, evidenceListPath, evidenceName, evidenceProblem, evidenceReserveBody, evidenceReuse, evidenceSaved, evidenceStageLabel, evidenceStep, filesForReport, type EvidenceAttempt, type EvidenceFileRow, type EvidenceStep } from "./evidence";

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
  return <div>
    {note ? <p className="quiet">{note}</p> : null}
    {openError ? <p role="alert">{openError}</p> : null}
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
      setStage("reserve");
      await v1(session, `/projects/${projectId}/evidence`, evidenceReserveBody(attempt, employeeId));
      let current = await readFile(session, projectId, attempt.fileId);
      if (evidenceStep(current, reportId) === "taken") throw new Error("Эти байты уже привязаны к другой записи. Новый файл не создаётся.");
      if (evidenceStep(current, reportId) === "upload") {
        setStage("upload");
        current = await putBytes(session, projectId, attempt.fileId, bytes);
      }
      if (evidenceStep(current, reportId) === "attach") {
        setStage("attach");
        await v1(session, `/projects/${projectId}/evidence/${attempt.fileId}/attachment`, evidenceAttachBody(attempt, reportId));
        current = await readFile(session, projectId, attempt.fileId);
      }
      if (!evidenceSaved(current, reportId)) throw new Error("Сервер не подтвердил привязку. Файл не считается сохранённым.");
      setStage("saved");
      onDone(`Сервер сохранил ${current?.filename ?? attempt.filename}.`);
    } catch (failure) {
      setError(failure instanceof ApiError ? evidenceError(failure.status, failure.message) : failure instanceof Error ? failure.message : evidenceError(null, ""));
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

function formProblem(file: File | null, reason: string, needsReason: boolean) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "Нужна сеть. Файл на этом шаге не копится на телефоне.";
  if (!file) return "Выберите JPEG, PNG или PDF.";
  if (!evidenceName(file.name)) return "Имя файла не подходит.";
  if (file.size < 1 || file.size > 8 * 1024 * 1024) return "Файл пустой или больше 8 МБ. Другой файл вместо него не отправляется.";
  if (needsReason && !reason.trim()) return "Напишите, почему файл записывается за работника.";
  return "";
}

async function readFile(session: Session, projectId: string, fileId: string) {
  return v1<EvidenceFileRow>(session, `/projects/${projectId}/evidence/${fileId}`);
}

async function putBytes(session: Session, projectId: string, fileId: string, bytes: Uint8Array) {
  let response: Response;
  try {
    response = await fetch(`/api/v1/projects/${projectId}/evidence/${fileId}/content`, {
      method: "PUT",
      headers: { authorization: `Bearer ${session.token}`, "x-tenant-id": session.tenantId, "content-type": "application/octet-stream" },
      body: bytes.slice(),
    });
  } catch {
    throw new Error(evidenceError(null, ""));
  }
  const text = await response.text();
  let parsed: EvidenceFileRow & { error?: string };
  try { parsed = text ? JSON.parse(text) as EvidenceFileRow & { error?: string } : { error: "" } as EvidenceFileRow & { error?: string }; }
  catch { throw new Error(evidenceError(null, "")); }
  if (!response.ok) throw new ApiError(response.status, parsed.error ?? "");
  return parsed;
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
