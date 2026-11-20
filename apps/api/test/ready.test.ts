import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, utimes, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cachedReadiness, collectReady, evidenceCheck, startWorkerHeartbeat, workerCheck, writeWorkerHeartbeat } from "../src/ready.js";

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

test('stalled dependency is bounded and does not prevent other observations', async () => {
  const started=Date.now();
  const report=await collectReady({db:()=>new Promise(()=>{}),queue:async()=>true,evidence:async()=>"ok",worker:async()=>"ok",log:()=>{}},30);
  assert.equal(report.ok,false);assert.equal(report.checks.db,"down");assert.equal(report.checks.queue,"ok");assert.ok(Date.now()-started<1000);
});

test('concurrent polling shares a probe and outage/recovery logs only transitions',async()=>{
  let calls=0,healthy=false;const lines:string[]=[];
  const read=cachedReadiness({db:async()=>{calls++;await new Promise(r=>setTimeout(r,15));if(!healthy)throw new Error('private')},queue:async()=>true,evidence:async()=>"ok",worker:async()=>"ok",log:s=>lines.push(s)},20,200);
  const first=await Promise.all(Array.from({length:30},()=>read()));assert.equal(calls,1);assert.ok(first.every(x=>x.checks.db==='down'));
  await read();assert.equal(calls,1);await new Promise(r=>setTimeout(r,25));await read();assert.equal(calls,2);assert.deepEqual(lines,['ready db']);
  healthy=true;await new Promise(r=>setTimeout(r,25));assert.equal((await read()).ok,true);assert.deepEqual(lines,['ready db','ready recovered']);
});

test('directory and future timestamp cannot masquerade as a worker heartbeat',async()=>{
  const root=await mkdtemp(join(tmpdir(),'helios-beat-'));
  try{assert.equal(await workerCheck(root,Date.now()),'stale');const file=join(root,'heartbeat');await writeWorkerHeartbeat(file);const future=new Date(Date.now()+60000);await utimes(file,future,future);assert.equal(await workerCheck(file,Date.now()),'stale');}finally{await rm(root,{recursive:true,force:true})}
});

test('a live worker with failing queue checks does not refresh its heartbeat',async()=>{
  const root=await mkdtemp(join(tmpdir(),'helios-beat-'));const file=join(root,'worker');await writeWorkerHeartbeat(file);const old=new Date(Date.now()-60000);await utimes(file,old,old);const lines:string[]=[];
  let healthy=false;let attempts=0;
  let recovered!:()=>void;
  const recovery=new Promise<void>(resolve=>{recovered=resolve;});
  const stop=startWorkerHeartbeat(file,async()=>{attempts++;if(!healthy)throw new Error('private')},10,s=>{lines.push(s);if(s==='worker_heartbeat recovered')recovered();});
  try{
    while(attempts<2)await new Promise(r=>setTimeout(r,10));assert.equal(await workerCheck(file,Date.now()),'stale');assert.deepEqual(lines,['worker_heartbeat']);
    healthy=true;
    // The file can become visible before writeFile settles and the recovery log is emitted.
    // Observe completion before checking both independent outcomes.
    await new Promise<void>((resolve,reject)=>{
      const deadline=setTimeout(()=>reject(new Error('heartbeat recovery did not finish')),2000);
      void recovery.then(()=>{clearTimeout(deadline);resolve();});
    });
    assert.equal(await workerCheck(file,Date.now()),'ok');assert.deepEqual(lines,['worker_heartbeat','worker_heartbeat recovered']);
  }finally{stop();await rm(root,{recursive:true,force:true})}
});

test('production requirement cannot report ready with an unconfigured worker',async()=>{
  const report=await collectReady({db:async()=>true,queue:async()=>true,evidence:async()=>"ok",worker:async()=>"not_configured",requireWorker:true,log:()=>{}});
  assert.equal(report.ok,false);assert.equal(report.checks.worker,'not_configured');
});
