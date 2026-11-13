// Real application acceptance against an explicitly isolated synthetic QA contour.
// Needs the gated proxy described in docs/qa/offline-release-r23-r25.md.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,rm} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE);
const base=process.env.HELIOS_OFFLINE_PREVIEW??'http://127.0.0.1:5218';
assert.equal(new URL(base).hostname,'127.0.0.1');assert.equal(new URL(base).port,'5218');
const root=process.env.HELIOS_OFFLINE_FIXTURE??'.data/release-r23-r25/fixture',out=process.env.HELIOS_OFFLINE_RESULTS??'.data/release-r23-r25/browser';
const m=JSON.parse(await readFile(root+'/accounts.json')),s=JSON.parse(await readFile(root+'/scenario.json'));
const bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S8AAAAASUVORK5CYII=','base64');
await mkdir(out,{recursive:true});const results=[],errors=[];
const gate=mode=>fetch(base+'/__qa/'+mode);
for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]]) {
 const profile=await mkdtemp(join(tmpdir(),'helios-offline-ui-'));
 const options={headless:true,viewport:{width:390,height:844},...(engineName==='chromium'?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})};
 let context=await engine.launchPersistentContext(profile,options);let p=context.pages()[0]??await context.newPage();
 const ok=name=>{results.push(engineName+': '+name);console.log('PASS',engineName,name)};
 p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(engineName+': '+e.message));
 async function login(role,page=p){const a=m.accounts.find(x=>x.role===role);await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(a.email);await page.getByLabel('Пароль',{exact:true}).fill(a.password);await page.getByRole('button',{name:'Войти',exact:true}).click()}
 try {
  await gate('on');await login('worker');await p.getByRole('button',{name:'Добавить фото',exact:true}).waitFor();
  await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const cache=await p.evaluate(async()=>{const name=(await caches.keys()).find(k=>k.startsWith('helios-shell-'));return(await(await caches.open(name)).keys()).map(r=>new URL(r.url).pathname)});
  assert.ok(cache.some(x=>x.endsWith('.js'))&&cache.some(x=>x.endsWith('.css'))&&cache.some(x=>x.endsWith('.woff2')));ok('first visit caches complete shell, including JS, CSS and fonts');
  await p.getByRole('button',{name:'Добавить фото',exact:true}).click();await p.locator('input[type=file]').setInputFiles({name:'independent-'+engineName+'-'+Date.now()+'.png',mimeType:'image/png',buffer:bytes});
  const downloadName=await p.locator('input[type=file]').evaluate(input=>input.files[0].name);await p.getByRole('button',{name:'Отправить файл',exact:true}).click();await p.getByText('Сохранён '+downloadName+'.',{exact:true}).waitFor();
  const line=p.locator('p').filter({hasText:'Сохранён '+downloadName+'.'});const d=p.waitForEvent('download');await line.getByRole('button',{name:'Открыть',exact:true}).click();assert.equal(createHash('sha256').update(await readFile(await(await d).path())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));ok('photo attaches to server report from a new browser; download SHA matches');
  // Real IndexedDB quota rejection must keep the file unsaved and explain the failure.
  await p.evaluate(()=>{window.__qaAdd=IDBObjectStore.prototype.add;IDBObjectStore.prototype.add=function(...args){if(this.name==='evidence')throw new DOMException('full','QuotaExceededError');return window.__qaAdd.apply(this,args)}});
  await p.getByRole('button',{name:'Добавить фото',exact:true}).click();await p.locator('input[type=file]').setInputFiles({name:'quota.png',mimeType:'image/png',buffer:Buffer.concat([bytes,Buffer.from([1])])});await p.getByRole('button',{name:'Отправить файл',exact:true}).click();await p.getByRole('alert').filter({hasText:'Хранилище устройства отказало. Файл не сохранён.'}).waitFor();await p.getByRole('button',{name:'Отмена',exact:true}).click();await p.evaluate(()=>{IDBObjectStore.prototype.add=window.__qaAdd;delete window.__qaAdd});ok('real IndexedDB quota rejection explains failure without false saved status');
  await p.getByRole('button',{name:'Добавить фото',exact:true}).click();await p.locator('input[type=file]').setInputFiles({name:'same-bytes.png',mimeType:'image/png',buffer:bytes});await p.getByRole('button',{name:'Отправить файл',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await p.locator('p').filter({hasText:'Сохранён '+downloadName+'.'}).getByRole('button',{name:'Открыть',exact:true}).count(),1);ok('same bytes reuse acknowledged identity after local Blob cleanup');
  const queuedName='resume-'+engineName+'-'+Date.now()+'.png';const lostBefore=(await(await fetch(base+'/__qa/stats')).json()).filter(x=>x.tenantId===m.tenantId&&x.lost&&x.method==='PUT').length;await gate('drop-upload');
  await p.getByRole('button',{name:'Добавить фото',exact:true}).click();await p.locator('input[type=file]').setInputFiles({name:queuedName,mimeType:'image/png',buffer:Buffer.concat([bytes,Buffer.from([2])])});await p.getByRole('button',{name:'Отправить файл',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
  for(let i=0;i<150;i++){const log=await(await fetch(base+'/__qa/stats')).json();if(log.filter(x=>x.tenantId===m.tenantId&&x.lost&&x.method==='PUT').length>lostBefore)break;if(i===149)throw Error('No real proxy upload loss observed');await new Promise(r=>setTimeout(r,100))}
  assert.equal(await p.getByText('Сохранён '+queuedName+'.',{exact:true}).count(),0);
  await context.close();await gate("on");context=await engine.launchPersistentContext(profile,options);p=context.pages()[0]??await context.newPage();p.on('pageerror',e=>errors.push(engineName+': '+e.message));p.setDefaultTimeout(20000);await p.goto(base);await p.locator('p').filter({hasText:'Сохранён '+queuedName+'.'}).getByRole('button',{name:'Открыть',exact:true}).waitFor();
  const h=await p.evaluate(()=>{const a=JSON.parse(localStorage.getItem('helios.session'));return{authorization:'Bearer '+a.token,'x-tenant-id':a.tenantId}});const response=await p.request.get(base+`/api/v1/projects/${s.projectId}/evidence?employeeId=${s.employeeId}&limit=100`,{headers:h});assert.equal((await response.json()).items.filter(x=>x.filename===queuedName).length,1);ok('lost upload response survives page closure; automatic retry attaches exactly one file and refreshes UI');
  // A different tab must neither revoke this actor nor duplicate delivery.
  const other=await context.newPage();await other.goto(base);await other.getByRole('heading',{name:'Моя смена',exact:true}).waitFor();await p.reload();await p.getByRole('button',{name:'Добавить фото',exact:true}).waitFor();assert.equal(await other.getByLabel('Логин',{exact:true}).count(),0);ok('two tabs and reload keep the same actor signed in');await other.close();
  await gate('all-off');await p.reload();await p.getByRole('heading',{name:'Моя смена',exact:true}).waitFor();await p.getByText(/^Снимок от /).waitFor();assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:out+'/'+engineName+'-cold-390.png',fullPage:true});ok('complete origin outage reloads real app and dated actor snapshot at390px');
  await p.getByRole('button',{name:'Задание',exact:true}).click();assert.equal(await p.getByText(/^Снимок от /).count(),0);await p.getByRole('button',{name:'Профиль',exact:true}).click();await p.getByRole('button',{name:'Выйти',exact:true}).click();await p.getByLabel('Логин',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>!!localStorage.getItem('helios.session')),false);assert.equal(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('helios.shift-snapshot:'))),false);await p.reload();await p.getByLabel('Логин',{exact:true}).waitFor();ok('offline logout removes credentials and snapshot; reload cannot reopen private shift');
  await gate('on');await login('master');await p.getByLabel('Объект',{exact:true}).selectOption(m.projectId);await p.getByRole('heading',{name:'Сегодня',exact:true}).waitFor();assert.equal(await p.getByRole('heading',{name:'Моя смена',exact:true}).count(),0);ok('actual master cannot see previous worker snapshot');
 } catch(e){await writeFile(out+'/'+engineName+'-failure.txt',await p.locator('body').innerText().catch(()=>''));await p.screenshot({path:out+'/'+engineName+'-failure.png',fullPage:true}).catch(()=>{});throw e}
 finally{await gate('on');await context.close();await rm(profile,{recursive:true,force:true});await writeFile(out+'/results.json',JSON.stringify({results,errors},null,2))}
}
assert.deepEqual(errors,[]);
