import {
  OfflineQueueError,
  openOfflineQueue,
  type EventPayload,
  type EvidenceInput,
  type OfflineQueue,
  type QueueEvent,
  type QueueEvidence,
} from "@helios/offline";

export type ShiftRow = QueueEvent | QueueEvidence;
type Identity = { token: string; tenantId: string; userId: string };
type LiveSession = { token: string; tenantId: string; actorUserId: string; generation: number };

let generation = 0;
let session: LiveSession | null = null;
let queue: OfflineQueue | null = null;
let chain: Promise<void> = Promise.resolve();

export function bindShiftQueue(next: Identity | null): Promise<void> {
  const run = chain.then(async () => {
    const previous = queue;
    queue = null;
    session = null;
    generation += 1;
    await previous?.closeSession().catch(() => undefined);
    if (!next) return;
    const opened: LiveSession = { token: next.token, tenantId: next.tenantId, actorUserId: next.userId, generation };
    session = opened;
    queue = await openOfflineQueue({
      audience: `${location.origin}/api/v1`,
      tenantId: next.tenantId,
      actorUserId: next.userId,
      getSession: () => (session?.generation === opened.generation ? session : null),
    });
  });
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function requireQueue() {
  await chain;
  if (!queue) throw new OfflineQueueError("auth_required");
  return queue;
}

export function isShiftEvent(row: ShiftRow): row is QueueEvent {
  return row.stage === "event";
}

export async function readShiftRows(): Promise<ShiftRow[]> {
  return (await requireQueue()).list();
}

export async function shiftQueuePending() {
  try {
    const rows = await readShiftRows();
    return rows.some((row) => row.state !== "synced");
  } catch {
    return false;
  }
}

export async function deliverShiftQueue() {
  const active = await requireQueue();
  const delivery = await active.flush();
  const rows = await active.status();
  return { delivery, rows };
}

export async function retryShiftRow(id: string) {
  await (await requireQueue()).retry(id);
}

export async function shiftStorage() {
  return (await requireQueue()).storageInfo();
}

export function queueCode(error: unknown) {
  return error instanceof OfflineQueueError ? error.code : "";
}

type VersionHead = { expectedVersion: number; diverged: boolean; blocked: boolean };

export function versionHead(rows: ShiftRow[], employeeId: string, serverVersion: number): VersionHead {
  const mine = rows.filter(isShiftEvent).filter((row) => row.employeeId === employeeId);
  const last = mine.reduce<QueueEvent | null>((best, row) => (!best || row.event.expectedVersion > best.event.expectedVersion ? row : best), null);
  if (!last) return { expectedVersion: serverVersion, diverged: false, blocked: false };
  const expectedVersion = last.event.expectedVersion + 1;
  const unsynced = mine.some((row) => row.state !== "synced");
  const blocked = mine.some((row) => row.state === "blocked" || row.state === "auth-required");
  return { expectedVersion, diverged: !unsynced && serverVersion !== expectedVersion, blocked };
}

function previousEventId(rows: ShiftRow[], employeeId: string, projectId: string) {
  const mine = rows.filter(isShiftEvent).filter((row) => row.employeeId === employeeId && row.projectId === projectId);
  return mine.reduce<QueueEvent | null>((best, row) => (!best || row.event.expectedVersion > best.event.expectedVersion ? row : best), null)?.requestId;
}

export type ShiftDraft = {
  event: EventPayload;
  evidence?: EvidenceInput[];
};

/** Append frozen commands. A stored request keeps its original body. */
export async function commitShiftDrafts(employeeId: string, serverVersion: number, drafts: ShiftDraft[]) {
  const active = await requireQueue();
  for (const draft of drafts) {
    const rows = await active.list();
    if (rows.some((row) => isShiftEvent(row) && row.requestId === draft.event.requestId)) continue;
    const head = versionHead(rows, employeeId, serverVersion);
    if (head.blocked) throw new OfflineQueueError("chain_blocked");
    if (head.diverged || draft.event.expectedVersion !== head.expectedVersion) throw new OfflineQueueError("chain_diverged");
    const previous = previousEventId(rows, employeeId, draft.event.projectId);
    if ((previous ?? undefined) !== draft.event.previousEventId) throw new OfflineQueueError("chain_diverged");
    await active.enqueueEvent(draft.event, draft.evidence ? { evidence: draft.evidence } : {});
  }
}

export function prepareDrafts(rows: ShiftRow[], employeeId: string, serverVersion: number, specs: PreparedSpec[]): ShiftDraft[] {
  const head = versionHead(rows, employeeId, serverVersion);
  if (head.blocked) throw new OfflineQueueError("chain_blocked");
  if (head.diverged) throw new OfflineQueueError("chain_diverged");
  const drafts: ShiftDraft[] = [];
  let expectedVersion = head.expectedVersion;
  const seen = [...rows];
  for (const spec of specs) {
    const previous = previousEventId(seen, employeeId, spec.projectId);
    const event = spec.build(expectedVersion, previous);
    drafts.push({ event, evidence: spec.evidence?.(event) });
    seen.push({ id: event.requestId, requestId: event.requestId, employeeId, projectId: event.projectId, dependency: previous ?? null, stage: "event", event, state: "pending", attemptCount: 0, nextAttemptAt: null, lastError: null });
    expectedVersion += 1;
  }
  return drafts;
}

type PreparedSpec = {
  projectId: string;
  build: (expectedVersion: number, previous: string | undefined) => EventPayload;
  evidence?: (event: EventPayload) => EvidenceInput[] | undefined;
};

export function decimalQuantity(input: string) {
  const trimmed = input.trim().replace(",", ".");
  if (!trimmed || !/^\d{1,11}(?:\.\d{1,3})?$/.test(trimmed) || !/[1-9]/.test(trimmed)) return "";
  const [whole, frac = ""] = trimmed.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${frac.padEnd(3, "0")}`;
}

export function thousandths(value: string) {
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole || "0") * 1000n + BigInt(frac.padEnd(3, "0").slice(0, 3) || "0");
}

export function showQuantity(value: string, unit: string) {
  const [whole, frac = ""] = value.split(".");
  const rest = frac.replace(/0+$/, "");
  return `${rest ? `${whole},${rest}` : whole} ${unit}`;
}

export type GeoCapture = { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string };
export type GeoAttempt = { fix: GeoCapture | null; status: "received" | "denied" | "timeout" | "unavailable" };

export function captureGeo(timeout = 8000): Promise<GeoAttempt> {
  if (!navigator.geolocation) return Promise.resolve({ fix: null, status: "unavailable" });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy < 0) {
          resolve({ fix: null, status: "unavailable" });
          return;
        }
        resolve({
          fix: { latitude, longitude, accuracyMeters: accuracy, capturedAt: new Date(position.timestamp).toISOString() },
          status: "received",
        });
      },
      (error) => resolve({ fix: null, status: error.code === error.PERMISSION_DENIED ? "denied" : error.code === error.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 },
    );
  });
}

const photoLimit = 8 * 1024 * 1024;

export async function preparePhoto(file: File): Promise<{ blob: Blob; contentType: "image/jpeg" | "image/png"; filename: string } | { error: string }> {
  const original = file.type === "image/jpeg" || file.type === "image/png";
  if (original && file.size > 0 && file.size <= photoLimit) return { blob: file, contentType: file.type, filename: safeName(file.name, file.type) };
  if (!original && !file.type.startsWith("image/")) return { error: "Нужна фотография JPEG или PNG. Этот файл так и останется непринятым, переименование его не исправит." };
  try {
    const bitmap = await createImageBitmap(file);
    const edge = Math.max(bitmap.width, bitmap.height);
    const scale = edge > 1600 ? 1600 / edge : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return { error: "Браузер не смог подготовить фотографию." };
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size < 1 || blob.size > photoLimit) return { error: "После подготовки фото больше 8 МБ. Выберите другое." };
    return { blob, contentType: "image/jpeg", filename: safeName(file.name.replace(/\.\w+$/, "") + ".jpg", "image/jpeg") };
  } catch {
    return { error: "Браузер не открыл этот формат. Выберите JPEG или PNG." };
  }
}

function safeName(name: string, type: string) {
  const clean = name.trim().replace(/[^\w.\- ()а-яё]+/gi, "-").slice(0, 180);
  if (clean) return clean;
  return type === "image/png" ? "photo.png" : "photo.jpg";
}

export function rowLabel(row: ShiftRow) {
  if (row.state === "sending") return "Отправляем…";
  if (row.state === "auth-required") return "Войдите снова, чтобы продолжить отправку.";
  if (row.state === "blocked") return "Нужна проверка. Запись сохранена на устройстве.";
  if (isShiftEvent(row) && row.state === "synced") return "Передано на сервер";
  if (!isShiftEvent(row) && row.state === "synced") return "Передано на сервер";
  if (!isShiftEvent(row) && row.state === "pending" && row.stage !== "queued") return "Отметка передана. Фото отправляется.";
  if (row.state === "retry_wait" || row.state === "pending") return "Сохранено на этом устройстве";
  return "Сохранено на этом устройстве";
}

export function deliveryLabel(state: string) {
  if (state === "busy") return "Передача уже идёт в другом окне. Это не подтверждение.";
  if (state === "unsupported_lock") return "Браузер не поддерживает блокировку. Ничего не передано.";
  if (state === "idle") return "Новых отметок для передачи нет.";
  return "Проход передачи закончился. Ниже состояние каждой записи.";
}

export function failureLabel(code: string) {
  const text: Record<string, string> = {
    auth_required: "Войдите снова, чтобы продолжить отправку.",
    chain_blocked: "Нужна проверка. Новая отметка не добавлена поверх остановленной цепочки.",
    chain_diverged: "Версия на сервере и цепочка на устройстве разошлись. Запись не перенумерована.",
    local_stream_conflict: "Цепочка на устройстве не приняла эту команду. Прежняя запись не заменена.",
    local_dependency_conflict: "Команда не совпала с предыдущей отметкой. Прежняя запись не заменена.",
    capacity_exceeded: "Не сохранено. На устройстве закончилось место очереди.",
    invalid_size: "Не сохранено. Файл пустой или больше 8 МБ.",
    invalid_content_type: "Не сохранено. Нужен JPEG, PNG или PDF.",
    storage_aborted: "Не сохранено. Повторите после устранения причины.",
    stale_version: "Нужна проверка. Запись сохранена на устройстве.",
    shift_already_open: "Смена уже открыта. Вторая не создана.",
    assignment_required: "Нет действующего назначения.",
    admission_required: "Допуск не позволяет это действие.",
    positive_closed_task_work_required: "Объём не отправлен: по заданию нет завершённой работы.",
    final_report_already_submitted: "Отчёт по этому заданию и смене уже есть.",
  };
  return text[code] ?? (code ? `Сервер или очередь: ${code}` : "Не сохранено. Повторите после устранения причины.");
}
