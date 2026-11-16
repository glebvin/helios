export type MaterialCommand = { path: string; body: { requestId: string; [key: string]: unknown } };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memory = new Map<string, MaterialCommand>();

export function readMaterialCommand(key: string, storage: () => Store = () => sessionStorage): MaterialCommand | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const row = JSON.parse(storage().getItem(key) ?? "null") as MaterialCommand | null;
    if (row && typeof row.path === "string" && /^\/projects\/[0-9a-f-]{36}\/material-batches(?:\/[0-9a-f-]{36})?$/.test(row.path) && row.body && /^[0-9a-f-]{36}$/i.test(row.body.requestId)) {
      memory.set(key, row); return row;
    }
  } catch { /* Memory retains uncertain commands when browser storage is unavailable. */ }
  return null;
}
export function keepMaterialCommand(key: string, body: MaterialCommand, storage: () => Store = () => sessionStorage) {
  const copy = JSON.parse(JSON.stringify(body)) as MaterialCommand; memory.set(key, copy);
  try { storage().setItem(key, JSON.stringify(copy)); } catch { /* The current page can still retry the original command. */ }
  return copy;
}
export function clearMaterialCommand(key: string, storage: () => Store = () => sessionStorage) {
  memory.delete(key);
  try { storage().removeItem(key); } catch { /* The response already resolved this command. */ }
}
