import { addDecimal, cmpDecimal, divDecimal, mulDecimal, subDecimal } from "./decimal.js";

export type Authority = {
  active: boolean;
  project: string;
  documents: string[];
  start: string;
  end: string;
};

export type Lot = {
  quantity: string;
  required: string[];
  signed: string[];
  scAccepted: boolean;
  price: string | null;
};

export function validateRoute(steps: string[][]): boolean {
  const count = (letter: string) => steps.filter((step) => step.includes(letter)).length;
  return count("R") === 1 && count("S") <= 3 && count("U") <= 1;
}

export function maySign(
  authority: Authority | null | undefined,
  project: string,
  document: string,
  serverDate: string,
): boolean {
  if (!authority?.active) return false;
  return (
    authority.project === project &&
    authority.documents.includes(document) &&
    authority.start <= serverDate &&
    serverDate <= authority.end
  );
}

export function mayPublish(frontChecks: boolean[], materials: boolean[], predecessorSigned: boolean): boolean {
  return frontChecks.every(Boolean) && materials.every(Boolean) && predecessorSigned;
}

export function mayReinspect(defects: { resolved: boolean; verified: boolean }[]): boolean {
  return defects.every((defect) => defect.resolved && defect.verified);
}

/** Готовый объём и долг считаются по лотам, а не суммой площадей из нескольких актов. */
export function documentaryReadiness(lots: Lot[]): { ready: string; debt: string; debtRub: string | null } {
  let ready = "0";
  let debt = "0";
  let money = "0";
  let completePrice = true;
  for (const lot of lots) {
    const complete = lot.scAccepted && lot.required.every((item) => lot.signed.includes(item));
    if (complete) {
      ready = addDecimal(ready, lot.quantity);
    } else {
      debt = addDecimal(debt, lot.quantity);
      if (lot.price === null) completePrice = false;
      else money = addDecimal(money, mulDecimal(lot.quantity, lot.price));
    }
  }
  return { ready, debt, debtRub: completePrice ? money : null };
}

export function efficiency(quantity: string, norm: string | null, hours: string): string | null {
  if (norm === null || cmpDecimal(hours, "0") === 0) return null;
  return mulDecimal(divDecimal(mulDecimal(quantity, norm), hours), "100");
}

export function partialAcceptance(submitted: string, accepted: string): { accepted: string; difference: string } {
  if (cmpDecimal(accepted, "0") < 0 || cmpDecimal(accepted, submitted) > 0) {
    throw new Error("invalid_quantity");
  }
  return { accepted, difference: subDecimal(submitted, accepted) };
}

/** Бригадный объём остаётся одним фактом, без деления на людей. */
export function attributeCrewVolume(
  quantity: string,
  members: number,
): { scope: "crew"; quantity: string; members: number } {
  if (!Number.isInteger(members) || members < 1) throw new Error("crew_empty");
  if (cmpDecimal(quantity, "0") <= 0) throw new Error("invalid_quantity");
  return { scope: "crew", quantity, members };
}

export type ScopedEvent = { tenantId: string; userId: string };

export function assertSameScope(event: ScopedEvent, actor: ScopedEvent): void {
  if (event.tenantId !== actor.tenantId || event.userId !== actor.userId) {
    throw new Error("scope_mismatch");
  }
}

export function eventsForSync<T extends ScopedEvent & { status: string }>(items: T[], actor: ScopedEvent): T[] {
  return items.filter(
    (item) => item.status === "pending" && item.tenantId === actor.tenantId && item.userId === actor.userId,
  );
}

export function objectKey(tenantId: string, fileId: string, filename: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(fileId)) {
    throw new Error("bad_file_id");
  }
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("bad_filename");
  }
  return `${tenantId}/${fileId}/${filename}`;
}

export function keyBelongsToTenant(tenantId: string, key: string): boolean {
  return key.startsWith(`${tenantId}/`) && !key.includes("..");
}

export function stableEventBody(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
