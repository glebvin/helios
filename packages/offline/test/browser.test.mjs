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
assert.equal(suite, 'tracer', `Suite ${suite} is not implemented yet (Task2/3 pending); no scenarios skipped`);
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
    version:command.expectedVersion+1, receivedAt:'2027-01-15T06:00:01.000Z',
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
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({userId:actorUserId,tenantId}));return;
      }
      assert.equal(req.url,'/api/v1/execution/events');assert.equal(req.method,'POST');
      const body = JSON.parse(raw);assert.equal(body.events.length,1);
      const command = body.events[0];
      const previous = receipts.get(command.requestId);
      if (previous) assert.deepEqual(command,previous);
      receipts.set(command.requestId,command);
      const requestId = wrongIds.has(command.requestId) ? '99999999-9999-4999-8999-999999999999' : command.requestId;
      res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({results:[{requestId,outcome:previous?'duplicate':'success',status:201,result:resultFor(command)}]}));return;
    }
    if (req.url==='/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Native offline queue tests</title>');return;}
    if (/^\/(index|store)\.js$/.test(req.url)) {
      res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(compiled,req.url.slice(1))));return;
    }
    res.statusCode=404;res.end();
  } catch(error) {res.statusCode=500;res.end(JSON.stringify({code:'fixture_failure',message:error.message}));}
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
        finally {for(const context of [...contexts]) await closeContext(context);}
      });
      number++;
    }
    console.log(`${engineName} ${suite}: ${passed}/${tests.length} passed`);
  }
} finally {
  for(const context of [...contexts]) await closeContext(context);
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await rm(temporary,{recursive:true,force:true});
}
console.log(`${suite}: ${tests.length*2-failed}/${tests.length*2} required real-browser scenarios passed`);
