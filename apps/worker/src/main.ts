import { QUEUE_WORK_REPORT } from "@helios/domain";
import { createPool, appUrl } from "@helios/api/db";
import { createBoss, ensureQueue, processReportJob, type WorkReportJob } from "@helios/api/jobs";

const pool = createPool();
const boss = createBoss();
await boss.start();
await ensureQueue(boss);
await boss.work<WorkReportJob>(QUEUE_WORK_REPORT, { localConcurrency: 2, localGroupConcurrency: 1 }, async (job) => {
  const jobs = Array.isArray(job) ? job : [job];
  for (const item of jobs) await processReportJob(pool, item.data);
});
console.log(`worker listening ${appUrl.replace(/:[^:@/]+@/, ":***@")}`);
