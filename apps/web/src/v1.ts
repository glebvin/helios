import type { Session } from "./api";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function v1<T>(session: Session, path: string, body?: unknown, method?: string): Promise<T> {
  const headers = new Headers({
    authorization: `Bearer ${session.token}`,
    "x-tenant-id": session.tenantId,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetch(`/api/v1${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) as T & { error?: string } : ({} as T & { error?: string });
  if (!response.ok) throw new ApiError(response.status, parsed.error ?? `http_${response.status}`);
  return parsed;
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
