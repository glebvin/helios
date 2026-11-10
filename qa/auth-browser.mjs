// Run against the built frontend. Remote runs require an explicit private credentials file.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.HELIOS_QA_URL??'http://127.0.0.1:5194';
const remote=!['127.0.0.1','localhost'].includes(new URL(base).hostname);
if(remote&&!process.env.HELIOS_QA_CREDENTIALS)throw new Error('Remote QA requires HELIOS_QA_CREDENTIALS');
const credentials=process.env.HELIOS_QA_CREDENTIALS?JSON.parse(await readFile(process.env.HELIOS_QA_CREDENTIALS,'utf8')):null;
const accounts=credentials?.users??credentials?.accounts??credentials;
const director=accounts?(Array.isArray(accounts)?accounts.find(x=>x.role==='director'||x.email==='director@pilot.helios'):accounts.director):{email:'director@pilot.helios',password:'pilot-director'};
assert.ok(director?.email&&director?.password,'director credential required');
const out=process.env.HELIOS_QA_OUTPUT??'.data/auth-qa';await mkdir(out,{recursive:true});
const results=[];const engines=process.env.HELIOS_QA_ENGINE?[process.env.HELIOS_QA_ENGINE]:['chromium','webkit'];
for(const engine of engines){
 const browser=await ({chromium,webkit}[engine]).launch({headless:true});
 const contexts=[];const errors=[];
 async function context(options={}){const c=await browser.newContext(options);contexts.push(c);c.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().startsWith(base+'/api/')&&r.status()>=500)errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);});});return c;}
 const check=(name)=>{results.push({engine,name,status:'passed'});console.log(`PASS ${engine}: ${name}`);};
 async function login(p,email,password){await p.goto(base);await p.getByLabel('Почта',{exact:true}).fill(email);await p.getByLabel('Пароль',{exact:true}).fill(password);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForFunction(()=>!!JSON.parse(localStorage.getItem('helios.session')??'null')?.token);await p.waitForLoadState('networkidle');}
 async function invitation(p,role){if(role==='master')await p.getByRole('tab',{name:'Прорабы',exact:true}).click();else await p.getByRole('tab',{name:'Работники',exact:true}).click();await p.getByRole('button',{name:role==='master'?'Пригласить прораба':'Пригласить работника',exact:true}).click();await p.getByRole('button',{name:'Создать ссылку',exact:true}).click();const input=p.getByLabel('Ссылка приглашения');await input.waitFor();return input.inputValue();}
 async function register(p,url,name,email,password){await p.goto(url);await p.getByLabel('Имя и фамилия').fill(name);await p.getByLabel('Электронная почта').fill(email);await p.getByLabel('Пароль',{exact:true}).fill(password);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForFunction(()=>!!JSON.parse(localStorage.getItem('helios.session')??'null')?.token);await p.waitForLoadState('networkidle');}
 try{
  const dc=await context({viewport:{width:1440,height:1000}}),d=await dc.newPage();
  await d.goto(base);await d.getByLabel('Почта',{exact:true}).fill(director.email);await d.getByLabel('Пароль',{exact:true}).fill('definitely-wrong-password');await d.getByRole('button',{name:'Войти',exact:true}).click();await d.getByRole('alert').filter({hasText:'Неверная почта или пароль'}).waitFor();check('incorrect login rejected with human-readable message');
  await login(d,director.email,director.password);await d.getByRole('button',{name:'Люди',exact:true}).click();
  const old=await invitation(d,'worker');check('director issues worker invitation through UI');
  await d.getByRole('button',{name:'Обновить код',exact:true}).last().click();await d.waitForFunction(old=>document.querySelector('[role="dialog"] input')?.value!==old,old);const workerLink=await d.getByLabel('Ссылка приглашения').inputValue();assert.notEqual(workerLink,old);
  const invalid=await fetch(old.replace('/join/','/api/v1/join/'));assert.equal(invalid.status,410);check('refresh invalidates old invitation');
  await d.getByRole('button',{name:'Копировать',exact:true}).last().click();
  await d.getByRole('button',{name:'Закрыть',exact:true}).click();await d.reload();await d.getByRole('button',{name:'Люди',exact:true}).click();await d.locator('input').filter({visible:true}).first().waitFor();await d.waitForFunction(link=>[...document.querySelectorAll('input')].some(x=>x.value===link),workerLink);check('invitation survives reload from server');
  const wc=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),w=await wc.newPage();
  await w.goto(workerLink);await w.getByLabel('Имя и фамилия').waitFor();await w.screenshot({path:`${out}/${engine}-join-mobile.png`,fullPage:true});
  const name=`Я QA ${engine} работник ${Date.now()}`,email=`qa-${randomUUID()}@helios.test`,password=`QA-${randomUUID()}`;
  await w.getByLabel('Имя и фамилия').fill(name);await w.getByLabel('Электронная почта').fill(director.email);await w.getByLabel('Пароль',{exact:true}).fill(password);await w.getByRole('button',{name:'Войти',exact:true}).click();await w.getByRole('alert').filter({hasText:'Эта почта уже зарегистрирована'}).waitFor();check('duplicate email keeps form and invitation reusable');
  await register(w,workerLink,name,email,password);await w.getByRole('heading',{name:'Моя смена',exact:true}).waitFor();assert.equal(await w.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')).role),'worker');assert.equal(await w.getByRole('button',{name:'Пригласить прораба',exact:true}).count(),0);check('mobile worker registration and automatic role routing');
  assert.ok(await w.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'mobile horizontal overflow');await w.screenshot({path:`${out}/${engine}-worker-mobile.png`,fullPage:true});
  await w.reload();await w.getByRole('heading',{name:'Моя смена',exact:true}).waitFor();check('registered session survives reload');
  await w.getByRole('button',{name:'Профиль',exact:true}).click();await w.getByRole('button',{name:'Выйти',exact:true}).click();await w.getByRole('heading',{name:'Кто входит',exact:true}).waitFor();await login(w,email,password);await w.getByRole('heading',{name:'Моя смена',exact:true}).waitFor();check('logout and later login with new credentials');
  await d.reload();await d.getByRole('button',{name:'Люди',exact:true}).click();await d.getByText(name,{exact:true}).waitFor();assert.equal(await d.locator('table.sheet tbody tr').filter({hasText:name}).count(),1);check('registered employee appears exactly once in director list');
  const uc=await context(),u=await uc.newPage();await u.goto(workerLink);await u.getByRole('alert').filter({hasText:'Эта ссылка уже использована'}).waitFor();assert.equal(await u.getByLabel('Имя и фамилия').count(),0);check('used invitation cannot register a second account');
  await w.goto(workerLink);await w.getByRole('heading',{name:'Вы уже вошли'}).waitFor();check('opening invite never silently replaces an active account');
  const masterLink=await invitation(d,'master');await d.getByRole('button',{name:'Закрыть',exact:true}).click();const mc=await context({viewport:{width:1365,height:900}}),m=await mc.newPage();const mn=`Я QA ${engine} прораб ${Date.now()}`;
  await register(m,masterLink,mn,`qa-${randomUUID()}@helios.test`,`QA-${randomUUID()}`);assert.equal(await m.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')).role),'master');await m.getByRole('button',{name:'Работники',exact:true}).click();await m.getByRole('button',{name:'Пригласить работника',exact:true}).waitFor();assert.equal(await m.getByRole('button',{name:'Пригласить прораба',exact:true}).count(),0);check('master registration and worker-only invitation UI');
  await m.getByRole('button',{name:'Пригласить работника',exact:true}).click();await m.getByRole('button',{name:'Создать ссылку',exact:true}).click();await m.getByLabel('Ссылка приглашения').waitFor();check('new master can issue real worker invitation');await m.getByRole('button',{name:'Закрыть',exact:true}).click();await m.screenshot({path:`${out}/${engine}-master.png`,fullPage:true});
  await d.reload();await d.getByRole('button',{name:'Люди',exact:true}).click();await d.getByRole('tab',{name:'Прорабы',exact:true}).click();await d.getByText(mn+' · Доступ открыт',{exact:true}).waitFor();check('new master appears in director foremen roster');
  await u.goto(base+'/join/AAAAAAAAAAAA');await u.getByRole('alert').filter({hasText:'Приглашение не найдено'}).waitFor();check('unknown invitation displays helpful error');
  assert.deepEqual(errors,[]);check('no browser exceptions or HTTP 5xx');
 }catch(e){results.push({engine,status:'failed',message:e.message});for(const [n,c] of contexts.entries())for(const [j,p]of c.pages().entries())await p.screenshot({path:`${out}/${engine}-failure-${n}-${j}.png`,fullPage:true}).catch(()=>{});throw e;}
 finally{await Promise.all(contexts.map(c=>c.close()));await browser.close();await writeFile(`${out}/browser-results.json`,JSON.stringify(results,null,2)+'\n');}
}
console.log(`${results.length} browser checks passed`);
