export type ImportCommand = { requestId: string; organizationId: string; fileBase64: string; verdictHash: string };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memory = new Map<string, ImportCommand>();

export function readImportCommand(key: string, storage: () => Store = () => sessionStorage): ImportCommand | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const row = JSON.parse(storage().getItem(key) ?? "null") as ImportCommand | null;
    if (row && /^[0-9a-f-]{36}$/i.test(row.requestId) && /^[0-9a-f-]{36}$/i.test(row.organizationId) && typeof row.fileBase64 === "string" && row.fileBase64.length <= 1_400_000 && /^[0-9a-f]{64}$/.test(row.verdictHash)) {
      memory.set(key, row); return row;
    }
  } catch { /* Memory retains uncertain commands when browser storage is unavailable. */ }
  return null;
}
export function keepImportCommand(key: string, body: ImportCommand, storage: () => Store = () => sessionStorage) {
  const copy = { ...body }; memory.set(key, copy);
  try { storage().setItem(key, JSON.stringify(copy)); } catch { /* The current page can still retry the original command. */ }
  return copy;
}
export function clearImportCommand(key: string, storage: () => Store = () => sessionStorage) {
  memory.delete(key);
  try { storage().removeItem(key); } catch { /* The response already resolved this command. */ }
}
