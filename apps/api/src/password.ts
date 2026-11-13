import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

// OWASP Password Storage Cheat Sheet: scrypt minimum when Argon2id is not used.
// Keep the established stable scrypt API; Node's experimental Argon2 is not introduced here.
// Legacy rows stay readable and upgrade on login.
const legacy = { N: 16384, r: 8, p: 1 };
const current = { version: 2, N: 131072, r: 8, p: 1, keylen: 32, maxmem: 256 * 1024 * 1024 };
const workLimit = Number(process.env.HELIOS_PASSWORD_HASH_CONCURRENCY ?? 2);
if (!Number.isInteger(workLimit) || workLimit < 1 || workLimit > 2) throw new Error("HELIOS_PASSWORD_HASH_CONCURRENCY must be 1 or 2");

let active = 0;
const waiting: Array<() => void> = [];

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  // Compatibility bridge for the previous AuthService and legacy QA callers.
  // The live AuthService uses the bounded asynchronous checkPassword instead.
  const parsed = parseStored(stored);
  if (!parsed) return false;
  const params = parsed.kind === "current" ? current : { ...legacy, maxmem: 64 * 1024 * 1024 };
  const actual = scryptSync(password, parsed.salt, current.keylen, params);
  const expected = Buffer.from(parsed.hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordHashInFlight(): number {
  return active;
}

export function hashPasswordCurrent(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return withWork(async () => {
    const hash = (await derive(password, salt, "current")).toString("hex");
    return `scrypt:${current.version}:${current.N}:${current.r}:${current.p}:${salt}:${hash}`;
  });
}

export async function checkPassword(password: string, stored: string): Promise<{ ok: boolean; stale: boolean }> {
  const parsed = parseStored(stored);
  if (!parsed) return { ok: false, stale: false };
  const actual = await withWork(() => derive(password, parsed.salt, parsed.kind));
  const expected = Buffer.from(parsed.hash, "hex");
  const ok = actual.length === expected.length && timingSafeEqual(actual, expected);
  return { ok, stale: ok && parsed.kind === "legacy" };
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseStored(stored: string): { kind: "legacy" | "current"; salt: string; hash: string } | null {
  const parts = stored.split(":");
  if (parts.length === 3 && parts[0] === "scrypt" && parts[1] && isHex(parts[2] ?? "", 32)) {
    return { kind: "legacy", salt: parts[1], hash: parts[2] ?? "" };
  }
  if (
    parts.length === 7 &&
    parts[0] === "scrypt" &&
    parts[1] === String(current.version) &&
    parts[2] === String(current.N) &&
    parts[3] === String(current.r) &&
    parts[4] === String(current.p) &&
    parts[5] &&
    isHex(parts[6] ?? "", 32)
  ) {
    return { kind: "current", salt: parts[5], hash: parts[6] ?? "" };
  }
  return null;
}

function isHex(value: string, bytes: number): boolean {
  return value.length === bytes * 2 && /^[0-9a-f]+$/i.test(value);
}

function derive(password: string, salt: string, kind: "legacy" | "current"): Promise<Buffer> {
  const params = kind === "legacy"
    ? { N: legacy.N, r: legacy.r, p: legacy.p, maxmem: 64 * 1024 * 1024 }
    : { N: current.N, r: current.r, p: current.p, maxmem: current.maxmem };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, current.keylen, params, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

function take(): Promise<void> {
  if (active < workLimit) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
}

function finish(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

function withWork<T>(run: () => Promise<T>): Promise<T> {
  return take().then(async () => {
    try {
      return await run();
    } finally {
      finish();
    }
  });
}
