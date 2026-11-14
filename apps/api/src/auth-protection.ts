// The login limit is per normalized email after the body is parsed.
// X-Forwarded-For is not a client key: there is no trusted-proxy contract.
// Unknown accounts share a separate bucket, so invented emails cannot fill the known-account table.
import { httpError } from "./errors.js";

const windowMs = 60_000;
const accountLimit = 40;
// Above the specified 2,000-profile scale; only database-confirmed accounts allocate entries.
const maxLoginBuckets = 4096;

type Bucket = { count: number; until: number };
type Reply = { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (body: unknown) => void } };
export type Protection = ((req: any, res: any, next: () => void) => void) & {
  takeLogin: (email: string, knownAccount?: boolean) => number | null;
  bucketCount: () => number;
};

const unbound = { takeLogin: (_email: string, _knownAccount?: boolean): number | null => null };
let active: { takeLogin: (email: string, knownAccount?: boolean) => number | null } = unbound;

export function bindAuthProtection(protection: { takeLogin: (email: string, knownAccount?: boolean) => number | null }) {
  active = protection;
}

export function consumeLogin(email: string, knownAccount: boolean) {
  return active.takeLogin(email, knownAccount);
}

export function loginLimited(retryAfter: number) {
  const error = httpError(429, "auth_rate_limited") as ReturnType<typeof httpError> & { retryAfter: number };
  error.retryAfter = Math.max(1, Math.ceil(retryAfter));
  return error;
}

export function authProtection(options?: { install?: boolean; now?: () => number }): Protection {
  const buckets = new Map<string, Bucket>();
  let overflow: Bucket | null = null;
  const now = () => options?.now?.() ?? Date.now();
  const middleware = ((req: any, res: any, next: () => void) => {
    res.setHeader("Cache-Control", "no-store");
    const path = (req.path ?? "").replace(/\/+$/, "").toLowerCase();
    const bucket = /^\/api\/v1\/join\/[^/]+$/.test(path) ? (req.method === "POST" ? "join" : "inspect") : null;
    if (bucket && charge(buckets, bucket, bucket === "inspect" ? 200 : 40, res, now())) return;
    next();
  }) as Protection;
  middleware.takeLogin = (email: string, knownAccount = true) => {
    const current = now();
    forgetExpired(buckets, current);
    if (overflow && overflow.until <= current) overflow = null;
    if (!knownAccount) return charge(buckets, "unknown", accountLimit, null, current);
    const normalized = email.trim().toLowerCase();
    const key = !normalized || normalized.length > 320 ? "login" : `login:${normalized}`;
    if (buckets.has(key) || countLoginBuckets(buckets) < maxLoginBuckets) return charge(buckets, key, accountLimit, null, current);
    if (!overflow) overflow = { count: 0, until: current + windowMs };
    return advance(overflow, accountLimit, current, null);
  };
  middleware.bucketCount = () => buckets.size;
  if (options?.install !== false) active = middleware;
  return middleware;
}

function forgetExpired(buckets: Map<string, Bucket>, current: number) {
  for (const [key, value] of buckets) if (value.until <= current) buckets.delete(key);
}

function countLoginBuckets(buckets: Map<string, Bucket>) {
  let count = 0;
  for (const key of buckets.keys()) if (key.startsWith("login")) count += 1;
  return count;
}

function charge(buckets: Map<string, Bucket>, key: string, limit: number, res: Reply | null, current: number) {
  let value = buckets.get(key);
  if (!value || value.until <= current) {
    value = { count: 0, until: current + windowMs };
    buckets.set(key, value);
  }
  return advance(value, limit, current, res);
}

function advance(value: Bucket, limit: number, current: number, res: Reply | null) {
  if (++value.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((value.until - current) / 1000));
  if (res) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: "auth_rate_limited" });
  }
  return retryAfter;
}
