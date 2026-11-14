// Disposable local fixture only: CI never connects to the published staging site.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {mkdir,open,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {DEMO_USERS,PROJECT_A,ORG_A} from '../packages/domain/src/ids.ts';
import {routeConfigUiSmoke} from './route-config-ci.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const root=resolve(import.meta.dirname,'..');
const base='http://127.0.0.1:5207',api='http://127.0.0.1:4327';
assert.equal(process.env.HELIOS_CI_FIXTURE,'disposable','Explicit disposable fixture required');
assert.equal(process.env.DATABASE_URL,'postgres://helios_app:helios_app@127.0.0.1:54339/helios');
const out=resolve(root,'.data/ci-browser');await mkdir(out,{recursive:true});
const processes=[],logs=[],contexts=[],results=[],errors=[];let browser;
async function launch(name,args,cwd){
 const log=await open(resolve(out,name+'.log'),'w');logs.push(log);
 const child=spawn(process.execPath,args,{cwd,env:{...process.env,API_PORT:'4327',HELIOS_API_ORIGIN:api,HELIOS_WEB_PORT:'5207',HELIOS_EVIDENCE_ROOT:resolve(out,'evidence')},stdio:['ignore',log.fd,log.fd]});
 processes.push(child);return child;
}
async function ready(url,child){
 for(let attempt=0;attempt<120;attempt++){
  if(child.exitCode!==null)throw new Error(`Service exited with ${child.exitCode}; see CI artifact`);
  try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
  await delay(250);
 }
 throw new Error('Service startup timed out: '+url);
}
const check=name=>{results.push({name,status:'passed'});console.log('PASS',name);};
async function login(role){
 const account=DEMO_USERS.find(u=>u.role===role&&u.email!=='other@foreign.helios');assert.ok(account);
 const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.login'));
 await page.waitForFunction(()=>!document.body.innerText.includes('Читаем вход, объект и день'));
 return page;
}
async function headers(page){return page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('helios.session'));return {authorization:`Bearer ${s.token}`,'x-tenant-id':s.tenantId};});}
async function people(page){
 await page.locator('.nav-item').filter({hasText:/^(Люди|Работники)$/}).click();
 await page.getByRole('heading',{name:/^(Люди|Работники)$/}).waitFor();
}
try{
 const apiProcess=await launch('api',['--import',pathToFileURL(resolve(root,'apps/api/node_modules/tsx/dist/loader.mjs')).href,'src/main.ts'],resolve(root,'apps/api'));
 await ready(api+'/api/health',apiProcess);
 const webProcess=await launch('web',['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--strictPort','--configLoader','runner'],resolve(root,'apps/web'));
 await ready(base,webProcess);browser=await chromium.launch({headless:true});
 const director=await login('director');
 assert.equal(await director.getByLabel('Объект',{exact:true}).inputValue(),PROJECT_A);
 await people(director);await director.locator('.sheet tbody tr').first().waitFor();
 check('R01/R02: login, project and employee list from real API');
 const name=`00 CI ${randomUUID()}`;
 await director.getByRole('button',{name:'Добавить сотрудника',exact:true}).click();
 await director.getByRole('dialog').getByLabel('Имя',{exact:true}).fill(name);
 await director.getByRole('button',{name:'Создать',exact:true}).click();
 await director.getByText(`Сервер записал «${name}».`,{exact:true}).waitFor();
 const fresh=await login('director');await people(fresh);await fresh.getByText(name,{exact:true}).click();
 await fresh.getByRole('heading',{name,exact:true}).waitFor();
 const heldClock=[];
 const clockStarted=fresh.waitForRequest(request=>new URL(request.url()).pathname==='/api/v1/overview');
 await fresh.route('**/api/v1/overview*',route=>{heldClock.push(route);});
 await fresh.reload();await clockStarted;
 await fresh.locator('.nav-item').filter({hasText:/^(Люди|Работники)$/}).click();
 await delay(45); // Resolve scope while the old page is exiting.
 for(const route of heldClock)await route.continue();
 await fresh.unroute('**/api/v1/overview*');
 await fresh.getByRole('heading',{name:/^(Люди|Работники)$/}).waitFor();
 await fresh.getByText(name,{exact:true}).waitFor();
 check('navigation concurrent with initial scope refresh does not leave the old page');
 assert.ok(await fresh.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await fresh.screenshot({path:resolve(out,'employees-390.png'),fullPage:true});
 check('R03: UI write survives new login and reload; 390px viewport');
 for(const role of ['master','worker']){
  const restricted=await login(role);
  assert.equal(await restricted.getByRole('button',{name:'Добавить сотрудника',exact:true}).count(),0);
  const denied=await restricted.request.post(base+'/api/v1/employees',{headers:await headers(restricted),data:{requestId:randomUUID(),fullName:'Forbidden',organizationId:ORG_A}});
  assert.equal(denied.status(),403);check(`${role}: separate login and direct write denied by API`);
 }
 await fresh.route('**/api/v1/employees?*',r=>r.abort());await fresh.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await fresh.getByText('Список не прочитан',{exact:true}).waitFor();
 assert.equal(await fresh.getByText('Работников пока нет',{exact:true}).count(),0);
 await fresh.unroute('**/api/v1/employees?*');await fresh.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await fresh.getByText(name,{exact:true}).waitFor();check('network error is visible and recoverable, not an empty list');
 await fresh.route('**/api/v1/me',r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));
 await fresh.evaluate(()=>window.dispatchEvent(new Event('focus')));await fresh.getByRole('heading',{name:'Кто входит',exact:true}).waitFor();
 assert.equal(await fresh.evaluate(()=>localStorage.getItem('helios.session')),null);
 check('expired session returns to login and clears local session');assert.deepEqual(errors,[]);
 await routeConfigUiSmoke(browser,base,out,DEMO_USERS.find(u=>u.role==='director'&&u.email!=='other@foreign.helios'));
 check('route configuration: admin UI save/reload, lost acknowledgement stable requestId and390px');
}catch(error){
 for(const [index,context] of contexts.entries())for(const [tab,page] of context.pages().entries()){
  await page.screenshot({path:resolve(out,`failure-${index}-${tab}.png`),fullPage:true}).catch(()=>{});
  await writeFile(resolve(out,`failure-${index}-${tab}.log`),await page.locator('body').innerText().catch(()=>''));
 }
 throw error;
}finally{
 await writeFile(resolve(out,'results.json'),JSON.stringify({results,errors},null,2));
 for(const context of contexts)await context.close();await browser?.close();
 for(const child of processes.reverse()){
  if(child.exitCode!==null)continue;
  const exited=once(child,'exit');child.kill('SIGTERM');
  await Promise.race([exited,delay(3000)]);if(child.exitCode===null){child.kill('SIGKILL');await exited;}
 }
 for(const log of logs)await log.close();
}
