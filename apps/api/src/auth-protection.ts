// The login limit lives with the parsed account. Middleware cannot see the JSON body,
// and a shared proxy address or X-Forwarded-For must not become the client key.
type Protection = ((req: any, res: any, next: () => void) => void) & {
  takeLogin: (email: string) => number | null;
};

const active: { takeLogin: (email: string) => number | null } = { takeLogin: () => null };

export function bindAuthProtection(protection: Protection) {
  active.takeLogin = protection.takeLogin;
}

export function consumeLogin(email: string) {
  return active.takeLogin(email);
}

export function authProtection(): Protection {
  const buckets = new Map<string, { count: number; until: number }>();
  const middleware = ((req: any, res: any, next: () => void) => {
    res.setHeader("Cache-Control", "no-store");
    const path = (req.path ?? "").replace(/\/+$/, "").toLowerCase();
    const bucket = /^\/api\/v1\/join\/[^/]+$/.test(path) ? (req.method === "POST" ? "join" : "inspect") : null;
    if (bucket && limited(buckets, bucket, bucket === "inspect" ? 200 : 40, res)) return;
    next();
  }) as Protection;
  middleware.takeLogin = (email: string) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized || normalized.length > 320) return limited(buckets, "login", 40, null);
    return limited(buckets, `login:${normalized}`, 40, null);
  };
  return middleware;
}

function limited(buckets: Map<string, { count: number; until: number }>, key: string, limit: number, res: { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } } | null) {
  const now = Date.now();
  let value = buckets.get(key);
  if (!value || value.until <= now) {
    value = { count: 0, until: now + 60000 };
    buckets.set(key, value);
  }
  if (++value.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((value.until - now) / 1000));
  if (res) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "auth_rate_limited" });
  }
  return retryAfter;
}
