export type PriceImportRow = { workTypeName: string; price: string; start: string; end: string };
export type PriceImportCommand = { requestId: string; text: string; rows: PriceImportRow[] };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memory = new Map<string, PriceImportCommand>();

export function readPriceImport(key: string, storage: () => Store = () => sessionStorage): PriceImportCommand | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const row = JSON.parse(storage().getItem(key) ?? "null") as PriceImportCommand | null;
    if (row && /^[0-9a-f-]{36}$/i.test(row.requestId) && typeof row.text === "string" && Array.isArray(row.rows) && row.rows.length > 0 && row.rows.length <= 50 && row.rows.every(item => item && [item.workTypeName, item.price, item.start, item.end].every(value => typeof value === "string"))) {
      memory.set(key, row); return row;
    }
  } catch { /* A damaged or unavailable store must not break the form. */ }
  return null;
}

export function keepPriceImport(key: string, command: PriceImportCommand, storage: () => Store = () => sessionStorage) {
  const copy: PriceImportCommand = { ...command, rows: command.rows.map(row => ({ ...row })) };
  memory.set(key, copy);
  try { storage().setItem(key, JSON.stringify(copy)); } catch { /* Keep the exact request in memory for retry. */ }
  return copy;
}

export function clearPriceImport(key: string, requestId: string, storage: () => Store = () => sessionStorage) {
  if (readPriceImport(key, storage)?.requestId !== requestId) return;
  memory.delete(key);
  try { storage().removeItem(key); } catch { /* The response already confirmed the request. */ }
}
