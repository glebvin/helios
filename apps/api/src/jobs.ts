import { createHash } from "node:crypto";
import { QUEUE_WORK_REPORT, stableEventBody } from "@helios/domain";
import type { Pool } from "pg";
import { PgBoss } from "pg-boss";
import { appUrl, withTenant } from "./db.js";

export type WorkReportJob = {
  tenantId: string;
  reportId: string;
  version: number;
  idempotencyKey: string;
};

const inflight = new Map<string, number>();
const maxPerTenant = 1;

export async function ensureQueue(boss: PgBoss): Promise<void> {
  const queues = await boss.getQueues();
  if (!queues.some((queue) => queue.name === QUEUE_WORK_REPORT)) {
    await boss.createQueue(QUEUE_WORK_REPORT, {
      retryLimit: 5,
      retryDelay: 1,
      expireInSeconds: 120,
    });
  }
}

export function createBoss(): PgBoss {
  return new PgBoss({ connectionString: appUrl, max: 4 });
}

/** Повторный запуск не создаёт второй эффект. Чужой контекст запроса сюда не протекает. */
export async function processReportJob(pool: Pool, job: WorkReportJob): Promise<{ applied: boolean }> {
  const current = inflight.get(job.tenantId) ?? 0;
  if (current >= maxPerTenant) throw new Error("tenant_busy");
  inflight.set(job.tenantId, current + 1);
  try {
    return await withTenant(pool, job.tenantId, null, async (client) => {
      const inserted = await client.query(
        `INSERT INTO report_effects (tenant_id, report_id, idempotency_key)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, report_id) DO NOTHING
         RETURNING report_id`,
        [job.tenantId, job.reportId, job.idempotencyKey],
      );
      return { applied: inserted.rowCount === 1 };
    });
  } finally {
    inflight.set(job.tenantId, Math.max(0, (inflight.get(job.tenantId) ?? 1) - 1));
  }
}

export function reportJob(tenantId: string, reportId: string, version: number): WorkReportJob {
  return {
    tenantId,
    reportId,
    version,
    idempotencyKey: createHash("sha256").update(stableEventBody({ tenantId, reportId, kind: "recorded" })).digest("hex"),
  };
}

export { QUEUE_WORK_REPORT };
