export type ShiftKind = "shift_start" | "shift_end";

export type ShiftGeo = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
};

export function canWriteShift(role: string) {
  return role === "worker" || role === "master";
}

export function shiftNeedsReason(role: string) {
  return role === "master";
}

export function shiftProblem(online: boolean, kind: ShiftKind, open: boolean, reason: string, needsReason: boolean) {
  void online;
  if (kind === "shift_start" && open) return "Смена уже открыта на сервере.";
  if (kind === "shift_end" && !open) return "Открытой смены на сервере нет.";
  if (needsReason && !reason.trim()) return "Напишите, почему смена записывается за работника.";
  return "";
}

export function shiftEventBody(input: {
  requestId: string;
  employeeId: string;
  projectId: string;
  shiftId: string;
  expectedVersion: number;
  occurredAt: string;
  kind: ShiftKind;
  previousEventId?: string;
  onBehalfReason?: string;
  geo?: ShiftGeo | null;
}) {
  const event: Record<string, unknown> = {
    kind: input.kind,
    requestId: input.requestId,
    employeeId: input.employeeId,
    projectId: input.projectId,
    shiftId: input.shiftId,
    expectedVersion: input.expectedVersion,
    occurredAt: input.occurredAt,
  };
  if (input.previousEventId) event.previousEventId = input.previousEventId;
  const reason = input.onBehalfReason?.trim();
  if (reason) event.onBehalfReason = reason;
  if (input.geo) event.geo = input.geo;
  return { events: [event] };
}

export type ShiftBatch = {
  results?: { outcome?: string; status?: number; code?: string; result?: { version?: number } }[];
};

export function shiftBatchError(body: ShiftBatch | null, httpStatus: number | null) {
  if (httpStatus === null) return "Нет подтверждения сервера. Повторите в этой форме, не закрывая её.";
  if (httpStatus === 401) return "Сессия закончилась. Войдите снова.";
  const row = body?.results?.[0];
  if (!row) return "Сервер не вернул результат смены.";
  if (row.outcome === "success" || row.outcome === "duplicate") return row.result?.version ? "" : "Сервер не вернул версию смены.";
  const code = row.code ?? "";
  if (code === "stale_version") return "Версия дня на сервере уже другая. Прочитайте день заново.";
  if (code === "shift_already_open") return "Смена уже открыта на сервере.";
  if (code === "assignment_required") return "Назначения на объект нет. Смена не открыта.";
  if (code === "admission_required") return "Допуск не позволяет открыть смену.";
  if (code === "on_behalf_reason_required") return "Для записи за работника нужна причина.";
  if (code === "role_denied" || row.status === 403) return "Этому входу смена не разрешена.";
  if (code === "shift_closed" || code === "shift_reference_denied") return "Открытой смены на сервере уже нет.";
  return `Сервер не записал смену${code ? `: ${code}` : ""}.`;
}
