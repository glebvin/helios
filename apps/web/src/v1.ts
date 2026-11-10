import type { Session } from "./api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type V1Options = { method?: string; signal?: AbortSignal };

export async function v1<T>(session: Session, path: string, body?: unknown, methodOrOptions?: string | V1Options): Promise<T> {
  const options: V1Options = typeof methodOrOptions === "string" ? { method: methodOrOptions } : (methodOrOptions ?? {});
  const headers = new Headers({
    authorization: `Bearer ${session.token}`,
    "x-tenant-id": session.tenantId,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as T & { error?: string } : ({} as T & { error?: string });
  if (!response.ok) throw new ApiError(response.status, parsed.error ?? `http_${response.status}`);
  return parsed;
}

export function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export type Page<T> = { items: T[]; total: number; limit: number; offset: number };

export function pagePath(path: string, offset: number) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}limit=100&offset=${offset}`;
}

export async function collectPages<T>(session: Session, path: string, signal?: AbortSignal) {
  const first = await v1<Page<T>>(session, pagePath(path, 0), undefined, { signal });
  const items = [...first.items];
  let offset = first.items.length;
  let pages = 1;
  while (offset < first.total && pages < 20) {
    const next = await v1<Page<T>>(session, pagePath(path, offset), undefined, { signal });
    if (next.items.length === 0) break;
    items.push(...next.items);
    offset += next.items.length;
    pages += 1;
  }
  return { items, total: first.total, truncated: items.length < first.total };
}

export type V1Project = { id: string; name: string };
export type V1Employee = {
  id: string;
  fullName: string;
  phone: string | null;
  organizationId: string;
  userId: string | null;
  version: number;
  status: "active" | "archived";
};
export type Qualification = {
  id: string;
  employeeId: string;
  code: string;
  title: string;
  documentReference: string | null;
  validUntil: string | null;
  status: "active" | "revoked";
  version: number;
};
export type CurrentAdmission = { eligible: boolean; reasons: string[]; checkId: string | null; templateVersion: number | null };
export type Assignment = {
  projectId: string;
  employeeId: string;
  status: "active" | "revoked";
  version: number;
  admissionCheckId: string | null;
  currentAdmission: CurrentAdmission;
};
export type CrewMember = { employeeId: string; status: "active" | "revoked"; version: number; currentAdmission: CurrentAdmission };
export type Crew = { id: string; projectId: string; name: string; version: number; members: CrewMember[] };
export type Zone = { id: string; projectId: string; name: string; version: number; status: "active" | "archived" };
export type WorkType = {
  id: string;
  projectId: string;
  name: string;
  version: number;
  status: "active" | "archived";
  unit: string;
  requiresRd: boolean;
  requiresMaterialControl: boolean;
  requiresPredecessorAcceptance: boolean;
  requiresId: boolean;
};
export type TemplateItem = { id: string; label: string; critical: boolean };
export type AdmissionTemplate = {
  projectId: string;
  code: string;
  title: string;
  version: number;
  items: TemplateItem[];
  requiredQualificationCodes: string[];
};
export type AdmissionCheck = {
  id: string;
  passed: boolean;
  civilDate: string;
  templateVersion: number;
  reasons: string[];
  warnings: string[];
  sequence: number;
};
export type ProjectMembership = { projectId: string; userId: string; role: string; status: "active" | "revoked"; version: number };
export type OverviewClock = { day: string; timezone: string; projectId: string };

export function apiText(error: unknown) {
  if (isAbort(error)) return "";
  if (error instanceof TypeError) return "Нет связи с сервером.";
  if (error instanceof ApiError) {
    if (error.status === 401) return "Сессия закончилась. Войдите снова.";
    if (error.status === 403) return "Этому входу действие не разрешено.";
    if (error.status === 404) return "Запись не найдена.";
    return error.message;
  }
  return "Не удалось выполнить запрос.";
}

export function civilDay(timeZone: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

const requestStore = "helios.request.";

export function requestId(key: string, payload: unknown) {
  const storageKey = requestStore + key;
  const body = JSON.stringify(payload);
  const saved = sessionStorage.getItem(storageKey);
  if (saved) {
    const parsed = JSON.parse(saved) as { id?: string; body?: string };
    if (parsed.id && parsed.body === body) return parsed.id;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(storageKey, JSON.stringify({ id, body }));
  return id;
}

export function releaseRequest(key: string) {
  sessionStorage.removeItem(requestStore + key);
}

export function stableId(key: string) {
  const saved = sessionStorage.getItem(key);
  if (saved) return saved;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export function moscowDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(date);
}
