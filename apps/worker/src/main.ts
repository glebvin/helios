import { QUEUE_WORK_REPORT } from "@helios/domain";
import { createPool } from "@helios/api/db";
import { createBoss, ensureQueue, processReportJob, type WorkReportJob } from "@helios/api/jobs";
import { startWorkerHeartbeat } from "@helios/api/ready";

const pool = createPool();
const boss = createBoss();
boss.on("error", () => console.error("worker_queue_unavailable"));
await boss.start();
await ensureQueue(boss);
await boss.work<WorkReportJob>(QUEUE_WORK_REPORT, { localConcurrency: 2, localGroupConcurrency: 1 }, async (job) => {
  const jobs = Array.isArray(job) ? job : [job];
  for (const item of jobs) await processReportJob(pool, item.data);
});
const heartbeat = process.env.HELIOS_WORKER_HEARTBEAT;
if (heartbeat) startWorkerHeartbeat(heartbeat, async () => {
  await pool.query("SELECT 1");
  if (!(await boss.getQueues([QUEUE_WORK_REPORT])).length) throw new Error("queue_missing");
});
console.log("worker listening");
