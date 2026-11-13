import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test as browserTest} from 'node:test';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync,spawnSync,spawn} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
if (!process.env.HELIOS_OFFLINE_TEST_CHILD) {
  const run=spawnSync(process.execPath,['--test','--test-reporter=tap',fileURLToPath(import.meta.url)],{stdio:'inherit',env:{...process.env,HELIOS_OFFLINE_TEST_CHILD:'1',HELIOS_OFFLINE_SUITE:process.argv[2]??'all'}});
  process.exit(run.status??1);
}
const suite = process.env.HELIOS_OFFLINE_SUITE;
assert.ok(['tracer','mechanics','evidence','real','all'].includes(suite), `Unknown required suite ${suite}`);
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
const evidenceReceipts = new Map(), evidenceFiles = new Map();
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
let compiled,real;
const realJournal=[],realDrops=new Set();
const server = createServer(async (req,res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), raw = bytes.toString();
    if (req.url.startsWith('/api/v1/')) {
      if(real){
        const response=await fetch(real.base+req.url,{method:req.method,headers:Object.fromEntries(['authorization','x-tenant-id','content-type'].filter(k=>req.headers[k]).map(k=>[k,req.headers[k]])),...(['GET','HEAD'].includes(req.method)?{}:{body:bytes}),redirect:'error'});
        // Read the whole Nest response first: the real database commit precedes injection.
        const answer=Buffer.from(await response.arrayBuffer());
        const parsed=response.headers.get('content-type')?.includes('application/json')?JSON.parse(answer.toString()):null;
        realJournal.push({method:req.method,path:req.url,raw:raw,bytes,tenant:req.headers['x-tenant-id'],status:response.status,answer:parsed});
        const body=req.method==='POST'?JSON.parse(raw):null;
        const key=body?.events?.[0]?.requestId??body?.requestId??(req.method==='PUT'?req.url.split('/').at(-2):null);
        if(realDrops.delete(key)){
          assert.ok(response.ok,'loss injection requires a real committed successful response');
          res.writeHead(response.status,{'Content-Type':'application/json','Content-Length':String(answer.length+100)});res.write('{',()=>req.socket.destroy());return;
        }
        res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([k])=>!['connection','keep-alive','transfer-encoding','content-length'].includes(k))));res.end(answer);return;
      }
      journal.push({method:req.method,path:req.url,raw,tenant:req.headers['x-tenant-id'],authorized:req.headers.authorization===`Bearer ${token}`});
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      assert.equal(req.headers['x-tenant-id'],tenantId);
      if (req.method==='GET' && req.url==='/api/v1/me') {
        if (meAction?.gate) await meAction.gate.wait();
        if (meAction?.status) {res.statusCode=meAction.status;res.end(meAction.raw??'');return;}
        if (meAction?.body) {res.end(JSON.stringify(meAction.body));return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({userId:actorUserId,tenantId}));return;
      }
      const evidenceRoute = /^\/api\/v1\/projects\/([0-9a-f-]+)\/evidence(?:\/([0-9a-f-]+)\/(content|attachment))?$/.exec(req.url);
      if(evidenceRoute){
        const [,projectId,fileId,stage]=evidenceRoute;let body,answer,key;const readyAt='2027-01-15T06:01:00.000Z';
        if(!stage){
          assert.equal(req.method,'POST');body=JSON.parse(raw);key=body.requestId;
          if(evidenceReceipts.has(key)){assert.deepEqual(evidenceReceipts.get(key).body,body);answer=structuredClone(evidenceReceipts.get(key).answer);}
          else {
            assert.equal(evidenceFiles.has(body.fileId),false,'new reserve cannot overwrite file');
            answer={id:body.fileId,projectId,employeeId:body.employeeId,filename:body.filename,contentType:body.contentType,sizeBytes:body.sizeBytes,sha256:body.sha256,state:'pending',reservedBy:actorUserId,reservedAt:'2027-01-15T06:00:00.000Z',readyBy:null,readyAt:null,onBehalfReason:body.onBehalfReason??null,attachment:null};
            evidenceFiles.set(body.fileId,{metadata:structuredClone(answer),bytes:null});evidenceReceipts.set(key,{body,answer:structuredClone(answer)});
          }
        }else{
          const file=evidenceFiles.get(fileId);assert.ok(file);assert.equal(file.metadata.projectId,projectId);
          if(stage==='content'){
            assert.equal(req.method,'PUT');assert.equal(req.headers['content-type'],'application/octet-stream');key=fileId;
            assert.equal(bytes.length,file.metadata.sizeBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),file.metadata.sha256);
            if(file.bytes)assert.deepEqual(bytes,file.bytes);file.bytes=bytes;Object.assign(file.metadata,{state:'ready',readyBy:actorUserId,readyAt});answer=structuredClone(file.metadata);
          }else{
            assert.equal(req.method,'POST');body=JSON.parse(raw);key=body.requestId;assert.ok(file.bytes);
            if(evidenceReceipts.has(key)){assert.deepEqual(evidenceReceipts.get(key).body,body);answer=structuredClone(evidenceReceipts.get(key).answer);}
            else{
              const dependency=body.target.kind==='execution_event'?receipts.get(body.target.requestId):[...receipts.values()].find(c=>c.reportId===body.target.reportId);
              assert.ok(dependency,'attachment requires a committed event/report');assert.equal(dependency.projectId,projectId);assert.equal(dependency.employeeId,file.metadata.employeeId);assert.equal(file.metadata.attachment,null,'one attachment per file');
              file.metadata.attachment={target:body.target,attachedBy:actorUserId,attachedAt:readyAt,onBehalfReason:body.onBehalfReason??null};answer=structuredClone(file.metadata);evidenceReceipts.set(key,{body,answer:structuredClone(answer)});
            }
          }
        }
        const action=actions.get(key);if(action?.gate)await action.gate.wait();
        if(action?.drop){res.writeHead(stage==='content'?200:201,{'Content-Type':'application/json','Content-Length':'10000'});res.write('{',()=>req.socket.destroy());return;}
        if(action?.status){res.statusCode=action.status;if(action.retryAfter)res.setHeader('Retry-After',action.retryAfter);res.end(action.raw??'');return;}
        res.statusCode=stage==='content'?200:201;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(action?.body?action.body(answer):answer));return;
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
if(suite==='mechanics'||suite==='all') tests.push(
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
  ['acknowledged local history accepts a newer server-read version without skipping pending work',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin),first=event(n);
    await page.evaluate(c=>queue.enqueueEvent(c),first);
    const next={...first,requestId:crypto.randomUUID(),expectedVersion:4,previousEventId:first.requestId};
    assert.equal(await page.evaluate(c=>queue.enqueueEvent(c).then(()=>null,e=>e.code),next),'local_stream_conflict');
    await page.evaluate(()=>queue.flush());
    await page.evaluate(c=>queue.enqueueEvent(c),next);
    await page.evaluate(()=>queue.flush());
    assert.deepEqual(await page.evaluate(()=>queue.list().then(rows=>rows.map(r=>r.state))),['synced','synced']);
    assert.equal(await page.evaluate(c=>queue.enqueueEvent(c).then(()=>null,e=>e.code),{...next,requestId:crypto.randomUUID(),expectedVersion:1}),'local_stream_conflict');
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
    const copies=journal.filter(x=>x.path==='/api/v1/execution/events'&&x.method==='POST'&&JSON.parse(x.raw).events[0].requestId===command.requestId);assert.equal(copies.length,2);assert.equal(copies[0].raw,copies[1].raw);
  }],
  ['lost committed HTTP response reopens with exact command and duplicate acknowledgement',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);actions.set(command.requestId,{drop:true});await page.evaluate(()=>queue.flush());
    assert.notEqual(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');await closeContext(context);actions.delete(command.requestId);
    ({page,context}=await openPage(engine,profile,origin));await page.evaluate(id=>queue.retry(id),command.requestId);await page.evaluate(()=>queue.flush());
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');const copies=journal.filter(x=>x.path==='/api/v1/execution/events'&&x.method==='POST'&&JSON.parse(x.raw).events[0].requestId===command.requestId);assert.equal(copies.length,2);assert.equal(copies[0].raw,copies[1].raw);
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
      const info=await queue.storageInfo({requestPersistence:true});const nativeStorage=navigator.storage;
      // StorageManager is optional even with native IndexedDB (Linux WebKit).
      // Keep the native capability check, then inject only the diagnostic API;
      // quota, durability, versionchange and queue data still use real IndexedDB.
      {
        if(info.persistenceSupported!==!!nativeStorage?.persist)throw new Error('native persistence capability mismatch');
        if(!nativeStorage&&(info.persisted!==null||info.estimate!==null||info.persistenceGranted!==null||info.error!==null))throw new Error('missing StorageManager must stay explicit');
      }
      const descriptor=Object.getOwnPropertyDescriptor(navigator,'storage');
      const storage={persisted:async()=>true,estimate:async()=>({usage:123,quota:456}),persist:async()=>false};let explicit,failure;
      Object.defineProperty(navigator,'storage',{value:storage,configurable:true});
      try {
        explicit=await queue.storageInfo({requestPersistence:true});storage.estimate=async()=>{throw new Error('private diagnostic');};failure=await queue.storageInfo();
      } finally {
        if(descriptor)Object.defineProperty(navigator,'storage',descriptor);else delete navigator.storage;
      }
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
async function savePhoto(page,command,options={}){
  return page.evaluate(async({command,options})=>{
    if(!await queue.get(command.requestId))await queue.enqueueEvent(command);
    const input={projectId:command.projectId,employeeId:command.employeeId,filename:'photo.png',contentType:'image/png',blob:new Blob([new Uint8Array([137,80,78,71,13,10,26,10,42])],{type:'image/png'}),dependencyRequestId:command.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:command.requestId},...options};
    return queue.enqueueEvidence(input);
  },{command,options});
}
const evidenceTests = [
  ['standalone authoring retains validated metadata when caller edits it before save resolves',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command=event(n);
    const saved=await page.evaluate(async c=>{
      await queue.enqueueEvent(c);
      const input={projectId:c.projectId,employeeId:c.employeeId,filename:' original.png ',contentType:'image/png',onBehalfReason:' Original reason ',blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),dependencyRequestId:c.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:c.requestId},fileId:crypto.randomUUID(),reserveRequestId:crypto.randomUUID(),attachRequestId:crypto.randomUUID()};
      const pending=queue.enqueueEvidence(input);
      input.filename='changed.pdf';input.contentType='text/plain';input.onBehalfReason='Changed reason';
      return pending.then(row=>({id:row.id,error:null}),error=>({id:input.fileId,error:error.code}));
    },command);
    await closeContext(context);({page,context}=await openPage(engine,profile,origin));
    const retained=await page.evaluate(async id=>{const row=await queue.get(id);return row&&{filename:row.reserve.filename,contentType:row.reserve.contentType,reason:row.reserve.onBehalfReason,attachReason:row.attach.onBehalfReason,actual:row.blob.type,bytes:[...new Uint8Array(await row.blob.arrayBuffer())],state:row.state};},saved.id);
    assert.equal(saved.error,null,'valid original metadata must save');
    assert.deepEqual(retained,{filename:'original.png',contentType:'image/png',reason:'Original reason',attachReason:'Original reason',actual:'image/png',bytes:[137,80,78,71],state:'pending'});
  }],
  ['event authoring snapshots requested photos before caller clears or replaces the array',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command=event(n);
    const saved=await page.evaluate(async c=>{
      const outcomes=[];
      for(const mode of ['clear','replace']){
        const original={...c,requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()},input={...original};
        const photo={projectId:original.projectId,employeeId:original.employeeId,filename:`${mode}.png`,contentType:'image/png',blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),dependencyRequestId:original.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:original.requestId},fileId:crypto.randomUUID()};
        const photos=[photo],options={evidence:photos},pending=queue.enqueueEvent(input,options);
        input.occurredAt='2027-01-15T10:00:00+03:00';
        if(mode==='clear')photos.length=0;
        else {photos[0]={...photo,filename:'replacement.png',fileId:crypto.randomUUID()};options.evidence=[];}
        outcomes.push({event:original,fileId:photo.fileId,filename:photo.filename,error:await pending.then(()=>null,error=>error.code)});
      }
      return outcomes;
    },command);
    await closeContext(context);({page,context}=await openPage(engine,profile,origin));
    for(const original of saved){
      const retained=await page.evaluate(async original=>{const rows=await queue.list();return {event:rows.find(row=>row.id===original.event.requestId)?.event,photos:rows.filter(row=>row.stage!=='event'&&row.dependencyRequestId===original.event.requestId).map(row=>({id:row.id,filename:row.reserve.filename}))};},original);
      assert.equal(original.error,null,'valid event and original photo must save');assert.deepEqual(retained.event,original.event);
      assert.deepEqual(retained.photos,[{id:original.fileId,filename:original.filename}],'requested photo must survive caller array mutation');
      assert.deepEqual(await page.evaluate(async id=>[...new Uint8Array(await (await queue.get(id)).blob.arrayBuffer())],original.fileId),[137,80,78,71]);
    }
  }],
  ['bundled authoring owns every photo target and identity before asynchronous hashing',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command={...event(n),kind:'submit_volume',taskId:'77777777-7777-4777-8777-777777777777',reportId:'88888888-8888-4888-8888-888888888888',submittedQuantity:'1.250'};
    const saved=await page.evaluate(async c=>{
      const photos=['execution_event','final_report'].map(kind=>({projectId:c.projectId,employeeId:c.employeeId,filename:`${kind}.png`,contentType:'image/png',onBehalfReason:'Original delegation',blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),dependencyRequestId:c.requestId,target:kind==='execution_event'?{kind,actorUserId:session.actorUserId,requestId:c.requestId}:{kind,reportId:c.reportId},fileId:crypto.randomUUID(),reserveRequestId:crypto.randomUUID(),attachRequestId:crypto.randomUUID()}));
      const expected=structuredClone(photos.map(({blob,...input})=>input)),pending=queue.enqueueEvent(c,{evidence:photos});
      c.occurredAt='2027-01-15T10:00:00+03:00';
      for(const photo of photos){
        for(const key of ['projectId','employeeId','dependencyRequestId','fileId','reserveRequestId','attachRequestId'])photo[key]=crypto.randomUUID();
        if(photo.target.kind==='execution_event'){photo.target.actorUserId=crypto.randomUUID();photo.target.requestId=crypto.randomUUID();}else photo.target.reportId=crypto.randomUUID();
        photo.filename='changed.pdf';photo.contentType='application/pdf';photo.onBehalfReason='Changed delegation';photo.blob=new Blob(['changed'],{type:'application/pdf'});
      }
      return {expected,error:await pending.then(()=>null,error=>error.code)};
    },command);
    await closeContext(context);({page,context}=await openPage(engine,profile,origin));
    assert.equal(saved.error,null,'valid original targets and identities must save despite later edits');
    assert.deepEqual(await page.evaluate(async id=>(await queue.get(id))?.event,command.requestId),command);
    for(const expected of saved.expected){
      const row=await page.evaluate(async id=>{const row=await queue.get(id);return row&&{id:row.id,projectId:row.projectId,employeeId:row.employeeId,dependencyRequestId:row.dependencyRequestId,target:row.target,reserve:row.reserve,attach:row.attach,bytes:[...new Uint8Array(await row.blob.arrayBuffer())],actual:row.blob.type};},expected.fileId);
      assert.deepEqual(row,{id:expected.fileId,projectId:expected.projectId,employeeId:expected.employeeId,dependencyRequestId:expected.dependencyRequestId,target:expected.target,reserve:{requestId:expected.reserveRequestId,fileId:expected.fileId,employeeId:expected.employeeId,filename:expected.filename,contentType:'image/png',sizeBytes:4,sha256:createHash('sha256').update(Buffer.from([137,80,78,71])).digest('hex'),onBehalfReason:expected.onBehalfReason},attach:{requestId:expected.attachRequestId,target:expected.target,onBehalfReason:expected.onBehalfReason},bytes:[137,80,78,71],actual:'image/png'});
    }
  }],
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
  ['fixed private reserve PUT attachment pipeline, both known local targets and explicit cleanup',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin),command=event(n);const start=journal.length;const photo=await savePhoto(page,command);
    assert.equal(await page.evaluate(id=>queue.cleanupAcknowledged([id]).then(()=>null,e=>e.code),photo.id),'cleanup_requires_acknowledgement');
    // Event acknowledgement is separate from its blocked/pending photo.
    actions.set(photo.reserve.requestId,{status:503});await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),command.requestId),'synced');
    assert.equal(await page.evaluate(id=>queue.cleanupAcknowledged([id]).then(()=>null,e=>e.code),command.requestId),'pending_dependency');
    actions.delete(photo.reserve.requestId);await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());
    const file=await page.evaluate(async id=>{const r=await queue.get(id);return {stage:r.stage,state:r.state,bytes:[...new Uint8Array(await r.blob.arrayBuffer())]};},photo.id);
    assert.deepEqual(file,{stage:'synced',state:'synced',bytes:[137,80,78,71,13,10,26,10,42]});
    const calls=journal.slice(start).filter(x=>x.path.includes('/evidence'));assert.deepEqual(calls.map(x=>x.method),['POST','POST','PUT','POST']);assert.equal(calls[1].raw,calls[0].raw);
    assert.deepEqual(evidenceFiles.get(photo.id).bytes,Buffer.from(file.bytes));assert.equal(evidenceReceipts.get(photo.attach.requestId).body.target.requestId,command.requestId);
    await page.evaluate(ids=>queue.cleanupAcknowledged(ids),[command.requestId,photo.id]);assert.equal((await page.evaluate(()=>queue.list())).length,0);
    const tombstone=await page.evaluate(async({command,photo})=>{
      const row=await queue.enqueueEvidence({projectId:command.projectId,employeeId:command.employeeId,filename:'photo.png',contentType:'image/png',blob:new Blob([new Uint8Array([137,80,78,71,13,10,26,10,42])],{type:'image/png'}),dependencyRequestId:command.requestId,target:photo.target,fileId:photo.id,reserveRequestId:photo.reserve.requestId,attachRequestId:photo.attach.requestId});return {state:row.state,count:(await queue.list()).length};
    },{command,photo});assert.deepEqual(tombstone,{state:'synced',count:0});
    // Tombstoned event remains a known supported dependency for new evidence.
    const another=await savePhoto(page,command);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),another.id),'synced');
    const report={...event(n+100000),requestId:crypto.randomUUID(),kind:'submit_volume',taskId:crypto.randomUUID(),reportId:crypto.randomUUID(),submittedQuantity:'1.25'};
    const reportPhoto=await savePhoto(page,report,{target:{kind:'final_report',reportId:report.reportId}});await page.evaluate(()=>queue.flush());
    assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.stage),reportPhoto.id),'synced');assert.deepEqual(evidenceFiles.get(reportPhoto.id).metadata.attachment.target,{kind:'final_report',reportId:report.reportId});
  }],
  ['lost replies and failed native local stage commits replay identical identities bytes and snapshots',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);
    for(const failure of ['response','local_commit'])for(const stage of ['queued','reserved','uploaded']){
      console.log(`replay boundary ${failure}/${stage}`);
      const command={...event(n),requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()},photo=await savePhoto(page,command);
      const key=stage==='queued'?photo.reserve.requestId:stage==='reserved'?photo.id:photo.attach.requestId,start=journal.length;
      if(failure==='response')actions.set(key,{drop:true});else await page.evaluate(({id,stage})=>{
        const original=IDBObjectStore.prototype.put;globalThis.restoreStage=()=>{IDBObjectStore.prototype.put=original;};
        IDBObjectStore.prototype.put=function(...args){const r=original.apply(this,args);if(this.name==='evidence'&&args[0].id===id&&args[0].stage===({queued:'reserved',reserved:'uploaded',uploaded:'synced'})[stage])r.addEventListener('success',()=>this.transaction.abort(),{once:true});return r;};
      },{id:photo.id,stage});
      const result=await page.evaluate(()=>queue.flush().then(()=>null,e=>e.code??e.name));if(failure==='local_commit')assert.ok(result,'local native abort must reject flush');
      assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.stage),photo.id),stage);
      assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.blob.size),photo.id),9);
      await closeContext(context);actions.delete(key);({page,context}=await openPage(engine,profile,origin));
      await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),photo.id),'synced',`${failure}/${stage}: ${JSON.stringify(await page.evaluate(id=>queue.get(id).then(({blob,...r})=>r),photo.id))}`);
      const route=`/api/v1/projects/${command.projectId}/evidence${stage==='queued'?'':`/${photo.id}/${stage==='reserved'?'content':'attachment'}`}`;
      const copies=journal.slice(start).filter(x=>x.path===route);assert.equal(copies.length,2,`${failure}/${stage} must replay exactly the interrupted stage`);assert.equal(copies[0].raw,copies[1].raw);
      assert.equal(evidenceFiles.get(photo.id).metadata.attachment.attachedBy,actorUserId);
    }
  }],
  ['evidence responses require exact declaration actor timestamps state target and status at every stage',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);
    for(const stage of ['queued','reserved','uploaded']){
      const command={...event(n),requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()},photo=await savePhoto(page,command),key=stage==='queued'?photo.reserve.requestId:stage==='reserved'?photo.id:photo.attach.requestId;
      const wrong=[['id',crypto.randomUUID()],['projectId',crypto.randomUUID()],['employeeId',crypto.randomUUID()],['filename','other.png'],['contentType','application/pdf'],['sizeBytes',10],['sha256','f'.repeat(64)],['reservedBy',crypto.randomUUID()],['reservedAt','bad'],['state','unknown'],['onBehalfReason','invented']];
      if(stage!=='queued')wrong.push(['state','pending'],['readyAt','bad'],['readyBy',null]);
      if(stage==='uploaded')wrong.push(['attachment',null],['attachment',{target:{kind:'final_report',reportId:crypto.randomUUID()},attachedBy:actorUserId,attachedAt:'2027-01-15T00:00:00Z',onBehalfReason:null}],['attachment',{target:photo.target,attachedBy:crypto.randomUUID(),attachedAt:'2027-01-15T00:00:00Z',onBehalfReason:null}],['attachment',{target:photo.target,attachedBy:actorUserId,attachedAt:'bad',onBehalfReason:null}]);
      for(const [field,value]of wrong){actions.set(key,{body:body=>({...body,[field]:value})});await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());const row=await page.evaluate(id=>queue.get(id),photo.id);assert.equal(row.stage,stage,field);assert.equal(row.state,'retry_wait',field);assert.equal(row.lastError,'ambiguous_response',field);assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.blob.size),photo.id),9);}
      actions.set(key,{status:202});await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),photo.id),'retry_wait');
      actions.delete(key);await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),photo.id),'synced');
    }
  }],
  ['session changes after reservation stop upload and stale stage commit; auth failures retain Blob',async(engine,profile,origin,n)=>{
    let {page,context}=await openPage(engine,profile,origin);const command=event(n),photo=await savePhoto(page,command),gate=barrier();actions.set(photo.reserve.requestId,{gate});
    const flushing=page.evaluate(()=>queue.flush().then(()=>null,e=>e.code));await gate.entered;await page.evaluate(()=>{session={...session,token:'changed',generation:session.generation+1};});gate.release();assert.equal(await flushing,'session_changed');actions.delete(photo.reserve.requestId);
    assert.equal(journal.filter(x=>x.path.includes(photo.id+'/content')).length,0);await closeContext(context);({page,context}=await openPage(engine,profile,origin));assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.stage),photo.id),'queued');
    for(const [status,state]of [[401,'auth-required'],[403,'blocked'],[404,'blocked'],[429,'retry_wait'],[500,'retry_wait']]){
      actions.set(photo.reserve.requestId,{status});await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.state),photo.id),state);assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.blob.size),photo.id),9);
    }
    actions.delete(photo.reserve.requestId);await page.evaluate(id=>queue.retry(id),photo.id);await page.evaluate(()=>queue.flush());assert.equal(await page.evaluate(id=>queue.get(id).then(r=>r.stage),photo.id),'synced');
  }],
  ['known-local dependencies frozen IDs idempotence collisions and scope guards',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin);const command=event(n),photo=await savePhoto(page,command);
    const results=await page.evaluate(async({command,photo})=>{
      const blob=new Blob([new Uint8Array([137,80,78,71,13,10,26,10,42])],{type:'image/png'}),base={projectId:command.projectId,employeeId:command.employeeId,filename:'photo.png',contentType:'image/png',blob,dependencyRequestId:command.requestId,target:photo.target,fileId:photo.id,reserveRequestId:photo.reserve.requestId,attachRequestId:photo.attach.requestId};
      const same=await queue.enqueueEvidence(base),bad=[];
      for(const patch of [{filename:'changed.png'},{reserveRequestId:command.requestId},{attachRequestId:photo.reserve.requestId},{fileId:photo.attach.requestId},{projectId:crypto.randomUUID()},{employeeId:crypto.randomUUID()},{target:{kind:'execution_event',actorUserId:crypto.randomUUID(),requestId:command.requestId}},{target:{kind:'final_report',reportId:crypto.randomUUID()}},{dependencyRequestId:crypto.randomUUID()}])bad.push(await queue.enqueueEvidence({...base,...patch}).then(()=>null,e=>e.code));
      const eventCollision=await queue.enqueueEvent({...command,requestId:photo.reserve.requestId,employeeId:crypto.randomUUID()}).then(()=>null,e=>e.code);
      const {openOfflineQueue}=await import('/index.js'),original={...session},scopes=[];
      for(const change of [{actorUserId:crypto.randomUUID()},{tenantId:crypto.randomUUID()},{audience:`${location.origin}/other/api/v1`}]){
        session={...original,...change,generation:session.generation+1};const other=await openOfflineQueue({audience:change.audience??`${location.origin}/api/v1`,tenantId:session.tenantId,actorUserId:session.actorUserId,getSession:()=>session});
        scopes.push({count:(await other.list()).length,file:await other.get(photo.id)});other.close();
      }session=original;
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('helios-managed-offline');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const stored=await new Promise((resolve,reject)=>{const tx=db.transaction(['meta','events','evidence']),rows=[];for(const name of ['meta','events','evidence']){const r=tx.objectStore(name).getAll();r.onsuccess=()=>rows.push(...r.result);}tx.oncomplete=()=>resolve(JSON.stringify(rows));tx.onabort=()=>reject(tx.error);});db.close();
      if(stored.includes(session.token))throw new Error('bearer persisted');

      session={...session,tenantId:crypto.randomUUID(),generation:session.generation+1};const auth=await queue.enqueueEvidence(base).then(()=>null,e=>e.code);return {same:same.id,bad,eventCollision,auth,scopes};
    },{command,photo});assert.equal(results.same,photo.id);assert.ok(results.bad.every(Boolean));assert.equal(results.eventCollision,'local_identity_conflict');assert.equal(results.auth,'auth_required');assert.deepEqual(results.scopes,[{count:0,file:null},{count:0,file:null},{count:0,file:null}]);
  }],
  ['strict file declarations hash failures and atomic whole database 32-file count cap',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin),command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);
    const result=await page.evaluate(async c=>{
      const base={projectId:c.projectId,employeeId:c.employeeId,filename:'photo.png',contentType:'image/png',blob:new Blob(['x'],{type:'image/png'}),dependencyRequestId:c.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:c.requestId}},bad=[];
      for(const patch of [{blob:new Blob([],{type:'image/png'})},{blob:new Blob([new Uint8Array(8*1024*1024+1)],{type:'image/png'})},{contentType:'text/plain'},{blob:new Blob(['x'],{type:'image/jpeg'})},{filename:''},{filename:'bad\u0000.png'},{extra:undefined}])bad.push(await queue.enqueueEvidence({...base,...patch}).then(()=>null,e=>e.code));
      const digest=crypto.subtle.digest;crypto.subtle.digest=async()=>{throw new Error('injected hash failure');};let hashFailed;try{hashFailed=await queue.enqueueEvidence(base).then(()=>false,()=>true);}finally{crypto.subtle.digest=digest;}
      const initial=(await queue.list()).length;for(let i=0;i<32;i++)await queue.enqueueEvidence(base);
      const overflow=await queue.enqueueEvidence(base).then(()=>null,e=>e.code);return {bad,hashFailed,initial,overflow,count:(await queue.list()).filter(r=>r.stage!=='event').length};
    },command);assert.ok(result.bad.every(Boolean));assert.equal(result.hashFailed,true);assert.equal(result.initial,1);assert.equal(result.overflow,'capacity_exceeded');assert.equal(result.count,32);
    const other=await page.evaluate(async ({command})=>{const {openOfflineQueue}=await import('/index.js');const original=queue;const actor=crypto.randomUUID();session={...session,actorUserId:actor};queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId:session.tenantId,actorUserId:actor,getSession:()=>session});await queue.enqueueEvent(command);try{return await queue.enqueueEvidence({projectId:command.projectId,employeeId:command.employeeId,filename:'x.png',contentType:'image/png',blob:new Blob(['x'],{type:'image/png'}),dependencyRequestId:command.requestId,target:{kind:'execution_event',actorUserId:actor,requestId:command.requestId}}).then(()=>null,e=>e.code);}finally{queue.close();}},{command});assert.equal(other,'capacity_exceeded');
  }],
  ['maximum 8MiB Blob and aggregate 64MiB limit include retained records and atomically reject related event',async(engine,profile,origin,n)=>{
    const {page}=await openPage(engine,profile,origin),command=event(n);await page.evaluate(c=>queue.enqueueEvent(c),command);
    const result=await page.evaluate(async c=>{
      const base={projectId:c.projectId,employeeId:c.employeeId,filename:'large.png',contentType:'image/png',blob:new Blob([new Uint8Array(8*1024*1024)],{type:'image/png'}),dependencyRequestId:c.requestId,target:{kind:'execution_event',actorUserId:session.actorUserId,requestId:c.requestId}};
      for(let i=0;i<8;i++)await queue.enqueueEvidence(base);
      const next={...c,requestId:crypto.randomUUID(),expectedVersion:1,previousEventId:c.requestId};const overflow=await queue.enqueueEvent(next,{evidence:[{...base,blob:new Blob(['x'],{type:'image/png'}),dependencyRequestId:next.requestId,target:{...base.target,requestId:next.requestId}}]}).then(()=>null,e=>e.code);
      const absent=await queue.get(next.requestId),saved=await queue.enqueueEvent(next).then(()=>true,()=>false);return {overflow,absent,saved,count:(await queue.list()).filter(r=>r.stage!=='event').length};
    },command);assert.deepEqual(result,{overflow:'capacity_exceeded',absent:null,saved:true,count:8});
  }],
];
async function startRealFixture(){
  const child=spawn(process.execPath,['--import',pathToFileURL(join(root,'apps/api/node_modules/tsx/dist/loader.mjs')).href,join(root,'packages/offline/test/real-api.ts')],{cwd:join(root,'apps/api'),env:{...process.env,TSX_TSCONFIG_PATH:join(root,'apps/api/tsconfig.json')},stdio:['ignore','ignore','inherit','ipc']});
  const pending=new Map();let nextId=0,exitCode;
  const exited=new Promise(resolve=>child.once('exit',(code,signal)=>{exitCode=code;for(const {reject,timer}of pending.values()){clearTimeout(timer);reject(new Error(`Owned real fixture exited ${code}/${signal}`));}pending.clear();resolve({code,signal});}));
  const ready=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Real fixture startup timed out')),30000);
    child.once('error',e=>{clearTimeout(timer);reject(e);});
    child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Real fixture startup exited ${code}`));});
    child.on('message',message=>{
      if(message.ready){clearTimeout(timer);resolve(message);return;}
      const call=pending.get(message.id);if(!call)return;pending.delete(message.id);clearTimeout(call.timer);
      if(message.error)call.reject(new Error(message.error));else call.resolve(message.result);
    });
  }).catch(async error=>{if(child.connected)child.disconnect();await exited;throw error;});
  function call(method,args={}){return new Promise((resolve,reject)=>{
    const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Real fixture ${method} timed out`));},30000);
    pending.set(id,{resolve,reject,timer});child.send({id,method,args},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
  });}
  console.log(`Owned real Nest PID ${ready.pid}, random listener; locked PG54339 identity passed`);
  return {base:ready.base,call,async close(){
    try{assert.equal((await call('close')).cleaned,true);}finally{if(child.connected)child.disconnect();const result=await exited;assert.equal(result.code,0,`owned fixture exit ${exitCode}`);}
    console.log('Owned real Nest/IPC/pools/private storage closed; fixture rows removed');
  }};
}
async function openRealPage(engine,profile,origin,f){
  const context=await engine.launchPersistentContext(profile,{headless:true});contexts.add(context);
  const page=context.pages()[0]??await context.newPage();await page.goto(origin);
  await page.evaluate(async f=>{
    const {openOfflineQueue}=await import('/index.js');globalThis.session={token:f.token,tenantId:f.tenantId,actorUserId:f.actorUserId,generation:1};
    globalThis.queue=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId:f.tenantId,actorUserId:f.actorUserId,getSession:()=>session});
  },f);return {context,page};
}
async function disconnectRealApi(context,page){
  // WebKit's setOffline(true) also breaks new Blob.arrayBuffer() without this module.
  // Abort actual API network requests only; leave native local I/O intact.
  await context.route('**/api/v1/**',route=>route.abort('internetdisconnected'));
  assert.equal(await page.evaluate(()=>fetch('/api/v1/me').then(()=>false,()=>true)),true,'real browser API transport must be unavailable before offline authoring');
}
function realChain(f){
  const shiftId=crypto.randomUUID(),reportId=crypto.randomUUID(),requestIds=Array.from({length:4},()=>crypto.randomUUID());
  return ['shift_start','segment_change','shift_end','submit_volume'].map((kind,i)=>({kind,requestId:requestIds[i],projectId:f.projectId,employeeId:f.employeeId,shiftId,expectedVersion:i,occurredAt:`2027-01-15T${['09:00','09:05','10:00','10:00'][i]}:00+03:00`,...(i?{previousEventId:requestIds[i-1]}:{}),...(i===1?{mode:'work',taskId:f.taskId}:{}),...(i===3?{taskId:f.taskId,reportId,submittedQuantity:'1.250'}:{})}));
}
const realPng=Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
async function saveRealChain(page,chain,actor){
  return page.evaluate(async({chain,actor,bytes})=>{
    const photos=[];
    for(const [i,command]of chain.entries()){
      const evidence=i===0||i===3?[{projectId:command.projectId,employeeId:command.employeeId,filename:'real-photo.png',contentType:'image/png',blob:new Blob([new Uint8Array(bytes)],{type:'image/png'}),dependencyRequestId:command.requestId,target:i===0?{kind:'execution_event',actorUserId:actor,requestId:command.requestId}:{kind:'final_report',reportId:command.reportId}}]:[];
      await queue.enqueueEvent(command,{evidence});
      if(evidence.length){const row=(await queue.list()).find(r=>r.stage!=='event'&&r.dependencyRequestId===command.requestId);photos.push({id:row.id,reserve:row.reserve,attach:row.attach,target:row.target});}
    }return photos;
  },{chain,actor,bytes:[...realPng]});
}
async function assertRealLocal(page,chain,photos,synced){
  const rows=await page.evaluate(async({chain,photos})=>({events:await Promise.all(chain.map(c=>queue.get(c.requestId))),photos:await Promise.all(photos.map(async p=>{const r=await queue.get(p.id);return {id:r.id,stage:r.stage,state:r.state,bytes:[...new Uint8Array(await r.blob.arrayBuffer())]};}))}),{chain,photos});
  assert.deepEqual(rows.events.map(r=>r.event),chain,'real delivery never rewrites frozen commands');
  assert.deepEqual(rows.photos.map(r=>r.bytes),photos.map(()=>[...realPng]));
  if(synced){assert.ok(rows.events.every(r=>r.state==='synced'));assert.ok(rows.photos.every(r=>r.stage==='synced'&&r.state==='synced'));}
  return rows;
}
const realTests=[
  ['real Nest/PG: offline lifecycle and event/report Blobs survive reopen and committed lost replies replay exactly once',async(engine,profile,origin)=>{
    const f=await real.call('create'),chain=realChain(f),start=realJournal.length;
    let {context,page}=await openRealPage(engine,profile,origin,f);await disconnectRealApi(context,page);
    const photos=await saveRealChain(page,chain,f.actorUserId);await assertRealLocal(page,chain,photos,false);await closeContext(context);
    ({context,page}=await openRealPage(engine,profile,origin,f));await assertRealLocal(page,chain,photos,false);
    // Each fresh loss is observed after Nest returned a successful committed response.
    let failedId=chain[0].requestId;
    for(const [key,id,stage]of [[chain[0].requestId,chain[0].requestId,'event'],[photos[0].reserve.requestId,photos[0].id,'queued'],[photos[0].id,photos[0].id,'reserved'],[photos[0].attach.requestId,photos[0].id,'uploaded']]){
      console.log(`real committed-reply replay boundary ${stage}`);
      realDrops.add(key);await page.evaluate(id=>queue.retry(id),failedId);
      const flushed=await page.evaluate(()=>queue.flush().then(result=>({result}),async error=>({error:{name:error.name,code:error.code,message:error.message,stack:error.stack},rows:(await queue.list()).map(({id,stage,state,lastError})=>({id,stage,state,lastError}))})));
      assert.equal(flushed.error,undefined,JSON.stringify(flushed));failedId=id;
      const row=await page.evaluate(id=>queue.get(id),id);assert.equal(row.state,'retry_wait');assert.equal(row.stage,stage);
      assert.equal(realDrops.has(key),false,'required real response loss was exercised');
      await closeContext(context);({context,page}=await openRealPage(engine,profile,origin,f));await assertRealLocal(page,chain,photos,false);
    }
    await page.evaluate(id=>queue.retry(id),photos[0].id);await page.evaluate(()=>queue.flush());await assertRealLocal(page,chain,photos,true);
    const snapshot=await real.call('snapshot',f);
    assert.deepEqual(snapshot.events.map(r=>r.original_payload),chain);assert.deepEqual(snapshot.events.map(r=>r.version),[1,2,3,4]);
    assert.deepEqual(snapshot.segments.map(r=>[r.mode,r.ms]),[['idle','300000.000000'],['work','3300000.000000']]);
    assert.deepEqual(snapshot.reports,[{id:chain[3].reportId,quantity:'1.250'}]);
    for(const c of chain){assert.equal(snapshot.receipts.filter(r=>r.request_id===c.requestId).length,1);assert.equal(snapshot.audits.filter(r=>r.details?.requestId===c.requestId).length,1);}
    for(const photo of photos){
      assert.equal(snapshot.files.filter(r=>r.id===photo.id&&r.state==='ready').length,1);
      assert.equal(snapshot.attachments.filter(r=>r.file_id===photo.id).length,1);
      const binding=snapshot.attachments.find(r=>r.file_id===photo.id);
      assert.equal(binding.project_id,f.projectId);assert.equal(binding.employee_id,f.employeeId);assert.equal(binding.attached_by,f.actorUserId);assert.equal(binding.target_kind,photo.target.kind);
      if(photo.target.kind==='execution_event'){assert.equal(binding.event_actor_user_id,f.actorUserId);assert.equal(binding.event_request_id,chain[0].requestId);assert.equal(binding.report_id,null);}
      else {assert.equal(binding.report_id,chain[3].reportId);assert.equal(binding.event_actor_user_id,null);assert.equal(binding.event_request_id,null);}
      for(const requestId of [photo.reserve.requestId,photo.attach.requestId]){assert.equal(snapshot.receipts.filter(r=>r.request_id===requestId).length,1);assert.equal(snapshot.audits.filter(r=>r.details?.requestId===requestId).length,1);}
      assert.equal(snapshot.audits.filter(r=>r.object_id===photo.id&&r.action==='evidence_ready').length,1);
      const download=await page.evaluate(async({f,id})=>{const r=await fetch(`/api/v1/projects/${f.projectId}/evidence/${id}/content`,{headers:{authorization:`Bearer ${session.token}`,'x-tenant-id':f.tenantId}});return {status:r.status,bytes:[...new Uint8Array(await r.arrayBuffer())]};},{f,id:photo.id});
      assert.equal(download.status,200);assert.deepEqual(download.bytes,[...realPng]);assert.equal(createHash('sha256').update(Buffer.from(download.bytes)).digest('hex'),snapshot.files.find(r=>r.id===photo.id).sha256);
    }
    const calls=realJournal.slice(start),eventCalls=calls.filter(r=>r.path==='/api/v1/execution/events');
    assert.equal(eventCalls.length,5);assert.deepEqual(eventCalls.slice(0,2).map(r=>JSON.parse(r.raw)),[{events:[chain[0]]},{events:[chain[0]]}]);assert.deepEqual(eventCalls.slice(0,2).map(r=>r.answer.results[0].outcome),['success','duplicate']);
    for(const [path,method]of [[`/api/v1/projects/${f.projectId}/evidence`,'POST'],[`/api/v1/projects/${f.projectId}/evidence/${photos[0].id}/content`,'PUT'],[`/api/v1/projects/${f.projectId}/evidence/${photos[0].id}/attachment`,'POST']]){
      const copies=calls.filter(r=>r.path===path&&r.method===method&&(path.endsWith('/evidence')?JSON.parse(r.raw).fileId===photos[0].id:true));assert.equal(copies.length,2);assert.deepEqual(copies[0].bytes,copies[1].bytes);assert.deepEqual(copies[0].answer,copies[1].answer);
    }
    const before=realJournal.length;await closeContext(context);({context,page}=await openRealPage(engine,profile,origin,f));await assertRealLocal(page,chain,photos,true);await page.evaluate(()=>queue.flush());assert.equal(realJournal.slice(before).filter(r=>r.method!=='GET').length,0);
  }],
  ...['stale','revoked','expired'].map(kind=>[`real Nest/PG: ${kind} authority/conflict retains original events and Blobs and fences successors`,async(engine,profile,origin)=>{
    const f=await real.call('create'),chain=realChain(f);
    let {context,page}=await openRealPage(engine,profile,origin,f);await disconnectRealApi(context,page);const photos=await saveRealChain(page,chain,f.actorUserId);await closeContext(context);
    await real.call({stale:'advance',revoked:'revoke',expired:'expire'}[kind],f);
    ({context,page}=await openRealPage(engine,profile,origin,f));const start=realJournal.length;await page.evaluate(()=>queue.flush());
    const rows=await assertRealLocal(page,chain,photos,false);
    assert.ok(rows.events.every(r=>r.state!=='synced'));assert.ok(rows.photos.every(r=>r.stage==='queued'));
    assert.equal(rows.events[0].state,kind==='expired'?'auth-required':'blocked');
    if(kind==='stale')assert.equal(rows.events[0].lastError,'stale_version');
    const calls=realJournal.slice(start);assert.equal(calls.filter(r=>r.path==='/api/v1/execution/events').length,kind==='stale'?1:0);assert.equal(calls.filter(r=>r.path.includes('/evidence')).length,0);
    const snapshot=await real.call('snapshot',f);assert.equal(snapshot.events.length,kind==='stale'?1:0);assert.equal(snapshot.files.length,0);assert.equal(snapshot.attachments.length,0);assert.equal(snapshot.reports.length,0);
    for(const c of chain){assert.equal(snapshot.receipts.filter(r=>r.request_id===c.requestId).length,0);assert.equal(snapshot.audits.filter(r=>r.details?.requestId===c.requestId).length,0);}
    await closeContext(context);({context,page}=await openRealPage(engine,profile,origin,f));await assertRealLocal(page,chain,photos,false);
  }]),
];
if(suite==='evidence')tests.splice(0,tests.length,...evidenceTests);
else if(suite==='mechanics'||suite==='all')tests.push(...evidenceTests);
if(suite==='real')tests.splice(0,tests.length,...realTests);else if(suite==='all')tests.push(...realTests);
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
      if(name.startsWith('real Nest/PG:')&&!real)real=await startRealFixture();
      if(!name.startsWith('real Nest/PG:')&&real){await real.close();real=null;}
      const profile=join(temporary,`${engineName}-${number}`);
      await browserTest(`${engineName} ${suite}: ${name}`,async()=>{
        try {await test(playwright[engineName],profile,origin,number);passed++;}
        catch(error){failed++;throw error;}
        finally {for(const gate of gates)gate.release();gates.clear();meAction=null;actions.clear();realDrops.clear();for(const context of [...contexts]) await closeContext(context);}
      });
      number++;
    }
    console.log(`${engineName} ${suite}: ${passed}/${tests.length} passed`);
  }
  assert.equal(fixtureErrors.length,0,`owned fixture must not hide protocol assertion failures: ${fixtureErrors.map(error=>error.message).join('; ')}`);
} finally {
  for(const context of [...contexts]) await closeContext(context);
  if(real){await real.close();real=null;}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(temporary,{recursive:true,force:true});
}
console.log(`${suite}: ${tests.length*2-failed}/${tests.length*2} required real-browser scenarios passed`);
