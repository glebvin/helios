type Held = { signature: string; requestId: string };
const held = new Map<string, Held>();
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function templateCommand(key: string, signature: string, createId: () => string, storage: () => Store = () => sessionStorage) {
  let previous = held.get(key);
  if (!previous) try {
    const saved = JSON.parse(storage().getItem(key) ?? "null") as Held | null;
    if (saved && typeof saved.signature === "string" && typeof saved.requestId === "string" && /^[0-9a-f-]{36}$/i.test(saved.requestId)) previous = saved;
  } catch { /* Browser storage may be unavailable. */ }
  if (!previous || previous.signature !== signature) previous = { signature, requestId: createId() };
  held.set(key, previous);
  try { storage().setItem(key, JSON.stringify(previous)); } catch { /* Keep retry identity in memory. */ }
  return previous.requestId;
}
export function confirmedTemplateCommand(key: string, storage: () => Store = () => sessionStorage) {
  held.delete(key);
  try { storage().removeItem(key); } catch { /* The current page received confirmation. */ }
}
