import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root=process.cwd(),temporary=await mkdtemp(join(tmpdir(),'helios-verifier-mutable-'));
const playwright=await import(pathToFileURL(process.env.HELIOS_PLAYWRIGHT_MODULE));
const compiled=join(temporary,'compiled');let context,failed=0;
execFileSync(process.execPath,[join(root,'apps/api/node_modules/typescript/bin/tsc'),'--project',join(root,'packages/offline/tsconfig.json'),'--outDir',compiled]);
const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Independent mutable input probe</title>');return;}
  if(/^\/(index|store|transport|evidence)\.js$/.test(req.url)){res.setHeader('Content-Type','text/javascript');res.end(await readFile(join(compiled,req.url.slice(1))));return;}
  res.statusCode=404;res.end();
});
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const engine of ['chromium','webkit']){
    const profile=join(temporary,engine);
    context=await playwright[engine].launchPersistentContext(profile,{headless:true});
    let page=context.pages()[0];await page.goto(origin);
    const saved=await page.evaluate(async()=>{
      const {openOfflineQueue}=await import('/index.js');
      const actor=crypto.randomUUID(),tenant=crypto.randomUUID();
      const s={token:'independent-probe-token',tenantId:tenant,actorUserId:actor,generation:1};
      const q=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId:tenant,actorUserId:actor,getSession:()=>s});
      const event={kind:'shift_start',requestId:crypto.randomUUID(),employeeId:crypto.randomUUID(),projectId:crypto.randomUUID(),shiftId:crypto.randomUUID(),expectedVersion:0,occurredAt:'2027-01-15T09:00:00+03:00'};
      await q.enqueueEvent(event);
      const input={projectId:event.projectId,employeeId:event.employeeId,filename:'photo.png',contentType:'image/png',blob:new Blob([new Uint8Array([137,80,78,71])],{type:'image/png'}),dependencyRequestId:event.requestId,target:{kind:'execution_event',actorUserId:actor,requestId:event.requestId}};
      const pending=q.enqueueEvidence(input);
      input.contentType='text/plain'; // Caller retains and edits its own object after the async call starts.
      const row=await pending;
      const second={...event,requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()};
      const photo={...input,contentType:'image/png',employeeId:second.employeeId,dependencyRequestId:second.requestId,target:{kind:'execution_event',actorUserId:actor,requestId:second.requestId}};
      const options={evidence:[photo]},authoring=q.enqueueEvent(second,options);
      second.occurredAt='2027-01-15T10:00:00+03:00';options.evidence.length=0;
      await authoring;
      const authored=await q.get(second.requestId),photos=(await q.list()).filter(r=>r.stage!=='event'&&r.dependencyRequestId===second.requestId);
      const third={...event,requestId:crypto.randomUUID(),employeeId:crypto.randomUUID()};
      const thirdPhoto={...photo,employeeId:third.employeeId,dependencyRequestId:third.requestId,target:{kind:'execution_event',actorUserId:actor,requestId:third.requestId}};
      const targetAuthoring=q.enqueueEvent(third,{evidence:[thirdPhoto]});thirdPhoto.target.actorUserId=crypto.randomUUID();
      const changedTarget=await targetAuthoring.then(()=>({resolved:true}),error=>({resolved:false,error:error.code}));
      q.close();
      return {id:row.id,actor,tenant,declared:row.reserve.contentType,actual:row.blob.type,arrayMutation:{resolved:true,evidenceCount:photos.length,eventOccurredAt:authored.event.occurredAt},changedTarget};
    });
    await context.close();context=null;
    context=await playwright[engine].launchPersistentContext(profile,{headless:true});
    page=context.pages()[0];await page.goto(origin);
    const reopened=await page.evaluate(async saved=>{
      const {openOfflineQueue}=await import('/index.js');
      const s={token:'independent-probe-token',tenantId:saved.tenant,actorUserId:saved.actor,generation:2};
      const q=await openOfflineQueue({audience:`${location.origin}/api/v1`,tenantId:saved.tenant,actorUserId:saved.actor,getSession:()=>s});
      const row=await q.get(saved.id),bytes=[...new Uint8Array(await row.blob.arrayBuffer())];q.close();
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('helios-managed-offline');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      const stored=await new Promise((resolve,reject)=>{const tx=db.transaction('evidence'),r=tx.objectStore('evidence').getAll();tx.oncomplete=()=>resolve(r.result.find(x=>x.id===saved.id));tx.onabort=()=>reject(tx.error);});db.close();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stored.canonical)))].map(x=>x.toString(16).padStart(2,'0')).join('');
      return {state:row.state,stage:row.stage,declared:row.reserve.contentType,actual:row.blob.type,bytes,canonicalContainsInvalidMime:stored.canonical.includes('text/plain'),commandHashMatchesCanonical:hash===stored.commandHash};
    },saved);
    console.log(JSON.stringify({engine,publicSaveResolved:true,reopened,arrayMutation:saved.arrayMutation,changedTarget:saved.changedTarget}));
    try{assert.equal(reopened.declared,reopened.actual,'public save must retain a validated matching MIME declaration');}
    catch(error){failed++;console.error(`${engine}: ${error.message}`);}
    await context.close();context=null;
  }
}finally{
  await context?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});
}
process.exitCode=failed?1:0;
