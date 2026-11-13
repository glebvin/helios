// Faults affect only this process's TCP proxy and children, never the database service.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,connect} from 'node:net';
import {mkdir,readFile,writeFile,chmod,rename,rm,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const ci=process.env.HELIOS_READY_QA_PROFILE==='ci';
if(ci)assert.equal(process.env.GITHUB_ACTIONS,'true');
const root=process.cwd(),out=resolve(ci?'.data/ci-ready':'.data/release-r47/integration');
await mkdir(out,{recursive:true});
const cfg=ci?{app:process.env.DATABASE_URL}:JSON.parse(await readFile('.data/release-r23-r25/qa-config.json'));
const db=new URL(cfg.app);assert.equal(db.hostname,'127.0.0.1');assert.equal(db.port,ci?'54339':'54360');assert.equal(db.pathname,'/helios');
const targetPort=Number(db.port);db.port='54361';
const runtime=resolve(ci?'.data/staging-runtime':'.data/release-r47/runtime-check');
const evidence=resolve(out,'evidence'),beat=resolve(out,'worker.heartbeat'),base='http://127.0.0.1:14371';
await mkdir(evidence,{recursive:true});await rm(beat,{force:true});
const children=[],logs=[],results=[];let blocked=false,worker;const sockets=new Set();
const proxy=createServer(client=>{
 sockets.add(client);client.on('error',()=>{});client.on('close',()=>sockets.delete(client));
 if(blocked)return;
 const upstream=connect(targetPort,'127.0.0.1');sockets.add(upstream);upstream.on('error',()=>client.destroy());upstream.on('close',()=>{sockets.delete(upstream);client.destroy()});client.on('close',()=>upstream.destroy());client.pipe(upstream).pipe(client);
});
await new Promise((ok,no)=>{proxy.once('error',no);proxy.listen(54361,'127.0.0.1',ok)});
const env={...process.env,DATABASE_URL:db.href,API_PORT:'14371',HELIOS_EVIDENCE_ROOT:evidence,HELIOS_WORKER_HEARTBEAT:beat,HELIOS_PASSWORD_HASH_CONCURRENCY:'1'};
async function launch(name,path){
 const log=await open(resolve(out,name+'.log'),'w',0o600);logs.push(log);
 const child=spawn(process.execPath,[path],{cwd:runtime,env,stdio:['ignore',log.fd,log.fd]});children.push(child);return child;
}
async function request(path){const before=Date.now();const r=await fetch(base+path,{signal:AbortSignal.timeout(4000)});return {status:r.status,body:await r.json(),elapsed:Date.now()-before}}
async function until(check,timeout=30000){const start=Date.now();let error;while(Date.now()-start<timeout){try{return await check()}catch(e){error=e;await delay(300)}}throw error??new Error('observation timed out')}
const pass=name=>{results.push(name);console.log('PASS',name)};
try{
 const api=await launch('api','apps/api/src/main.js');
 await until(async()=>{assert.equal(api.exitCode,null);assert.equal((await request('/api/health')).status,200)});
 const beforeWorker=await request('/api/ready');assert.equal(beforeWorker.status,503);assert.equal(beforeWorker.body.checks.worker,'stale');pass('liveness200 while missing worker makes readiness503');
 worker=await launch('worker','apps/worker/src/main.js');
 await until(async()=>{assert.equal(worker.exitCode,null);const r=await request('/api/ready');assert.equal(r.status,200);assert.deepEqual(r.body.checks,{db:'ok',evidence:'ok',queue:'ok',worker:'ok',backup:'not_configured'})});pass('real emitted worker registers, writes heartbeat and makes readiness200');
 const burst=await Promise.all(Array.from({length:40},()=>request('/api/ready')));assert.ok(burst.every(r=>r.status===200&&r.elapsed<2000));pass('40 public polls share healthy observation without business-pool pressure');
 await rename(evidence,evidence+'.away');try{await until(async()=>{const r=await request('/api/ready');assert.equal(r.status,503);assert.equal(r.body.checks.evidence,'missing')})}finally{await rename(evidence+'.away',evidence)}
 await chmod(evidence,0o500);try{await until(async()=>{const r=await request('/api/ready');assert.equal(r.status,503);assert.equal(r.body.checks.evidence,'unwritable')})}finally{await chmod(evidence,0o700)};pass('missing and read-only evidence directory cause503, permissions restored');
 blocked=true;for(const s of sockets)s.destroy();
 await until(async()=>{const r=await request('/api/ready');assert.equal(r.status,503);assert.equal(r.body.checks.db,'down');assert.equal(r.body.checks.queue,'down');assert.ok(r.elapsed<3500);assert.equal((await request('/api/health')).status,200);assert.equal(api.exitCode,null)});
 pass('database blackhole returns bounded503 while liveness remains200');
 blocked=false;for(const s of sockets)s.destroy();
 await until(async()=>{assert.equal((await request('/api/ready')).status,200)},45000);pass('database route recovery restores readiness without restarting API');
 worker.kill('SIGTERM');await until(async()=>assert.notEqual(worker.exitCode===null&&worker.signalCode===null,true));
 await until(async()=>{const r=await request('/api/ready');assert.equal(r.status,503);assert.equal(r.body.checks.db,'ok');assert.equal(r.body.checks.queue,'ok');assert.equal(r.body.checks.worker,'stale');assert.equal((await request('/api/health')).status,200)},45000);pass('stopped real worker becomes stale503; API/DB/queue remain alive');
 worker=await launch('worker-restarted','apps/worker/src/main.js');await until(async()=>assert.equal((await request('/api/ready')).status,200));pass('restarted worker restores readiness with same database');
 const text=(await readFile(resolve(out,'api.log'),'utf8'))+(await readFile(resolve(out,'worker.log'),'utf8'))+(await readFile(resolve(out,'worker-restarted.log'),'utf8'));
 assert.ok(!text.includes(decodeURIComponent(new URL(cfg.app).password)));assert.ok(!text.includes('postgres://'));assert.ok(text.includes('ready recovered'));pass('fault/recovery signals present without connection URL or password');
}finally{
 blocked=false;await chmod(evidence,0o700).catch(()=>{});
 for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
 await delay(500);for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
 for(const s of sockets)s.destroy();await new Promise(ok=>proxy.close(ok));for(const log of logs)await log.close();
 await writeFile(resolve(out,'results.json'),JSON.stringify({profile:ci?'ci':'review',results,publicStandTouched:false},null,2));
}
console.log(JSON.stringify({ok:true,scenarios:results.length}));
