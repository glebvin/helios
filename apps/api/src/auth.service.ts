import { Injectable } from "@nestjs/common";
import type { Pool } from "pg";
import { withTenant } from "./db.js";
import { httpError } from "./errors.js";
import { hashToken, newToken, verifyPassword } from "./password.js";
import type { Actor } from "./workforce.service.js";

@Injectable()
export class AuthService {
  constructor(private readonly pool: Pool) {}

  async login(email: string, password: string) {
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
    if (!token || !tenantId) return null;
    const session = await this.pool.query(
      `SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()`,
      [hashToken(token)],
    );
    const userId = session.rows[0]?.user_id as string | undefined;
    if (!userId) return null;
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
}
