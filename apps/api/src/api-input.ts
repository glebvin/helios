import { httpError } from "./errors.js";

export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw httpError(400, "invalid_uuid");
  }
  return value;
}

export function day(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    throw httpError(400, "invalid_day");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw httpError(400, "invalid_day");
  return value;
}

export type Page = { limit: number; offset: number };
export function queryInput(query: Record<string, unknown>, allowed: string[]): void {
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key) || typeof value !== "string") throw httpError(400, "invalid_query");
  }
}
export function page(query: Record<string, unknown>): Page {
  function integer(value: unknown, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^\d+$/.test(value)) throw httpError(400, "invalid_pagination");
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) throw httpError(400, "invalid_pagination");
    return n;
  }
  return { limit: integer(query.limit, 25, 1, 100), offset: integer(query.offset, 0, 0, Number.MAX_SAFE_INTEGER) };
}
