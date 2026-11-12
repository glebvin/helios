export type EvidenceKind = "image/jpeg" | "image/png" | "application/pdf";
export type EvidenceStep = "reserve" | "upload" | "attach" | "saved";

export type EvidenceFileRow = {
  id: string;
  projectId: string;
  employeeId: string;
  filename: string;
  state: "pending" | "ready";
  sha256: string;
  attachment: { target: { kind?: string; reportId?: string } } | null;
};

export type EvidenceAttempt = {
  requestId: string;
  fileId: string;
  attachRequestId: string;
  filename: string;
  contentType: EvidenceKind;
  sizeBytes: number;
  sha256: string;
  onBehalfReason: string;
};

const limit = 8 * 1024 * 1024;

export function canWriteEvidence(role: string) {
  return role === "worker" || role === "director";
}

export function evidenceListPath(projectId: string, employeeId: string) {
  return `/projects/${projectId}/evidence?${new URLSearchParams({ employeeId, limit: "100", offset: "0" })}`;
}

export function evidenceName(name: string) {
  const base = name.trim().split(/[/\\]/).pop()?.trim() ?? "";
  if (!base || base.length > 255 || /[\u0000-\u001f\u007f]/.test(base)) return "";
  return base;
}

export function evidenceKind(bytes: Uint8Array): EvidenceKind | "" {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return "";
}

export function evidenceSize(size: number) {
  return Number.isInteger(size) && size >= 1 && size <= limit;
}

export function evidenceProblem(online: boolean, name: string, kind: EvidenceKind | "", size: number, reason: string, needsReason: boolean) {
  if (!online) return "Нужна сеть. Файл на этом шаге не копится на телефоне.";
  if (!evidenceName(name)) return "Имя файла не подходит.";
  if (!kind) return "Нужен JPEG, PNG или PDF.";
  if (!evidenceSize(size)) return "Файл пустой или больше 8 МБ. Другой файл вместо него не отправляется.";
  if (needsReason && !reason.trim()) return "Напишите, почему файл записывается за работника.";
  return "";
}

export function evidenceReuse(stored: EvidenceAttempt | null, sha256: string, behalf: string) {
  if (!stored || stored.sha256 !== sha256) return { kind: "fresh" as const };
  if ((stored.onBehalfReason ?? "") !== behalf.trim()) return { kind: "reason" as const };
  return { kind: "same" as const, attempt: stored };
}

export function evidenceReserveBody(attempt: EvidenceAttempt, employeeId: string) {
  const body: Record<string, unknown> = {
    requestId: attempt.requestId,
    fileId: attempt.fileId,
    employeeId,
    filename: attempt.filename,
    contentType: attempt.contentType,
    sizeBytes: attempt.sizeBytes,
    sha256: attempt.sha256,
  };
  const reason = attempt.onBehalfReason.trim();
  if (reason) body.onBehalfReason = reason;
  return body;
}

export function evidenceAttachBody(attempt: EvidenceAttempt, reportId: string) {
  const body: Record<string, unknown> = {
    requestId: attempt.attachRequestId,
    target: { kind: "final_report", reportId },
  };
  const reason = attempt.onBehalfReason.trim();
  if (reason) body.onBehalfReason = reason;
  return body;
}

export function evidenceSaved(file: EvidenceFileRow | null, reportId: string) {
  return Boolean(file && file.state === "ready" && file.attachment?.target.kind === "final_report" && file.attachment.target.reportId === reportId);
}

export function evidenceStep(file: EvidenceFileRow | null, reportId: string): EvidenceStep | "taken" {
  if (!file) return "reserve";
  if (file.state !== "ready") return "upload";
  if (!file.attachment) return "attach";
  if (evidenceSaved(file, reportId)) return "saved";
  return "taken";
}

export function evidenceStageLabel(step: EvidenceStep | "chosen") {
  if (step === "chosen") return "Файл выбран";
  if (step === "reserve") return "Резерв";
  if (step === "upload") return "Загрузка байтов";
  if (step === "attach") return "Привязка к отчёту";
  return "Сохранён";
}

export function filesForReport(files: EvidenceFileRow[], total: number, reportId: string, projectId: string, employeeId: string) {
  if (Number(total) !== files.length || files.some((file) => file.projectId !== projectId || file.employeeId !== employeeId)) return { kind: "incomplete" as const };
  return { kind: "ready" as const, items: files.filter((file) => file.attachment?.target.kind === "final_report" && file.attachment.target.reportId === reportId) };
}

export function evidenceError(status: number | null, code: string) {
  if (status === null) return "Нет подтверждения сервера. Файл не считается сохранённым.";
  if (status === 401) return "Сессия закончилась. Войдите снова и откройте файл заново.";
  if (status === 413 || code === "payload_too_large") return "Файл больше 8 МБ. Он не сохранён.";
  if (status === 415) return "Сервер принял только поток байтов. Файл не сохранён.";
  if (code === "evidence_pending") return "Байты ещё не догружены. Файл не считается сохранённым.";
  if (code === "evidence_already_attached") return "Этот файл уже привязан. Второй связи нет.";
  if (code === "file_metadata_conflict") return "Эти байты уже зарезервированы с другими данными. Новый файл не создан.";
  if (status === 404) return "Файлы другого объекта этому входу не отдаются.";
  if (status === 403 || code === "role_denied") return "Этому входу файл не разрешён.";
  if (code === "invalid_filename" || code === "invalid_content_type" || code === "invalid_sha256") return "Сервер не принял файл. Он не сохранён.";
  return `Сервер не сохранил файл${code ? `: ${code}` : ""}.`;
}
