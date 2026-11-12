type StorageAccess = () => Pick<Storage, "getItem" | "setItem">;
type Attempt = { signature: string; requestId: string };
const attempts = new Map<string, Attempt>();

// Keep uncertain commands in memory as well as storage: storage can be blocked
// or full, and a lost response must not turn a retry into another command.
export function timeDecisionId(key: string, signature: string, storage: StorageAccess = () => sessionStorage) {
  let attempt = attempts.get(key);
  if (attempt?.signature === signature) return attempt.requestId;
  try {
    const saved = JSON.parse(storage().getItem(key) ?? "null") as Attempt | null;
    if (saved?.signature === signature && typeof saved.requestId === "string" && /^[0-9a-f-]{36}$/i.test(saved.requestId)) attempt = saved;
  } catch { /* The memory copy also works without browser storage. */ }
  if (attempt?.signature !== signature) attempt = { signature, requestId: crypto.randomUUID() };
  attempts.set(key, attempt);
  try { storage().setItem(key, JSON.stringify(attempt)); } catch { /* Keep the memory copy for retry. */ }
  return attempt.requestId;
}
