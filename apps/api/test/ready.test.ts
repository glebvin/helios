import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectReady, evidenceCheck, workerCheck, writeWorkerHeartbeat } from "../src/ready.js";

test("сбой базы виден и секрет не попадает в сигнал", async () => {
  const lines: string[] = [];
  const report = await collectReady({
    db: () => Promise.reject(new Error("postgres://helios:secret@127.0.0.1/helios")),
    evidence: async () => "ok",
    queue: async () => true,
    worker: async () => "not_configured",
    log: (line) => lines.push(line),
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.db, "down");
  assert.equal(report.checks.backup, "not_configured");
  assert.deepEqual(lines, ["ready db"]);
  assert.equal(JSON.stringify(report).includes("secret"), false);
});

test("файлы, очередь и отметка работника читаются отдельно", async () => {
  const root = await mkdtemp(join(tmpdir(), "helios-ready-"));
  assert.equal(await evidenceCheck(root), "ok");
  assert.equal(await evidenceCheck(root, async () => ({ bavail: 0, bsize: 4096 })), "full");
  assert.equal(await evidenceCheck(join(root, "missing")), "missing");
  const beat = join(root, "worker");
  await writeWorkerHeartbeat(beat);
  assert.equal(await readFile(beat, "utf8"), "ok\n");
  assert.equal((await stat(beat)).mode & 0o777, 0o600);
  assert.equal(await workerCheck(beat, Date.now()), "ok");
  const old = new Date(Date.now() - 60_000);
  await utimes(beat, old, old);
  assert.equal(await workerCheck(beat, Date.now()), "stale");
  assert.equal(await workerCheck(undefined, Date.now()), "not_configured");
  const recovered = await collectReady({
    db: async () => undefined,
    evidence: async () => "ok",
    queue: async () => true,
    worker: () => workerCheck(beat, Date.now()),
  });
  assert.equal(recovered.ok, false);
  await writeWorkerHeartbeat(beat);
  const again = await collectReady({
    db: async () => undefined,
    evidence: async () => "ok",
    queue: async () => true,
    worker: () => workerCheck(beat, Date.now()),
  });
  assert.equal(again.ok, true);
  assert.equal(again.checks.backup, "not_configured");
});
