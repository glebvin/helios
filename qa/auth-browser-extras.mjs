import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.HELIOS_QA_URL??'http://127.0.0.1:5194',out=process.env.HELIOS_QA_OUTPUT??'.data/auth-qa';await mkdir(out,{recursive:true});
const accounts=process.env.HELIOS_QA_CREDENTIALS?JSON.parse(await readFile(process.env.HELIOS_QA_CREDENTIALS,'utf8')):null;
if(!accounts&&!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw new Error('Private test credentials required for remote QA');
const director=accounts?.find(x=>x.email==='director@pilot.helios')??{email:'director@pilot.helios',password:'pilot-director'};
const results=[];
for(const [name,engine]of Object.entries({chromium,webkit})){
 const browser=await engine.launch();const contexts=[];
 try{
  const damaged=await browser.newContext();contexts.push(damaged);await damaged.addInitScript(()=>localStorage.setItem('helios.session','{broken-json'));const a=await damaged.newPage();const errors=[];a.on('pageerror',e=>errors.push(e.message));await a.goto(base);await a.getByRole('heading',{name:'Кто входит'}).waitFor();assert.deepEqual(errors,[]);results.push({engine:name,check:'damaged stored session returns to login',status:'passed'});
  const stale=await browser.newContext();contexts.push(stale);await stale.addInitScript(()=>{if(!sessionStorage.getItem('qa-initialized')){sessionStorage.setItem('qa-initialized','true');localStorage.setItem('helios.session',JSON.stringify({token:'0'.repeat(64),tenantId:'11111111-1111-4111-8111-111111111111',userId:'11111111-1111-4111-8111-111111111121',role:'director',name:'Expired QA',email:'expired@helios.test'}));}});
  const s=await stale.newPage();await s.goto(base+'/join/AAAAAAAAAAAA');await s.getByRole('heading',{name:'Вы уже вошли'}).waitFor();await s.getByRole('button',{name:'Выйти из аккаунта'}).click();await s.getByRole('alert').filter({hasText:'Приглашение не найдено'}).waitFor();assert.equal(await s.evaluate(()=>localStorage.getItem('helios.session')),null);results.push({engine:name,check:'expired session can exit from invitation page',status:'passed'});
  if(name==='chromium'){
   const c=await browser.newContext({permissions:['clipboard-read','clipboard-write']});contexts.push(c);const p=await c.newPage();await p.goto(base);await p.getByLabel('Почта',{exact:true}).fill(director.email);await p.getByLabel('Пароль',{exact:true}).fill(director.password);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.getByRole('button',{name:'Люди',exact:true}).click();const list=p.getByRole('region',{name:'Приглашения'});await list.locator('input').first().waitFor();const value=await list.locator('input').first().inputValue();await list.getByRole('button',{name:'Копировать',exact:true}).first().click();await list.getByRole('status').filter({hasText:'Ссылка скопирована'}).waitFor();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),value);results.push({engine:name,check:'copy writes exact invitation URL to clipboard',status:'passed'});
  }
 }finally{for(const c of contexts)await c.close();await browser.close();}
}
await writeFile(out+'/browser-extra-results.json',JSON.stringify(results,null,2)+'\n');console.log(`${results.length} additional browser checks passed`);
