import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Pool } from "pg";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { checkPassword, hashPasswordCurrent, hashToken, newToken, passwordBusy } from "./password.js";
import type { Actor } from "./workforce.service.js";
import { uuid } from "./api-input.js";
import { readOnlyCabinetRoles } from "./cabinet-roles.js";
import { isKnownRole, isExistingRuntimeRole } from "./role-catalog.js";
import { consumeLogin, loginLimited } from "./auth-protection.js";
import { issuePhoneCode, normalizePhone, settlePhoneFailure, takePhoneCode } from "./phone-code.js";

@Injectable()
export class AuthService {
  constructor(private readonly pool: Pool) {}

  async login(body: unknown) {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw httpError(400, "invalid_login");
    const { email, password } = body as Record<string, unknown>;
    if (typeof email !== "string" || !email.trim() || email.length > 320 ||
        typeof password !== "string" || !password || password.length > 1024) throw httpError(400, "invalid_login");
    const user = await this.pool.query(
      `SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1`,
      [email.trim().toLowerCase()],
    );
    const row = user.rows[0];
    const retryAfter = consumeLogin(email, !!row);
    if (retryAfter) throw loginLimited(retryAfter);
    let verdict = { ok: false, stale: false };
    try {
      if (row) verdict = await checkPassword(password, row.password_hash);
    } catch (error) {
      if (passwordBusy(error)) throw loginLimited(1);
      throw error;
    }
    if (!row || !verdict.ok) throw httpError(401, "unauthorized");
    if (verdict.stale) {
      try {
        const nextHash = await hashPasswordCurrent(password);
        await this.pool.query(
          `UPDATE users SET password_hash = $1 WHERE id = $2 AND password_hash = $3`,
          [nextHash, row.id, row.password_hash],
        );
      } catch (error) {
        if (!passwordBusy(error)) throw error;
      }
    }
    const token = newToken();
    await this.pool.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '12 hours')`,
      [row.id, hashToken(token)],
    );
    const memberships = await this.pool.query(`SELECT tenant_id, role, status FROM memberships_for_login($1)`, [row.id]);
    return { token, user: { id: row.id, email: row.email, name: row.name }, memberships: memberships.rows };
  }

  async actor(token: string, tenantId: string): Promise<Actor | null> {
    uuid(tenantId);
    const session = await this.pool.query(
      `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
      [hashToken(token)],
    );
    const userId = session.rows[0]?.user_id as string | undefined;
    if (!userId) throw httpError(401, "unauthorized");
    return withTenant(this.pool, tenantId, userId, async (client) => {
      const membership = await client.query(
        `SELECT m.role, u.name, u.email
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         WHERE m.user_id = $1 AND m.status = 'active'`,
        [userId],
      );
      const row = membership.rows[0];
      if (!row) return null;
      return { userId, tenantId, role: row.role as string, name: row.name as string, email: row.email as string };
    });
  }

  async phoneChallenge(body: unknown) {
    const value = this.phoneBody(body, ["phone", "requestId"]);
    const phone = normalizePhone(value.phone);
    const requestId = uuid(value.requestId).toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const sent = await issuePhoneCode(client, phone, "login", requestId, null);
      await client.query("COMMIT");
      return sent;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async phoneLogin(body: unknown) {
    const value = this.phoneBody(body, ["phone", "code"]);
    const phone = normalizePhone(value.phone);
    if (typeof value.code !== "string") throw httpError(400, "invalid_code");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await takePhoneCode(client, phone, "login", null, value.code);
      const identity = (await client.query(`SELECT user_id FROM phone_identities WHERE phone = $1`, [phone])).rows[0];
      if (!identity) {
        await client.query("COMMIT");
        throw httpError(401, "unauthorized");
      }
      const user = (await client.query(`SELECT id, email, name FROM users WHERE id = $1`, [identity.user_id])).rows[0];
      const token = newToken();
      await client.query(
        `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '12 hours')`,
        [user.id, hashToken(token)],
      );
      await client.query("COMMIT");
      const memberships = await this.pool.query(`SELECT tenant_id, role, status FROM memberships_for_login($1)`, [user.id]);
      return { token, user: { id: user.id, email: user.email, name: user.name }, memberships: memberships.rows };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      await settlePhoneFailure(this.pool, error);
      throw error;
    } finally { client.release(); }
  }

  private phoneBody(body: unknown, keys: string[]) {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw httpError(400, "invalid_input");
    const value = body as Record<string, unknown>;
    if (Object.keys(value).some((key) => !keys.includes(key))) throw httpError(400, "invalid_input");
    return value;
  }

  async logout(token: string) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
    return { ok: true };
  }
}

export type ActorRequest = {
  headers: Record<string, unknown>;
  method?: string;
  path?: string;
  rawHeaders?: string[];
  actor?: Actor;
  sessionToken?: string;
};

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const headerNames = (request.rawHeaders ?? []).filter((_, index) => index % 2 === 0).map((name) => name.toLowerCase());
    if (headerNames.filter((name) => name === "authorization").length > 1) throw httpError(401, "unauthorized");
    if (headerNames.filter((name) => name === "x-tenant-id").length > 1) throw httpError(400, "invalid_uuid");
    const header = request.headers.authorization;
    if (typeof header !== "string" || !/^Bearer [0-9a-f]{64}$/i.test(header)) throw httpError(401, "unauthorized");
    const tenantId = uuid(request.headers["x-tenant-id"]);
    const token = header.slice(7);
    const actor = await this.auth.actor(token, tenantId);
    if (!actor) throw httpError(403, "tenant_denied");
    if (!isKnownRole(actor.role)) throw httpError(403, "role_denied");
    const identityRoute = (["GET", "HEAD"].includes(request.method ?? "") && request.path === "/api/v1/me") ||
      (request.method === "POST" && request.path === "/api/v1/auth/logout");
    if (!isExistingRuntimeRole(actor.role) && !identityRoute) throw httpError(403, "role_denied");
    const routeConfigurationWrite = actor.role === "admin" && request.method === "POST" &&
      /^\/api\/v1\/projects\/[0-9a-f-]{36}\/route-config\/?$/i.test(request.path ?? "");
    // This exception reaches only the route service, which reloads role/project scope from DB.
    if (readOnlyCabinetRoles.has(actor.role) && !routeConfigurationWrite &&
        !["GET", "HEAD"].includes(request.method ?? "") && request.path !== "/api/v1/auth/logout") {
      throw httpError(403, "role_denied");
    }
    request.actor = actor;
    request.sessionToken = token;
    return true;
  }
}

export function actorOf(request: ActorRequest): Actor {
  if (!request.actor) throw httpError(403, "tenant_denied");
  return request.actor;
}
