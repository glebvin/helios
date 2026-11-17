export type ReviewCommand = {path: string; body: {requestId: string; expectedVersion: number; checklistRunId: string; acceptedQuantity: string; reason: string | null}};
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const memory = new Map<string, ReviewCommand>();
export function readReviewCommand(key: string, storage: () => Store = () => sessionStorage): ReviewCommand | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const row = JSON.parse(storage().getItem(key) ?? 'null') as ReviewCommand | null;
    if (row && /^\/projects\/[0-9a-f-]{36}\/volume-reviews\/[0-9a-f-]{36}$/i.test(row.path) && /^[0-9a-f-]{36}$/i.test(row.body?.requestId)) { memory.set(key, row); return row; }
  } catch { /* The current page can retry even if session storage is unavailable. */ }
  return null;
}
export function keepReviewCommand(key: string, command: ReviewCommand, storage: () => Store = () => sessionStorage) {
  const copy = JSON.parse(JSON.stringify(command)) as ReviewCommand;
  memory.set(key, copy);
  try { storage().setItem(key, JSON.stringify(copy)); } catch { /* Retain in memory until resolved. */ }
  return copy;
}
export function clearReviewCommand(key: string, requestId: string, storage: () => Store = () => sessionStorage) {
  if (readReviewCommand(key, storage)?.body.requestId !== requestId) return;
  memory.delete(key);
  try { storage().removeItem(key); } catch { /* A confirmed reply has already resolved it. */ }
}
