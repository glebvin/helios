import { useEffect, useRef, useState } from "react";
import type { Session } from "./api";

// Readers share the same rule: only the response for this actor/context/retry
// can be displayed. A failed refresh must expose an error, not an old success.
export function useServerRead<T>(session: Session, key: string, blocked: string, load: () => Promise<T>, explain: (reason: unknown) => string) {
  const [pass, setPass] = useState(0);
  const [reading, setReading] = useState<{ scope: string; body: T | null; error: string } | null>(null);
  const loader = useRef(load);
  loader.current = load;
  const scope = JSON.stringify([session.token, session.tenantId, session.userId, key, blocked, pass]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setPass((value) => value + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  useEffect(() => {
    if (blocked) { setReading(null); return; }
    let live = true;
    void loader.current().then((body) => {
      if (live) setReading({ scope, body, error: "" });
    }, (reason: unknown) => {
      if (live) setReading({ scope, body: null, error: explain(reason) });
    });
    return () => { live = false; };
  }, [scope]);
  const ready = !blocked && reading?.scope === scope;
  return { body: ready ? reading.body : null, error: ready ? reading.error : "", loading: !blocked && !ready, retry: () => setPass((value) => value + 1) };
}
