import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { HttpException } from "@nestjs/common";
import type { Pool, PoolClient } from "pg";
import { previewStaffImport, staffImportMaxBytes, type StaffImportRow } from "../../web/src/staff-import.js";
import { page, uuid } from "./api-input.js";
import { withTenant } from "./db.js";
import { completeCommand, replayCommand, reserveCommand, type CommandResult } from "./durable-command.js";
import { httpError } from "./errors.js";
import { object, text } from "./people-input.js";
import type { Actor } from "./workforce.service.js";

type Disposition = "create" | "present" | "invalid" | "conflict" | "ambiguous" | "foreign";
type Judged = {
  row: number; key: string; fullName: string; phone: string;
  disposition: Disposition; employeeId: string | null; version: number | null; detail: string;
};
type Existing = {
  id: string; fullName: string; phone: string | null; organizationId: string;
  personnelNumber: string | null; version: number;
};

const checkFields = ["organizationId", "fileBase64"] as const;
const confirmFields = ["requestId", "organizationId", "fileBase64", "verdictHash"] as const;

export class StaffImportService {
  constructor(private readonly pool: Pool) {}

  check(actor: Actor, input: unknown) {
    const body = object(input, [...checkFields]);
    const organizationId = uuid(body.organizationId).toLowerCase();
    const file = fileOf(body.fileBase64);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      await this.authorize(client, actor);
      await this.organization(client, organizationId, false);
      return this.verdict(client, organizationId, file, false);
    });
  }

  confirm(actor: Actor, input: unknown): Promise<CommandResult> {
    const body = object(input, [...confirmFields]);
    const requestId = uuid(body.requestId).toLowerCase();
    const organizationId = uuid(body.organizationId).toLowerCase();
    const verdictHash = text(body.verdictHash, 64);
    if (!/^[0-9a-f]{64}$/.test(verdictHash)) throw httpError(400, "invalid_text");
    const file = fileOf(body.fileBase64);
    const command = { requestId, organizationId, fileBase64: body.fileBase64, verdictHash };
    return this.command(actor, command, async (client) => {
      await this.organization(client, organizationId, true);
      await this.authorize(client, actor);
      const verdict = await this.verdict(client, organizationId, file, true);
      if (verdict.verdictHash !== verdictHash) throw httpError(409, "import_changed");
      if (!verdict.acceptable) throw httpError(422, "staff_import_rejected");
      const importId = randomUUID();
      const created = new Map<number, string>();
      for (const row of verdict.rows) {
        if (row.disposition !== "create") continue;
        const id = randomUUID();
        created.set(row.row, id);
        await client.query(
          `INSERT INTO employees(tenant_id,id,full_name,organization_id,phone,personnel_number)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [actor.tenantId, id, row.fullName, organizationId, row.phone || null, row.personnelNumber],
        );
      }
      const createdCount = verdict.rows.filter((row) => row.disposition === "create").length;
      const presentCount = verdict.rows.filter((row) => row.disposition === "present").length;
      await client.query(
        `INSERT INTO staff_imports(tenant_id,id,organization_id,actor_user_id,request_id,file_sha256,created_count,present_count)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [actor.tenantId, importId, organizationId, actor.userId, requestId, file.sha256, createdCount, presentCount],
      );
      for (const row of verdict.rows) {
        const employeeId = row.disposition === "create" ? created.get(row.row)! : row.employeeId;
        await client.query(
          `INSERT INTO staff_import_rows(tenant_id,import_id,row_number,personnel_number,full_name,phone,outcome,employee_id)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [actor.tenantId, importId, row.row, row.personnelNumber, row.fullName, row.phone || null, row.disposition === "create" ? "created" : "present", employeeId],
        );
      }
      return this.one(client, importId);
    });
  }

  list(actor: Actor, query: Record<string, unknown>) {
    const listed = page(query);
    return withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
      await this.authorize(client, actor);
      const total = (await client.query(`SELECT count(*)::int AS total FROM staff_imports`)).rows[0].total as number;
      const ids = (await client.query(
        `SELECT id FROM staff_imports ORDER BY created_at DESC, id LIMIT $1 OFFSET $2`,
        [listed.limit, listed.offset],
      )).rows.map((row) => row.id as string);
      const items = [];
      for (const id of ids) items.push(await this.one(client, id));
      return { items, total, ...listed };
    });
  }

  private async command(actor: Actor, body: Record<string, unknown>, run: (client: PoolClient) => Promise<Record<string, unknown>>) {
    try {
      return await withTenant(this.pool, actor.tenantId, actor.userId, async (client) => {
        await this.authorize(client, actor);
        const { inserted, hash } = await reserveCommand(client, actor, "POST /staff-imports", body);
        await this.authorize(client, actor);
        if (!inserted) return replayCommand(client, actor, String(body.requestId), hash);
        const result = await run(client);
        return completeCommand(client, actor, String(body.requestId), 201, result);
      });
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (code === "23505") throw httpError(409, "import_changed");
      if (code === "23503" || code === "23514") throw httpError(422, "reference_denied");
      throw error;
    }
  }

  private async authorize(client: PoolClient, actor: Actor) {
    if (actor.role !== "director" && actor.role !== "hr") throw httpError(403, "role_denied");
    const membership = await client.query(
      `SELECT 1 FROM memberships WHERE user_id=$1 AND role=$2 AND status='active' FOR SHARE`,
      [actor.userId, actor.role],
    );
    if (!membership.rowCount) throw httpError(403, "role_denied");
  }

  private async organization(client: PoolClient, id: string, lock: boolean) {
    const result = await client.query(
      `SELECT 1 FROM organizations WHERE id=$1${lock ? " FOR NO KEY UPDATE" : ""}`,
      [id],
    );
    if (!result.rowCount) throw httpError(422, "organization_denied");
  }

  private async verdict(client: PoolClient, organizationId: string, file: { bytes: Uint8Array; sha256: string }, lock: boolean) {
    let preview: Awaited<ReturnType<typeof previewStaffImport>>;
    try {
      preview = await previewStaffImport(file.bytes, (data, limit) => {
        const inflated = inflateRawSync(data, { maxOutputLength: Math.max(1, limit) });
        if (inflated.length > limit) throw new Error("inflate");
        return inflated;
      });
    } catch {
      preview = { fileError: "Файл не читается как книга Excel.", rows: [], saved: false };
    }
    const rows = preview.fileError ? [] : judge(preview.rows, await this.existing(client, organizationId, preview.rows, lock), organizationId);
    const acceptable = !preview.fileError && rows.length > 0 && rows.every((row) => row.disposition === "create" || row.disposition === "present");
    return {
      organizationId,
      fileSha256: file.sha256,
      verdictHash: hashVerdict(organizationId, file.sha256, rows),
      acceptable,
      fileError: preview.fileError,
      rows: rows.map((row) => ({
        row: row.row,
        personnelNumber: row.key,
        fullName: row.fullName,
        phone: row.phone,
        disposition: row.disposition,
        detail: row.detail,
        employeeId: row.employeeId,
      })),
    };
  }

  private async existing(client: PoolClient, organizationId: string, rows: StaffImportRow[], lock: boolean): Promise<Existing[]> {
    const numbers = [...new Set(rows.map((row) => row.key.trim().toLowerCase()).filter(Boolean))];
    const phones = [...new Set(rows.map((row) => row.phone).filter(Boolean))];
    if (!numbers.length && !phones.length) return [];
    const result = await client.query(
      `SELECT id, full_name AS "fullName", phone, organization_id AS "organizationId",
              personnel_number AS "personnelNumber", version
       FROM employees
       WHERE (organization_id=$1 AND personnel_number IS NOT NULL AND lower(personnel_number)=ANY($2::text[]))
          OR (phone IS NOT NULL AND phone=ANY($3::text[]))
       ${lock ? "FOR NO KEY UPDATE" : ""}`,
      [organizationId, numbers, phones],
    );
    return result.rows;
  }

  private async one(client: PoolClient, id: string) {
    const head = (await client.query(
      `SELECT i.id, i.organization_id AS "organizationId", i.actor_user_id AS "actorUserId",
              u.name AS "actorName", i.created_at AS "createdAt", i.created_count AS "createdCount",
              i.present_count AS "presentCount"
       FROM staff_imports i JOIN users u ON u.id=i.actor_user_id WHERE i.id=$1`,
      [id],
    )).rows[0];
    const rows = (await client.query(
      `SELECT row_number AS "row", personnel_number AS "personnelNumber", full_name AS "fullName",
              phone, outcome, employee_id AS "employeeId"
       FROM staff_import_rows WHERE import_id=$1 ORDER BY row_number`,
      [id],
    )).rows.map((row) => ({ ...row, phone: row.phone ?? "" }));
    return {
      ...head,
      createdAt: new Date(head.createdAt).toISOString(),
      rows,
    };
  }
}

function fileOf(value: unknown) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0 || value.length > 1_400_000) {
    throw httpError(400, "invalid_body");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (bytes.length > staffImportMaxBytes) throw httpError(422, "staff_import_rejected");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function judge(parsed: StaffImportRow[], existing: Existing[], organizationId: string): Judged[] {
  const phonesInFile = new Map<string, number>();
  for (const row of parsed) if (row.phone) phonesInFile.set(row.phone, (phonesInFile.get(row.phone) ?? 0) + 1);
  const byNumber = new Map<string, Existing[]>();
  const byPhone = new Map<string, Existing>();
  for (const employee of existing) {
    if (employee.personnelNumber && employee.organizationId === organizationId) {
      const key = employee.personnelNumber.toLowerCase();
      byNumber.set(key, [...(byNumber.get(key) ?? []), employee]);
    }
    if (employee.phone) byPhone.set(employee.phone, employee);
  }
  return parsed.map((row) => {
    if (row.errors.length) return judged(row, "invalid", null, row.errors.join(" "));
    if ((phonesInFile.get(row.phone) ?? 0) > 1) return judged(row, "invalid", null, "Телефон повторяется в этом файле. Пакет не делится.");
    const numbered = byNumber.get(row.key.trim().toLowerCase()) ?? [];
    const phoned = row.phone ? byPhone.get(row.phone) : undefined;
    if (numbered.length > 1) return judged(row, "ambiguous", null, "Табельный номер совпал с несколькими карточками. Нужен явный разбор.");
    const sameNumber = numbered[0];
    if (sameNumber && phoned && sameNumber.id !== phoned.id) return judged(row, "ambiguous", null, "Строка совпала с двумя разными карточками. Нужен явный разбор.");
    if (phoned && phoned.organizationId !== organizationId) return judged(row, "foreign", null, "Телефон уже у карточки другого работодателя.");
    if (sameNumber) {
      const same = sameNumber.fullName === row.fullName && (sameNumber.phone ?? "") === row.phone;
      return same
        ? judged(row, "present", sameNumber, "Карточка с этим табельным номером уже есть. Создание не нужно.")
        : judged(row, "conflict", sameNumber, "Табельный номер уже есть у карточки с другими данными. Запись не перезаписывается.");
    }
    if (phoned) return judged(row, "ambiguous", phoned, "Телефон уже у другой карточки. Совпадение неоднозначно.");
    return judged(row, "create", null, "Новая карточка.");
  });
}

function judged(row: StaffImportRow, disposition: Disposition, employee: Existing | null, detail: string): Judged {
  return {
    row: row.row, key: row.key, fullName: row.fullName, phone: row.phone, disposition,
    employeeId: employee?.id ?? null, version: employee?.version ?? null, detail,
  };
}

function hashVerdict(organizationId: string, fileSha256: string, rows: Judged[]) {
  const packed = rows.map((row) => [row.row, row.key, row.fullName, row.phone, row.disposition, row.employeeId, row.version]);
  return createHash("sha256").update(JSON.stringify([organizationId, fileSha256, packed])).digest("hex");
}
