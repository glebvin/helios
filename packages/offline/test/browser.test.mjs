import assert from 'node:assert/strict';
import {test as browserTest} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (!process.env.HELIOS_OFFLINE_TEST_CHILD) {
  const run=spawnSync(process.execPath,['--test','--test-reporter=tap',fileURLToPath(import.meta.url)],{stdio:'inherit',env:{...process.env,HELIOS_OFFLINE_TEST_CHILD:'1',HELIOS_OFFLINE_SUITE:process.argv[2]??'all'}});
  process.exit(run.status??1);
}
const suite = process.env.HELIOS_OFFLINE_SUITE;
// Incomplete suites fail explicitly until their sequential task adds its assertions.
assert.ok(['tracer','mechanics','evidence'].includes(suite), `Suite ${suite} is not implemented yet (Task3 pending); no scenarios skipped`);
const modulePath = process.env.HELIOS_PLAYWRIGHT_MODULE;
assert.ok(modulePath, 'HELIOS_PLAYWRIGHT_MODULE must point to an existing Playwright runtime');
assert.ok(process.env.PLAYWRIGHT_BROWSERS_PATH, 'PLAYWRIGHT_BROWSERS_PATH is required');
const packageInfo = JSON.parse(await readFile(join(dirname(modulePath), 'package.json'), 'utf8'));
assert.equal(packageInfo.version, '1.62.1');
const playwright = await import(pathToFileURL(modulePath).href);
const temporary = await mkdtemp(join(tmpdir(), 'helios-offline-tracer-'));
const journal = [];
const wrongIds = new Set();
const receipts = new Map();
const actions = new Map();
const gates = new Set(), fixtureErrors = [];
let meAction = null;
let activeSends = 0, maxActiveSends = 0;
function barrier() {
  let enter, release;
  const entered = new Promise(resolve=>{enter=resolve;});
  const released = new Promise(resolve=>{release=resolve;});
  const gate={entered,release,async wait(){enter();await released;}};gates.add(gate);return gate;
}
const tenantId = '11111111-1111-4111-8111-111111111111';
const actorUserId = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
function event(n) {
  return {kind:'shift_start', requestId:`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`,
    employeeId:`44444444-4444-4444-8444-${String(n).padStart(12,'0')}`,
    projectId:'55555555-5555-4555-8555-555555555555', shiftId:'66666666-6666-4666-8666-666666666666',
    expectedVersion:0, occurredAt:'2027-01-15T09:00:00+03:00'};
}
function resultFor(command) {
  return {...Object.fromEntries(['requestId','employeeId','projectId','shiftId','kind','occurredAt'].map(k=>[k,command[k]])),
    ...(command.kind==='submit_volume'?{taskId:command.taskId,reportId:command.reportId,submittedQuantity:Number(command.submittedQuantity).toFixed(3),provisional:true,acceptedQuantity:null}:{}),
    version:command.expectedVersion+1, occurredAt:new Date(command.occurredAt).toISOString(), receivedAt:'2027-01-15T06:00:01.000Z',
    reviewFlags:{delayed:false,future:false,suspicious:false,geoTimeMismatch:false,abovePlannedQuantity:false}};
}
let compiled;
const server = createServer(async (req,res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    if (req.url.startsWith('/api/v1/')) {
      journal.push({method:req.method,path:req.url,raw,tenant:req.headers['x-tenant-id'],authorized:req.headers.authorization===`Bearer ${token}`});
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      assert.equal(req.headers['x-tenant-id'],tenantId);
      if (req.method==='GET' && req.url==='/api/v1/me') {
        if (meAction?.gate) await meAction.gate.wait();
        if (meAction?.status) {res.statusCode=meAction.status;res.end(meAction.raw??'');return;}
        if (meAction?.body) {res.end(JSON.stringify(meAction.body));return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({userId:actorUserId,tenantId}));return;
      }
      assert.equal(req.url,'/api/v1/execution/events');assert.equal(req.method,'POST');
      const body = JSON.parse(raw);assert.equal(body.events.length,1);
      const command = body.events[0];
      activeSends++;maxActiveSends=Math.max(maxActiveSends,activeSends);
      let finished=false;const finish=()=>{if(!finished){finished=true;activeSends--;}};
      res.once('close',finish);res.once('finish',finish);
      const previous = receipts.get(command.requestId);
      if (previous) assert.deepEqual(command,previous);
      receipts.set(command.requestId,command);
      const action=actions.get(command.requestId);
      if (action?.gate) await action.gate.wait();
      if (action?.drop) {res.writeHead(200,{'Content-Type':'application/json','Content-Length':'10000'});res.write('{"results":[',()=>req.socket.destroy());return;}
      if (action?.status) {res.statusCode=action.status;if(action.retryAfter)res.setHeader('Retry-After',action.retryAfter);res.end(action.raw??'');return;}
      if (action?.raw!==undefined) {res.end(action.raw);return;}
      if (action?.body) {res.end(JSON.stringify(action.body(command)));return;}
      const requestId = wrongIds.has(command.requestId) ? '99999999-9999-4999-8999-999999999999' : command.requestId;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({results:[{requestId,outcome:previous?'duplicate':'success',status:201,result:resultFor(command)}]}));return;
    }
    if (req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Native offline queue tests</title>');return;}
    if (/^\/(index|store|transport|evidence)\.js$/.test(req.url)) {
      res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(compiled,req.url.slice(1))));return;
    }
    res.statusCode=404;res.end();
  } catch(error) {fixtureErrors.push(error);res.statusCode=500;res.end(JSON.stringify({code:'fixture_failure',message:error.message}));}
});
let contexts = new Set();
async function openPage(engine, profile, origin) {
  const context = await engine.launchPersistentContext(profile,{headless:true});contexts.add(context);
  const page = context.pages()[0] ?? await context.newPage();await page.goto(origin);
  await page.evaluate(async ({tenantId,actorUserId,token}) => {
    const {openOfflineQueue} = await import('/index.js');
    globalThis.session = {token,tenantId,actorUserId,generation:1};
    globalThis.queue = await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId,actorUserId,getSession:()=>globalThis.session});
  },{tenantId,actorUserId,token});
  return {page,context};
}
async function closeContext(context) {await context.close();contexts.delete(context);}
async function addPage(context,origin) {
  const page=await context.newPage();await page.goto(origin);
  await page.evaluate(async ({tenantId,actorUserId,token})=>{
    const {openOfflineQueue}=await import('/index.js');globalThis.session={token,tenantId,actorUserId,generation:1};
    globalThis.queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId,actorUserId,getSession:()=>globalThis.session});
  },{tenantId,actorUserId,token});return page;
}
const tests = [
  ['native save survives persistent reopen and validated HTTP acknowledgement', async (engine,profile,origin,n) => {
    const command = event(n);const start=journal.length;
    let {page,context} = await openPage(engine,profile,origin);
    assert.equal(await page.evaluate(command=>globalThis.queue.enqueueEvent(command).then(()=>true,()=>false),command),true,'valid event must save');
    assert.deepEqual(await page.evaluate(id=>globalThis.queue.get(id).then(row=>row.event),command.requestId),command);
    await closeContext(context);
    ({page,context}=await openPage(engine,profile,origin));
    assert.deepEqual(await page.evaluate(id=>globalThis.queue.get(id).then(row=>row.event),command.requestId),command);
    await page.evaluate(()=>globalThis.queue.flush());
    assert.equal(await page.evaluate(id=>globalThis.queue.get(id).then(row=>row.state),command.requestId),'synced');
    const calls=journal.slice(start);assert.deepEqual(calls.map(x=>`${x.method} ${x.path}`),['GET /api/v1/me','POST /api/v1/execution/events']);
    assert.deepEqual(JSON.parse(calls[1].raw),{events:[command]});assert.equal(calls[1].authorized,true);
    await closeContext(context);
    ({page,context}=await openPage(engine,profile,origin));
    assert.equal(await page.evaluate(id=>globalThis.queue.get(id).then(row=>row.state),command.requestId),'synced');
    await page.evaluate(()=>globalThis.queue.flush());assert.equal(journal.slice(start).filter(x=>x.path==='/api/v1/execution/events').length,1);
    await closeContext(context);
  }],
  ['request success followed by native transaction abort rejects and stores no event', async (engine,profile,origin,n) => {
    const {page,context}=await openPage(engine,profile,origin);const command=event(n);
    const result=await page.evaluate(async command=>{
      const originals={add:IDBObjectStore.prototype.add,put:IDBObjectStore.prototype.put};let requestSucceeded=false;
      for(const method of ['add','put']) IDBObjectStore.prototype[method]=function(...args){
        const request=originals[method].apply(this,args);
        if(this.name==='events') request.addEventListener('success',()=>{requestSucceeded=true;this.transaction.abort();},{once:true});
        return request;
      };
      let rejected=false;
      try {await globalThis.queue.enqueueEvent(command);}catch {rejected=true;}
      finally {Object.assign(IDBObjectStore.prototype,originals);}
      return {rejected,requestSucceeded,row:await globalThis.queue.get(command.requestId)};
    },command);
    assert.equal(result.requestSucceeded,true,'injection must reach an actual IDB request success');
    assert.equal(result.rejected,true,'transaction abort cannot resolve save');assert.equal(result.row,null);
    // The aborted transaction must also roll back the employee tail and identity.
    assert.equal(await page.evaluate(command=>globalThis.queue.enqueueEvent(command).then(()=>true,()=>false),command),true);
    assert.deepEqual(await page.evaluate(id=>globalThis.queue.get(id).then(row=>row.event),command.requestId),command);
    await closeContext(context);
  }],
  ['wrong requestId HTTP200 retains exact unacknowledged event', async (engine,profile,origin,n) => {
    const command=event(n);wrongIds.add(command.requestId);const start=journal.length;
    const {page,context}=await openPage(engine,profile,origin);
    assert.equal(await page.evaluate(command=>globalThis.queue.enqueueEvent(command).then(()=>true,()=>false),command),true,'valid event must save');
    await page.evaluate(()=>globalThis.queue.flush());
    const row=await page.evaluate(id=>globalThis.queue.get(id),command.requestId);
    assert.notEqual(row.state,'synced');assert.deepEqual(row.event,command);
    assert.ok(['pending','retry_wait','blocked'].includes(row.state));
    const calls=journal.slice(start);assert.equal(calls.filter(x=>x.path==='/api/v1/execution/events').length,1);
    assert.deepEqual(JSON.parse(calls.find(x=>x.path==='/api/v1/execution/events').raw),{events:[command]});
    await closeContext(context);
    const reopened=await openPage(engine,profile,origin);
    const retained=await reopened.page.evaluate(id=>globalThis.queue.get(id),command.requestId);
    assert.notEqual(retained.state,'synced');assert.deepEqual(retained.event,command);await closeContext(reopened.context);
  }],
];
if(suite==='mechanics') tests.push(
  ['four exact shapes, explicit external predecessor, immutable idempotence and retained acknowledgement',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const first={...event(n),expectedVersion:7,previousEventId:crypto.randomUUID()};
    assert.equal(await page.evaluate(c=>queue.enqueueEvent(c).then(()=>true,()=>false),first),true,'explicit initial external predecessor must save unchanged');
    const commands=[first,
      {...first,requestId:crypto.randomUUID(),kind:'segment_change',mode:'work',taskId:crypto.randomUUID(),expectedVersion:8,previousEventId:first.requestId},
      {...first,requestId:crypto.randomUUID(),kind:'shift_end',expectedVersion:9},
      {...first,requestId:crypto.randomUUID(),kind:'submit_volume',taskId:crypto.randomUUID(),reportId:crypto.randomUUID(),submittedQuantity:'00001.20',expectedVersion:10}];
    commands[2].previousEventId=commands[1].requestId;commands[3].previousEventId=commands[2].requestId;
    for(const command of commands.slice(1))await page.evaluate(c=>queue.enqueueEvent(c),command);
    assert.equal(await page.evaluate(c=>queue.enqueueEvent(c).then(r=>r.event.expectedVersion),first),7);
    assert.equal(await page.evaluate(c=>queue.enqueueEvent({...c,occurredAt:'2027-01-15T09:01:00+03:00'}).then(()=>null,e=>e.code),first),'local_identity_conflict');
    await page.evaluate(async()=>{const rows=await queue.list();rows[0].event.expectedVersion=999;});
    assert.deepEqual(await page.evaluate(id=>queue.get(id).then(r=>r.event),first.requestId),first);
    await page.evaluate(()=>queue.flush());
    assert.deepEqual(await page.evaluate(()=>queue.list().then(rows=>rows.map(r=>r.state))),['synced','synced','synced','synced']);
    await page.evaluate(ids=>queue.cleanupAcknowledged(ids),commands.map(c=>c.requestId));
    assert.equal((await page.evaluate(()=>queue.list())).length,0);
    const replay=await page.evaluate(c=>queue.enqueueEvent(c),first);assert.equal(replay.state,'synced');assert.deepEqual(replay.event,first);
    assert.equal((await page.evaluate(()=>queue.list())).length,0,'idempotent acknowledgement must not reinsert cleaned work');
    assert.equal(await page.evaluate(c=>queue.enqueueEvent({...c,occurredAt:'2027-01-15T10:00:00+03:00'}).then(()=>null,e=>e.code),first),'local_identity_conflict');
    assert.equal(await page.evaluate(c=>queue.enqueueEvent({...c,requestId:crypto.randomUUID(),previousEventId:undefined}).then(()=>null,e=>e.code),first),'invalid_object');
    const next={...first,requestId:crypto.randomUUID(),expectedVersion:11,previousEventId:commands[3].requestId};
    await page.evaluate(c=>queue.enqueueEvent(c),next);
    assert.equal(await page.evaluate(c=>queue.enqueueEvent(c).then(()=>null,e=>e.code),{...next,requestId:crypto.randomUUID(),expectedVersion:0}),'local_stream_conflict');
  }],
  ['atomic cross-tab project tail race and blocked employee head',async(engine,profile,origin,n)=>{
    const {page,context}=await openPage(engine,profile,origin);const second=await addPage(context,origin);const a=event(n),b={...a,requestId:crypto.randomUUID(),projectId:crypto.randomUUID()};
    const results=await Promise.all([page.evaluate(c=>queue.enqueueEvent(c).then(()=>true,e=>e.code),a),second.evaluate(c=>queue.enqueueEvent(c).then(()=>true,e=>e.code),b)]);
    assert.equal(results.filter(x=>x===true).length,1);assert.ok(results.includes('local_stream_conflict'));
    const winner=results[0]===true?a:b,loser=results[0]===true?b:a;
    await second.evaluate(c=>queue.enqueueEvent(c),{...loser,expectedVersion:1});
    const third={...winner,requestId:crypto.randomUUID(),expectedVersion:2,previousEventId:winner.requestId};await page.evaluate(c=>queue.enqueueEvent(c),third);
    const independent=event(n+10000);await page.evaluate(c=>queue.enqueueEvent(c),independent);
    actions.set(winner.requestId,{body:c=>({results:[{requestId:c.requestId,outcome:'error',status:409,code:'stale_version',retryable:false}]})});
    const start=journal.length;await page.evaluate(()=>queue.flush());
    const calls=journal.slice(start).filter(x=>x.method==='POST').map(x=>JSON.parse(x.raw).events[0].requestId);
    assert.deepEqual(calls.toSorted(),[winner.requestId,independent.requestId].toSorted());
    const rows=await page.evaluate(()=>queue.list());assert.equal(rows.find(r=>r.id===winner.requestId).lastError,'stale_version');assert.equal(rows.find(r=>r.id===third.requestId).state,'pending');
    assert.equal(await page.evaluate(id=>queue.cleanupAcknowledged([id]).then(()=>null,e=>e.code),winner.requestId),'cleanup_requires_acknowledgement');
    assert.deepEqual(rows.find(r=>r.id===winner.requestId).event,winner);
    await page.evaluate(id=>queue.retry(id),winner.requestId);assert.deepEqual(await page.evaluate(id=>queue.get(id).then(r=>r.event),winner.requestId),winner);
  }],
  ['HTTP status before optional JSON, bounded Retry-After and exact retry exhaustion',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);
    meAction={status:401,raw:'expired'};await page.evaluate(()=>queue.flush().catch(()=>null));meAction=null;
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'auth-required','non-JSON /me 401 must retain auth-required');
    await page.evaluate(id=>queue.retry(id),command.requestId);actions.set(command.requestId,{status:401,raw:'expired'});await page.evaluate(()=>queue.flush());
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'auth-required','non-JSON event 401 must retain auth-required');
    await page.evaluate(id=>queue.retry(id),command.requestId);await page.evaluate(()=>{globalThis.clock=2000000000000;Date.now=()=>globalThis.clock;});
    actions.set(command.requestId,{status:429,raw:'rate limited',retryAfter:'9999'});
    await page.evaluate(()=>queue.flush());let row=await page.evaluate(id=>queue.get(id),command.requestId);
    assert.equal(row.nextAttemptAt,2000000060000);assert.equal(row.lastError,'http_429');
    const start=journal.length;await page.evaluate(()=>queue.flush());assert.equal(journal.slice(start).filter(x=>x.method==='POST').length,0);
    actions.set(command.requestId,{status:500,raw:'not json'});
    for(let attempt=2;attempt<=5;attempt++){
      await page.evaluate(()=>{clock+=60001;});await page.evaluate(()=>queue.flush());row=await page.evaluate(id=>queue.get(id),command.requestId);
      assert.equal(row.attemptCount,attempt);assert.equal(row.state,attempt===5?'blocked':'retry_wait');
      if(attempt<5)assert.equal(row.nextAttemptAt,2000000000000+(attempt-1)*60001+1000*2**(attempt-1));
    }
    assert.equal(row.lastError,'blocked_retry_exhausted');assert.deepEqual(row.event,command);
    const before=journal.length;await page.evaluate(()=>queue.flush());assert.equal(journal.length,before);
    await page.evaluate(id=>queue.retry(id),command.requestId);actions.delete(command.requestId);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');
  }],
  ['ambiguous replies and permanent business errors never acknowledge',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);
    const variants=[{raw:'{bad'},
      {body:c=>({results:[]})},
      {body:c=>({results:[{requestId:c.requestId,outcome:'future',status:201,result:resultFor(c)}]})},
      {body:c=>({results:[{requestId:c.requestId,outcome:'success',status:201,result:resultFor(c)},{requestId:c.requestId,outcome:'success',status:201,result:resultFor(c)}]})},
      {status:204},
      {body:c=>({results:[{requestId:c.requestId,outcome:'success',status:200,result:resultFor(c)}]})},
      ...['employeeId','projectId','shiftId','kind','version','occurredAt','receivedAt','reviewFlags'].map(field=>({body:c=>({results:[{requestId:c.requestId,outcome:'duplicate',status:201,result:{...resultFor(c),[field]:field==='version'?99:field==='reviewFlags'?{}:'wrong'}}]})})),
      {body:c=>({results:[{requestId:c.requestId,outcome:'error',status:500,code:'temporary',retryable:true,result:resultFor(c)}]})},
      {body:c=>({results:[{requestId:c.requestId,outcome:'error',status:409,code:'missing_dependency',retryable:true}]})},
      {status:403,raw:'denied'}];
    for(let i=0;i<variants.length;i++){
      const command=event(n+1000+i);await page.evaluate(c=>queue.enqueueEvent(c),command);actions.set(command.requestId,variants[i]);await page.evaluate(()=>queue.flush());
      const row=await page.evaluate(id=>queue.get(id),command.requestId);assert.notEqual(row.state,'synced');assert.deepEqual(row.event,command);
      if(i===variants.length-2){assert.equal(row.state,'blocked');assert.equal(row.lastError,'missing_dependency');}
      if(i===variants.length-1){assert.equal(row.state,'blocked');assert.equal(row.lastError,'http_403');}
    }
  }],
  ['delayed identity and event completion obey current session and handle lifecycle',async(engine,profile,origin,n)=>{
    for(const stage of ['identity','event'])for(const change of ['token','generation','actorUserId','tenantId','logout','close']){
      const {page,context}=await openPage(engine,`${profile}-${stage}-${change}`,origin);
      const command={...event(n),requestId:crypto.randomUUID()},successor={...event(n),requestId:crypto.randomUUID(),expectedVersion:1,previousEventId:command.requestId};
      await page.evaluate(async cs=>{for(const c of cs)await queue.enqueueEvent(c);},[command,successor]);
      const gate=barrier();if(stage==='identity')meAction={gate};else actions.set(command.requestId,{gate});
      const start=journal.length;const flushing=page.evaluate(()=>queue.flush().then(()=>true,()=>false));await gate.entered;
      await page.evaluate(change=>{if(change==='logout')session=null;else if(change==='close')queue.close();else session={...session,[change]:change==='generation'?2:'99999999-9999-4999-8999-999999999999'};},change);
      gate.release();assert.equal(await flushing,false);meAction=null;actions.delete(command.requestId);
      assert.equal(journal.slice(start).filter(x=>x.method==='POST').length,stage==='identity'?0:1,'no successor after session transition');
      await page.reload();await page.evaluate(async ({tenantId,actorUserId,token})=>{const {openOfflineQueue}=await import('/index.js');session={token,tenantId,actorUserId,generation:3};queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId,actorUserId,getSession:()=>session});},{tenantId,actorUserId,token});
      assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'pending','stale completion must not commit');await closeContext(context);
    }
  }],
  ['actual Web Lock contention and crashed tab exact receipt replay',async(engine,profile,origin,n)=>{
    const {page,context}=await openPage(engine,profile,origin);const second=await addPage(context,origin);assert.equal(await page.evaluate(()=>!!navigator.locks),true);
    const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);const gate=barrier();actions.set(command.requestId,{gate});maxActiveSends=0;
    const flushing=page.evaluate(()=>queue.flush()).catch(()=>null);await gate.entered;
    assert.equal((await second.evaluate(()=>queue.flush())).state,'busy');assert.equal(maxActiveSends,1);
    await page.close();await flushing;actions.delete(command.requestId);gate.release();
    await second.evaluate(async()=>{const scope=JSON.stringify([`${location.origin}/api/v1`,session.tenantId,session.actorUserId]);await navigator.locks.request(`helios-offline:${scope}`,()=>{});});
    await second.evaluate(()=>queue.flush());assert.equal(await second.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');
    const copies=journal.filter(x=>x.method==='POST'&&JSON.parse(x.raw).events[0].requestId===command.requestId);assert.equal(copies.length,2);assert.equal(copies[0].raw,copies[1].raw);
  }],
  ['lost committed HTTP response reopens with exact command and duplicate acknowledgement',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);actions.set(command.requestId,{drop:true});await page.evaluate(()=>queue.flush());
    assert.notEqual(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');await closeContext(context);actions.delete(command.requestId);
    ({page,context}=await openPage(engine,profile,origin));await page.evaluate(id=>queue.retry(id),command.requestId);await page.evaluate(()=>queue.flush());
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');const copies=journal.filter(x=>x.method==='POST'&&JSON.parse(x.raw).events[0].requestId===command.requestId);assert.equal(copies.length,2);assert.equal(copies[0].raw,copies[1].raw);
  }],
  ['persisted authEpoch fences another tab without BroadcastChannel delivery',async(engine,profile,origin,n)=>{
    const {page,context}=await openPage(engine,profile,origin);const second=await context.newPage();await second.goto(origin);
    await second.evaluate(async ({tenantId,actorUserId,token})=>{globalThis.BroadcastChannel=undefined;const {openOfflineQueue}=await import('/index.js');session={tenantId,actorUserId,token,generation:1};queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId,actorUserId,getSession:()=>session});},{tenantId,actorUserId,token});
    const command=event(n);await second.evaluate(c=>queue.enqueueEvent(c),command);await page.evaluate(()=>queue.closeSession());
    assert.equal(await second.evaluate(()=>queue.list().then(()=>null,e=>e.code)),'session_invalidated');const before=journal.length;
    assert.equal(await second.evaluate(()=>queue.flush().then(()=>null,e=>e.code)),'session_invalidated');assert.equal(journal.length,before);
    const fresh=await addPage(context,origin);assert.deepEqual(await fresh.evaluate(id=>queue.get(id).then(r=>r.event),command.requestId),command);
  }],
  ['authEpoch rejects an in-flight completion before commit even without broadcast',async(engine,profile,origin,n)=>{
    const {page,context}=await openPage(engine,profile,origin);const second=await context.newPage();await second.goto(origin);
    await second.evaluate(async ({tenantId,actorUserId,token})=>{globalThis.BroadcastChannel=undefined;const {openOfflineQueue}=await import('/index.js');session={tenantId,actorUserId,token,generation:1};queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId,actorUserId,getSession:()=>session});},{tenantId,actorUserId,token});
    const command=event(n);await second.evaluate(c=>queue.enqueueEvent(c),command);const gate=barrier();actions.set(command.requestId,{gate});
    const flushing=second.evaluate(()=>queue.flush().then(()=>null,e=>e.code));await gate.entered;await page.evaluate(()=>queue.closeSession());gate.release();assert.equal(await flushing,'session_invalidated');actions.delete(command.requestId);
    const fresh=await addPage(context,origin);assert.equal(await fresh.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'pending');
  }],
  ['known cross-project dependencies rejected and acknowledged pending dependencies cannot be cleaned',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const first=event(n);await page.evaluate(c=>queue.enqueueEvent(c),first);
    const wrong={...first,requestId:crypto.randomUUID(),expectedVersion:1,projectId:crypto.randomUUID(),previousEventId:first.requestId};
    assert.equal(await page.evaluate(c=>queue.enqueueEvent(c).then(()=>null,e=>e.code),wrong),'local_dependency_conflict');
    const next={...first,requestId:crypto.randomUUID(),kind:'segment_change',mode:'downtime',reasonCode:'weather',comment:'Wet front',expectedVersion:1,previousEventId:first.requestId};await page.evaluate(c=>queue.enqueueEvent(c),next);
    actions.set(next.requestId,{body:c=>({results:[{requestId:c.requestId,outcome:'error',status:409,code:'lifecycle_conflict',retryable:false}]})});await page.evaluate(()=>queue.flush());
    assert.equal(await page.evaluate(id=>queue.cleanupAcknowledged([id]).then(()=>null,e=>e.code),first.requestId),'pending_dependency');assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),first.requestId),'synced');
    await page.evaluate(id=>queue.retry(id),next.requestId);actions.delete(next.requestId);await page.evaluate(()=>queue.flush());await page.evaluate(id=>queue.cleanupAcknowledged([id]),first.requestId);
  }],
  ['strict JSON validation, segment variants and submit-volume response integrity',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);
    const invalid=await page.evaluate(async c=>{
      const inputs=[{...c,unexpected:true},{...c,expectedVersion:-1},{...c,occurredAt:'2027-02-30T00:00:00Z'},{...c,geo:{latitude:91,longitude:0,accuracyMeters:0,capturedAt:c.occurredAt}},
        {...c,kind:'segment_change',mode:'work'},{...c,kind:'segment_change',mode:'break',taskId:crypto.randomUUID()},{...c,kind:'segment_change',mode:'downtime',reasonCode:'other',comment:''},
        {...c,kind:'submit_volume',taskId:crypto.randomUUID(),reportId:crypto.randomUUID(),submittedQuantity:'0'}, {...c,extra:undefined},{...c,geo:{latitude:NaN,longitude:0,accuracyMeters:0,capturedAt:c.occurredAt}}];
      const codes=[];for(const input of inputs)codes.push(await queue.enqueueEvent(input).then(()=>null,e=>e.code));return {codes,count:(await queue.list()).length};
    },command);assert.ok(invalid.codes.every(Boolean));assert.equal(invalid.count,0);
    for(const mode of ['idle','break','downtime']){const c={...event(n+10000+mode.length),requestId:crypto.randomUUID(),employeeId:crypto.randomUUID(),kind:'segment_change',mode,...(mode==='downtime'?{reasonCode:'other',comment:'Await inspection'}:{})};await page.evaluate(c=>queue.enqueueEvent(c),c);}
    const report={...command,kind:'submit_volume',taskId:crypto.randomUUID(),reportId:crypto.randomUUID(),submittedQuantity:'1.200'};await page.evaluate(c=>queue.enqueueEvent(c),report);
    for(const field of ['taskId','reportId','submittedQuantity','provisional','acceptedQuantity']){
      actions.set(report.requestId,{body:c=>({results:[{requestId:c.requestId,outcome:'success',status:201,result:{...resultFor(c),[field]:field==='provisional'?false:field==='acceptedQuantity'?'1.200':crypto.randomUUID()}}]})});
      await page.evaluate(id=>queue.retry(id),report.requestId);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),report.requestId),'retry_wait');
    }
    actions.delete(report.requestId);await page.evaluate(id=>queue.retry(id),report.requestId);await page.evaluate(()=>queue.flush());assert.ok((await page.evaluate(()=>queue.list())).every(r=>r.state==='synced'));
  }],
  ['current /me authority gate, retryable item500, Retry-After date and permanent item403',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);
    const start=journal.length;meAction={body:{tenantId,userId:crypto.randomUUID()}};await page.evaluate(()=>queue.flush());meAction=null;
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.lastError),command.requestId),'identity_mismatch');assert.equal(journal.slice(start).filter(x=>x.method==='POST').length,0);
    await page.evaluate(()=>{globalThis.clock=2000000000000;Date.now=()=>clock;});
    for(const [header,delay] of [['0',1000],[new Date(2000000005000).toUTCString(),5000],['invalid',1000]]){
      await page.evaluate(id=>queue.retry(id),command.requestId);actions.set(command.requestId,{status:429,retryAfter:header});await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.nextAttemptAt),command.requestId),2000000000000+delay);
    }
    for(const [status,code,retryable,state] of [[500,'temporary',true,'retry_wait'],[403,'access_denied',true,'blocked'],[401,'expired_session',false,'auth-required']]){
      await page.evaluate(id=>queue.retry(id),command.requestId);actions.set(command.requestId,{body:c=>({results:[{requestId:c.requestId,outcome:'error',status,code,retryable}]})});await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),state);
    }
  }],
  ['scope isolation, current identity on all public data methods and no stored token',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);
    const result=await page.evaluate(async ({command,tenantId,actorUserId,token})=>{
      const {openOfflineQueue}=await import('/index.js');const old=queue;
      const snapshots=[];for(const change of [{actorUserId:crypto.randomUUID()},{tenantId:crypto.randomUUID()}]){
        session={...session,...change,generation:session.generation+1};queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId:session.tenantId,actorUserId:session.actorUserId,getSession:()=>session});snapshots.push((await queue.list()).length);queue.close();session={token,tenantId,actorUserId,generation:session.generation+1};
      }
      queue=await openOfflineQueue({audience:`${location.origin}/another/api/v1`,tenantId,actorUserId,getSession:()=>session});snapshots.push((await queue.list()).length);queue.close();queue=old;
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('helios-managed-offline');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const stored=await new Promise((resolve,reject)=>{const tx=db.transaction(['events','evidence','meta']);const rows=[];for(const name of ['events','evidence','meta']){const r=tx.objectStore(name).getAll();r.onsuccess=()=>rows.push(...r.result);}tx.oncomplete=()=>resolve(JSON.stringify(rows));tx.onabort=()=>reject(tx.error);});db.close();
      session=null;const errors=[];for(const fn of [()=>old.list(),()=>old.get(command.requestId),()=>old.enqueueEvent(command),()=>old.flush(),()=>old.retry(command.requestId),()=>old.cleanupAcknowledged([command.requestId]),()=>old.storageInfo()])errors.push(await fn().then(()=>null,e=>e.code));return {snapshots,stored,errors};
    },{command,tenantId,actorUserId,token});assert.deepEqual(result.snapshots,[0,0,0]);assert.equal(result.stored.includes(token),false);assert.ok(result.errors.every(x=>x==='auth_required'));
  }],
  ['native quota boundary, strict fallback, versionchange and explicit storage capabilities',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);
    const result=await page.evaluate(async command=>{
      const add=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='events')throw new DOMException('injected boundary quota','QuotaExceededError');return add.apply(this,args);};let quota;
      try{await queue.enqueueEvent(command);}catch(e){quota=e.name;}finally{IDBObjectStore.prototype.add=add;}
      const absent=await queue.get(command.requestId);const transaction=IDBDatabase.prototype.transaction;let strict=0;
      IDBDatabase.prototype.transaction=function(...args){if(args[2]){strict++;throw new TypeError('injected unsupported durability');}return transaction.apply(this,args);};
      try{await queue.enqueueEvent(command);}finally{IDBDatabase.prototype.transaction=transaction;}
      const info=await queue.storageInfo({requestPersistence:true});const storage=navigator.storage;
      const originals={persisted:storage.persisted,estimate:storage.estimate,persist:storage.persist};Object.assign(storage,{persisted:async()=>true,estimate:async()=>({usage:123,quota:456}),persist:async()=>false});
      const explicit=await queue.storageInfo({requestPersistence:true});storage.estimate=async()=>{throw new Error('private diagnostic');};const failure=await queue.storageInfo();Object.assign(storage,originals);
      await new Promise((resolve,reject)=>{const r=indexedDB.open('helios-managed-offline',2);r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('versionchange did not release connection'));});
      const closed=await queue.list().then(()=>null,e=>e.code);return {quota,absent,strict,info,explicit,failure,closed};
    },command);assert.equal(result.quota,'QuotaExceededError');assert.equal(result.absent,null);assert.equal(result.strict,1);assert.equal(result.info.indexedDB,true);assert.equal(result.info.webLocks,true);assert.deepEqual(result.explicit.estimate,{usage:123,quota:456});assert.equal(result.explicit.persisted,true);assert.equal(result.explicit.persistenceGranted,false);assert.equal(result.failure.error,'storage_info_failed');assert.equal(result.closed,'storage_closed');
  }],
  ['unsupported lock, unsupported storage, controlled 30s timeout and native event count cap',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);
    const lock=await page.evaluate(async()=>{Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});const result=await queue.flush();delete navigator.locks;return result;});assert.equal(lock.state,'unsupported_lock');
    const unsupported=await page.evaluate(async()=>{const original=indexedDB;Object.defineProperty(globalThis,'indexedDB',{value:undefined,configurable:true});try{const {NativeStore}=await import('/store.js');return await NativeStore.open().then(()=>null,e=>e.code);}finally{Object.defineProperty(globalThis,'indexedDB',{value:original,configurable:true});}});assert.equal(unsupported,'unsupported_storage');
    const gate=barrier();actions.set(command.requestId,{gate});await page.evaluate(()=>{globalThis.originalTimeout=setTimeout;globalThis.setTimeout=(fn,ms,...args)=>{if(ms===30000){globalThis.expireRequest=fn;return 0;}return originalTimeout(fn,ms,...args);};});
    const flushing=page.evaluate(()=>queue.flush());await gate.entered;await page.evaluate(()=>expireRequest());await flushing;gate.release();actions.delete(command.requestId);await page.evaluate(()=>{globalThis.setTimeout=originalTimeout;});
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.lastError),command.requestId),'network_error');
    const cap=await page.evaluate(async command=>{for(let i=1;i<1000;i++)await queue.enqueueEvent({...command,requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()});const overflow={...command,requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()};return {code:await queue.enqueueEvent(overflow).then(()=>null,e=>e.code),count:(await queue.list()).length};},command);assert.deepEqual(cap,{code:'capacity_exceeded',count:1000});
    const other=await page.evaluate(async ({tenantId,actorUserId,command})=>{const {openOfflineQueue}=await import('/index.js');const scoped=await openOfflineQueue({audience:`${location.origin}/other/api/v1`,tenantId,actorUserId,getSession:()=>session});try{return {code:await scoped.enqueueEvent(command).then(()=>null,e=>e.code),rows:(await scoped.list()).length};}finally{scoped.close();}},{tenantId,actorUserId,command});assert.deepEqual(other,{code:'capacity_exceeded',rows:0});
  }],
  ['genuine blocked native upgrade closes late success and unsupported storage info remains explicit',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);
    const result=await page.evaluate(async()=>{
      const manager=navigator.storage;Object.defineProperty(navigator,'storage',{value:undefined,configurable:true});const info=await queue.storageInfo({requestPersistence:true});delete navigator.storage;
      const {NativeStore}=await import('/store.js');const blocker=await new Promise((resolve,reject)=>{const r=indexedDB.open('helios-test-blocked-upgrade',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const original=IDBFactory.prototype.open;let opened;const completed=new Promise(resolve=>{IDBFactory.prototype.open=function(){const r=original.call(this,'helios-test-blocked-upgrade',2);opened=r;r.addEventListener('success',()=>resolve());return r;};});
      let code;try{code=await NativeStore.open().then(store=>{store.close();return null;},e=>e.code);}finally{IDBFactory.prototype.open=original;blocker.close();}
      await completed;return {code,info,managerPresent:!!manager};
    });assert.equal(result.code,'storage_upgrade_blocked');assert.equal(result.info.persistenceSupported,false);assert.equal(result.info.persisted,null);assert.equal(result.info.estimate,null);assert.equal(result.info.persistenceGranted,null);assert.equal(result.info.error,null);
  }],
);
const evidenceTests = [
  ['atomic event and actual PNG Blob survive persistent reopen with frozen stage identities',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command=event(n);
    const saved=await page.evaluate(async c=>{
      const assertEvidence=typeof queue.enqueueEvidence;const blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,42])],{type:'image/png'});
      await queue.enqueueEvent(c,{evidence:[{projectId:c.projectId,employeeId:c.employeeId,filename:'front.png',contentType:'image/png',blob,dependencyRequestId:c.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:c.requestId}}]});
      return {method:assertEvidence,rows:await queue.list()};
    },command);
    assert.equal(saved.method,'function','standalone evidence authoring must exist');assert.equal(saved.rows.length,2,'event and photo must commit together');
    const photo=saved.rows.find(r=>r.stage!=='event');assert.ok(photo);assert.equal(photo.stage,'queued');assert.notEqual(photo.reserve.requestId,photo.attach.requestId);
    await closeContext(context);({page,context}=await openPage(engine,profile,origin));
    const retained=await page.evaluate(async id=>{const row=await queue.get(id);return {...row,blob:Array.from(new Uint8Array(await row.blob.arrayBuffer()))};},photo.id);
    assert.deepEqual(retained.blob,[137,80,78,71,13,10,26,10,42]);assert.equal(retained.reserve.sha256,await page.evaluate(async()=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array([137,80,78,71,13,10,26,10,42]))),b=>b.toString(16).padStart(2,'0')).join('')));
    assert.deepEqual(retained.reserve,photo.reserve);assert.deepEqual(retained.attach,photo.attach);assert.deepEqual(retained.target,photo.target);
  }],
  ['native evidence request success followed by abort leaves neither event nor Blob nor stream tail',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n);
    const result=await page.evaluate(async c=>{
      const original=IDBObjectStore.prototype.add;let succeeded=false;IDBObjectStore.prototype.add=function(...args){const r=original.apply(this,args);if(this.name==='evidence')r.addEventListener('success',()=>{succeeded=true;this.transaction.abort();},{once:true});return r;};
      let rejected=false;try{await queue.enqueueEvent(c,{evidence:[{projectId:c.projectId,employeeId:c.employeeId,filename:'x.png',contentType:'image/png',blob:new Blob(['png'],{type:'image/png'}),dependencyRequestId:c.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:c.requestId}}]});}catch{rejected=true;}finally{IDBObjectStore.prototype.add=original;}
      return {succeeded,rejected,rows:await queue.list(),resaved:await queue.enqueueEvent(c).then(()=>true,()=>false)};
    },command);assert.equal(result.succeeded,true,'must reach real evidence request success');assert.equal(result.rejected,true);assert.deepEqual(result.rows,[]);assert.equal(result.resaved,true);
  }],
];
if(suite==='evidence') tests.splice(0,tests.length,...evidenceTests);else if(suite==='mechanics')tests.push(...evidenceTests);
let failed=0;
try {
  compiled=join(temporary,'compiled');
  execFileSync(process.execPath,[join(root,'apps/api/node_modules/typescript/bin/tsc'),'--project',join(root,'packages/offline/tsconfig.json'),'--outDir',compiled],{stdio:'inherit'});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  let number=1;
  for (const engineName of ['chromium','webkit']) {
    let passed=0;
    for (const [name,test] of tests) {
      const profile=join(temporary,`${engineName}-${number}`);
      await browserTest(`${engineName} ${suite}: ${name}`,async()=>{
        try {await test(playwright[engineName],profile,origin,number);passed++;}
        catch(error){failed++;throw error;}
        finally {for(const gate of gates)gate.release();gates.clear();meAction=null;actions.clear();for(const context of [...contexts]) await closeContext(context);}
      });
      number++;
    }
    console.log(`${engineName} ${suite}: ${passed}/${tests.length} passed`);
  }
  assert.equal(fixtureErrors.length,0,'owned fixture must not hide protocol assertion failures');
} finally {
  for(const context of [...contexts]) await closeContext(context);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(temporary,{recursive:true,force:true});
}
console.log(`${suite}: ${tests.length*2-failed}/${tests.length*2} required real-browser scenarios passed`);
