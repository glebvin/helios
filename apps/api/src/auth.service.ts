import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Pool } from "pg";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { hashToken, newToken, verifyPassword } from "./password.js";
import type { Actor } from "./workforce.service.js";
import { uuid } from "./api-input.js";
import { readOnlyCabinetRoles } from "./cabinet-roles.js";

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
    if (!row || !verifyPassword(password, row.password_hash)) throw httpError(401, "unauthorized");
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
    if (readOnlyCabinetRoles.has(actor.role) &&
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
