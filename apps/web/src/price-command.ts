export type PriceCommand = { requestId: string; workTypeId: string; price: string; start: string; end: string; expectedVersion: number };
const memory = new Map<string, PriceCommand>();
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readPriceCommand(key: string, storage: () => Store = () => sessionStorage): PriceCommand | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const row = JSON.parse(storage().getItem(key) ?? "null") as PriceCommand | null;
    if (row && /^[0-9a-f-]{36}$/i.test(row.requestId) && /^[0-9a-f-]{36}$/i.test(row.workTypeId) && typeof row.price === "string" && typeof row.start === "string" && typeof row.end === "string" && Number.isSafeInteger(row.expectedVersion) && row.expectedVersion >= 0) {
      memory.set(key, row); return row;
    }
  } catch { /* An unavailable store does not erase the in-memory command. */ }
  return null;
}
export function keepPriceCommand(key: string, body: PriceCommand, storage: () => Store = () => sessionStorage) {
  const copy = { ...body }; memory.set(key, copy);
  try { storage().setItem(key, JSON.stringify(copy)); } catch { /* Retry retains the original command in memory. */ }
  return copy;
}
export function clearPriceCommand(key: string, storage: () => Store = () => sessionStorage) {
  memory.delete(key);
  try { storage().removeItem(key); } catch { /* The current page has the confirmed result. */ }
}
