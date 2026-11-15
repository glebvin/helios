import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Pool, PoolClient } from "pg";
import { httpError } from "./errors.js";

export function normalizePhone(value: unknown): string {
  if (typeof value !== "string") throw httpError(400, "invalid_phone");
  const raw = value.trim().replace(/[\s()-]/g, "");
  const phone = /^8\d{10}$/.test(raw) ? `+7${raw.slice(1)}` : /^7\d{10}$/.test(raw) ? `+${raw}` : raw;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw httpError(400, "invalid_phone");
  return phone;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 2)} ··· ${phone.slice(-2)}`;
}

function secret(): string {
  const value = process.env.HELIOS_PHONE_CODE_SECRET ?? "";
  if (value.length < 32) throw httpError(503, "delivery_unavailable");
  return value;
}

export function hashPhoneCode(phone: string, purpose: string, invitationId: string | null, code: string): string {
  return createHmac("sha256", secret()).update(`${purpose}\n${phone}\n${invitationId ?? ""}\n${code}`).digest("hex");
}

function sameHash(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function rememberForQa(phone: string, code: string) {
  if (process.env.HELIOS_PHONE_PROVIDER !== "synthetic") throw httpError(503, "delivery_unavailable");
  const dir = process.env.HELIOS_PHONE_QA_DIR ?? "";
  if (!dir || dir.includes("..")) throw httpError(503, "delivery_unavailable");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = `${dir}/codes.json`;
  let current: Record<string, string> = {};
  try { current = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>; } catch { current = {}; }
  current[phone] = code;
  writeFileSync(file, JSON.stringify(current), { mode: 0o600 });
}

function limited() {
  const error = httpError(429, "phone_rate_limited") as ReturnType<typeof httpError> & { retryAfter: number };
  error.retryAfter = 60;
  return error;
}

/** Issues one code or repeats the same command. The plaintext code is not returned. */
export async function issuePhoneCode(client: PoolClient, phone: string, purpose: "join" | "login", requestId: string, invitationId: string | null) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`phone:${phone}`]);
  const same = (await client.query(
    `SELECT phone, invitation_id FROM phone_challenges WHERE purpose = $1 AND request_id = $2`,
    [purpose, requestId],
  )).rows[0];
  if (same) {
    if (same.phone !== phone || same.invitation_id !== invitationId) throw httpError(409, "request_conflict");
    return { sent: true };
  }
  const recent = (await client.query(
    `SELECT count(*)::int AS n, max(created_at) AS last FROM phone_challenges WHERE phone = $1 AND created_at > now() - interval '10 minutes'`,
    [phone],
  )).rows[0];
  if (recent.last && Date.now() - new Date(recent.last).getTime() < 60_000) throw limited();
  if (recent.n >= 5) throw limited();
  await client.query(
    `UPDATE phone_challenges SET consumed_at = now() WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND invitation_id IS NOT DISTINCT FROM $3`,
    [phone, purpose, invitationId],
  );
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await client.query(
    `INSERT INTO phone_challenges(phone, purpose, invitation_id, code_hash, request_id, expires_at) VALUES($1,$2,$3,$4,$5, now() + interval '5 minutes')`,
    [phone, purpose, invitationId, hashPhoneCode(phone, purpose, invitationId, code), requestId],
  );
  rememberForQa(phone, code);
  return { sent: true };
}

function phoneFailure(purpose: "join" | "login", message: string, challengeId: string, kind: "attempt" | "consume") {
  const error = httpError(401, purpose === "login" ? "unauthorized" : message) as ReturnType<typeof httpError> & { challengeId: string; phoneFailure: "attempt" | "consume" };
  error.challengeId = challengeId;
  error.phoneFailure = kind;
  return error;
}

/** A wrong or dead code records its bookkeeping after the caller's transaction rolls back. */
export async function settlePhoneFailure(pool: Pool, error: unknown) {
  const failure = error as { challengeId?: string; phoneFailure?: string };
  if (!failure.challengeId) return;
  if (failure.phoneFailure === "attempt") {
    await pool.query(
      `UPDATE phone_challenges SET attempts = attempts + 1, consumed_at = CASE WHEN attempts + 1 >= 5 THEN now() ELSE consumed_at END WHERE id = $1 AND consumed_at IS NULL`,
      [failure.challengeId],
    );
  }
  if (failure.phoneFailure === "consume") {
    await pool.query(`UPDATE phone_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL`, [failure.challengeId]);
  }
}

export async function takePhoneCode(client: PoolClient, phone: string, purpose: "join" | "login", invitationId: string | null, code: string) {
  if (!/^\d{6}$/.test(code)) throw httpError(400, "invalid_code");
  const row = (await client.query(
    `SELECT id, code_hash, expires_at <= now() AS expired, consumed_at, attempts
     FROM phone_challenges WHERE phone = $1 AND purpose = $2 AND invitation_id IS NOT DISTINCT FROM $3
     ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [phone, purpose, invitationId],
  )).rows[0];
  if (!row) throw httpError(401, purpose === "login" ? "unauthorized" : "code_invalid");
  if (row.consumed_at) throw httpError(401, purpose === "login" ? "unauthorized" : "code_used");
  if (row.expired) throw phoneFailure(purpose, "code_expired", row.id, "consume");
  if (row.attempts >= 5) throw phoneFailure(purpose, "code_locked", row.id, "consume");
  const ok = sameHash(hashPhoneCode(phone, purpose, invitationId, code), row.code_hash);
  if (!ok) throw phoneFailure(purpose, "code_invalid", row.id, "attempt");
  const taken = await client.query(`UPDATE phone_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id`, [row.id]);
  if (!taken.rowCount) throw httpError(401, purpose === "login" ? "unauthorized" : "code_used");
}
