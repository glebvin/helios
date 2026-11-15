import { httpError } from "./errors.js";
import { day, uuid } from "./api-input.js";
import { integer, object, text } from "./people-input.js";
import { routeDefinitions } from "./route-config.js";

export const responsibilityDocumentTypes = routeDefinitions.map((item) => item.code);
const documentTitles = new Map(routeDefinitions.map((item) => [item.code, item.title]));

export type ResponsibilityOrderFact = {
  id: string;
  employeeId: string;
  organizationId: string;
  projectId: string;
  documentTypes: readonly string[];
  validFrom: string;
  validUntil: string;
  status: "active" | "revoked";
};

export type ResponsibilityApplicability = {
  applicable: boolean;
  reason: "active" | "revoked" | "expired" | "not_started" | "type" | "object" | "company" | "person";
  orderId: string | null;
};

export function documentTypeCatalog() {
  return responsibilityDocumentTypes.map((code) => ({ code, title: documentTitles.get(code) ?? code }));
}

export function plusDays(dayText: string, days: number): string {
  const date = new Date(`${dayText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function expiringWithin30Days(status: string, validUntil: string, today: string): boolean {
  return status === "active" && validUntil >= today && validUntil <= plusDays(today, 30);
}

function types(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > responsibilityDocumentTypes.length) throw httpError(400, "invalid_document_types");
  const codes = value.map((item) => text(item, 80));
  if (new Set(codes).size !== codes.length || codes.some((code) => !responsibilityDocumentTypes.includes(code as typeof responsibilityDocumentTypes[number]))) {
    throw httpError(400, "invalid_document_types");
  }
  return [...codes].sort();
}

function period(orderDate: unknown, validFrom: unknown, validUntil: unknown) {
  const dates = { orderDate: day(orderDate), validFrom: day(validFrom), validUntil: day(validUntil) };
  if (!dates.orderDate || !dates.validFrom || !dates.validUntil || dates.validUntil < dates.validFrom) throw httpError(400, "invalid_interval");
  return dates as { orderDate: string; validFrom: string; validUntil: string };
}

export function responsibilityOrderCreate(input: unknown) {
  const body = object(input, ["requestId", "employeeId", "organizationId", "projectId", "documentTypes", "orderNumber", "orderDate", "validFrom", "validUntil"]);
  return {
    requestId: uuid(body.requestId).toLowerCase(),
    employeeId: uuid(body.employeeId).toLowerCase(),
    organizationId: uuid(body.organizationId).toLowerCase(),
    projectId: uuid(body.projectId).toLowerCase(),
    documentTypes: types(body.documentTypes),
    orderNumber: text(body.orderNumber, 80),
    ...period(body.orderDate, body.validFrom, body.validUntil),
  };
}

export function responsibilityOrderCorrect(input: unknown) {
  const body = object(input, ["requestId", "expectedVersion", "documentTypes", "orderNumber", "orderDate", "validFrom", "validUntil"]);
  return {
    requestId: uuid(body.requestId).toLowerCase(),
    expectedVersion: integer(body.expectedVersion),
    documentTypes: types(body.documentTypes),
    orderNumber: text(body.orderNumber, 80),
    ...period(body.orderDate, body.validFrom, body.validUntil),
  };
}

export function responsibilityOrderRevoke(input: unknown) {
  const body = object(input, ["requestId", "expectedVersion", "reason"]);
  return { requestId: uuid(body.requestId).toLowerCase(), expectedVersion: integer(body.expectedVersion), reason: text(body.reason, 500) };
}

export function orderApplies(orders: readonly ResponsibilityOrderFact[], query: {
  employeeId: string; organizationId: string; projectId: string; documentType: string; on: string;
}): ResponsibilityApplicability {
  const person = orders.filter((order) => order.employeeId === query.employeeId);
  if (!person.length) return { applicable: false, reason: "person", orderId: null };
  const company = person.filter((order) => order.organizationId === query.organizationId);
  if (!company.length) return { applicable: false, reason: "company", orderId: person[0]!.id };
  const objectOrders = company.filter((order) => order.projectId === query.projectId);
  if (!objectOrders.length) return { applicable: false, reason: "object", orderId: company[0]!.id };
  const typed = objectOrders.filter((order) => order.documentTypes.includes(query.documentType));
  if (!typed.length) return { applicable: false, reason: "type", orderId: objectOrders[0]!.id };
  const covering = typed.filter((order) => order.validFrom <= query.on && query.on <= order.validUntil);
  const active = covering.find((order) => order.status === "active");
  if (active) return { applicable: true, reason: "active", orderId: active.id };
  const revoked = covering.find((order) => order.status === "revoked");
  if (revoked) return { applicable: false, reason: "revoked", orderId: revoked.id };
  const current = typed.filter((order) => order.status === "active");
  const dated = current.length ? current : typed;
  const expired = dated.find((order) => order.validUntil < query.on);
  if (expired) return { applicable: false, reason: "expired", orderId: expired.id };
  const upcoming = dated.find((order) => order.validFrom > query.on);
  return { applicable: false, reason: "not_started", orderId: upcoming?.id ?? typed[0]!.id };
}
