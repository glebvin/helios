import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import {assertVolumeReviewDatabase} from '../apps/api/test/volume-review-fixture.js';
import {internalInspectionFixture} from '../apps/api/test/internal-inspection-fixture.js';
const stage=process.argv[2]??'after';assert.ok(['before','after'].includes(stage));
const out=fileURLToPath(new URL('../.data/correction-browser/',import.meta.url));await mkdir(out,{recursive:true});
const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});await assertVolumeReviewDatabase(admin);
let f:any;
if(stage==='before'){
 const fixture=await internalInspectionFixture(admin,'http://127.0.0.1:4491');await fixture.configure();
 for(const[action,version]of [['submit',0],['responsible',1],['approve',2]]as const)assert.equal((await fixture.action(0,action,version)).status,201);
 f={tenant:fixture.tenant,project:fixture.project,day:fixture.day,actors:fixture.actors,password:fixture.password,tokens:fixture.tokens,parts:fixture.parts,template:fixture.template};
 await writeFile(out+'fixture-private.json',JSON.stringify(f),{mode:0o600});
}else f=JSON.parse(await readFile(out+'fixture-private.json','utf8'));
const root=`/projects/${f.project}/volume-reviews/${f.parts[0].reportId}`;
async function call(path:string,body?:unknown,role='master'){
 const r=await fetch('http://127.0.0.1:4491/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${f.tokens[role]}`,'x-tenant-id':f.tenant,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(r.status,body===undefined?200:201,await r.clone().text());return r.json();
}
const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1280,height:900}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
async function quality(){await page.getByLabel('Объект',{exact:true}).selectOption(f.project);await page.getByRole('button',{name:'Приёмка',exact:true}).click();await page.getByRole('button',{name:'Самоконтроль мастера',exact:true}).click();await page.getByLabel('День предъявления',{exact:true}).fill(f.day);await page.getByRole('button',{name:'Открыть предъявление Кладка 1',exact:true}).filter({visible:true}).click();await page.getByRole('heading',{name:'Самоконтроль объёма',exact:true}).waitFor();}
async function login(role:string){await page.goto(`http://127.0.0.1:${process.env.HELIOS_CORRECTION_WEB_PORT??'5361'}`);await page.evaluate(()=>localStorage.removeItem('helios.session'));await page.reload();await page.getByLabel('Логин',{exact:true}).fill(f.actors[role].email);await page.getByLabel('Пароль',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await quality();}
try{
 await login('master');
 if(stage==='after'){
  await call(`/projects/${f.project}/tasks/${f.parts[0].taskId}/checklist-runs`,{requestId:crypto.randomUUID(),expectedVersion:(await call(root)).checklist.version,templateId:f.template,edition:1,answers:[{itemId:'ready',value:'yes'}]});
  await page.getByRole('button',{name:'Обновить корректировки',exact:true}).click();await page.getByRole('button',{name:'Корректировать количество',exact:true}).click();
  await page.getByLabel('Новое количество',{exact:true}).fill('16');await page.getByLabel('Основание корректировки',{exact:true}).fill('Повторный обмер: принято 16 м²');
  let resolve!:()=>void;const committed=new Promise<void>(r=>resolve=r),commands:any[]=[];
  await page.route('**/volume-reviews/*/corrections',async route=>{if(route.request().method()!=='POST')return route.continue();commands.push(route.request().postDataJSON());const response=await route.fetch();assert.equal(response.status(),201);await route.abort();resolve();});
  await page.getByRole('button',{name:'Подтвердить корректировку',exact:true}).click();await committed;await page.getByRole('button',{name:'Повторить корректировку',exact:true}).waitFor();await page.unrouteAll({behavior:'wait'});
  await page.reload();await quality();page.on('request',r=>{if(r.url().endsWith(root+'/corrections')&&r.method()==='POST')commands.push(r.postDataJSON());});
  await page.getByRole('button',{name:'Повторить корректировку',exact:true}).click();await page.getByText('Корректировка подтверждена сервером.',{exact:true}).waitFor();assert.deepEqual(commands[1],commands[0]);
  await page.getByText('Принято всего: 16 м2. Осталось: 2 м2.',{exact:true}).waitFor();
  const card=await call(root);assert.equal(card.review.acceptedQuantity,'17.000');assert.equal(card.totalAcceptedQuantity,'16.000');assert.equal(card.currentParts.length,1);
  const part=card.currentParts[0].id,pto=`/projects/${f.project}/accepted-parts/${part}/internal-inspection`;
  await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).click();await page.getByText('Ждёт ответственного РП',{exact:true}).waitFor();
  await login('director');assert.equal(await page.getByRole('button',{name:'Корректировать количество',exact:true}).count(),0);await page.getByRole('button',{name:'Подтвердить ответственность',exact:true}).click();await page.getByText('Ждёт решения ПТО',{exact:true}).waitFor();
  await login('pto');await page.getByRole('button',{name:'Принять часть',exact:true}).click();await page.getByText('Приёмка подтверждена сервером.',{exact:true}).waitFor();assert.equal((await call(pto,undefined,'pto')).state,'accepted');
  await page.reload();await quality();await page.getByText('История корректировок · 1',{exact:true}).click();await page.getByText('Повторный обмер: принято 16 м²',{exact:true}).waitFor();
  await page.getByText('Прежние части',{exact:true}).click();await page.getByText('Количество заменено корректировкой. Прежняя приёмка сохранена в истории.',{exact:true}).waitFor();
 }
 await page.waitForTimeout(150);await page.screenshot({path:out+stage+'-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);await page.screenshot({path:out+stage+'-mobile.png',fullPage:true});await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
 if(stage==='after')await writeFile(out+'result.json',JSON.stringify({ok:true,original17:true,current16:true,remainder2:true,freshPto:true,history:true,lost201ReloadExactRetry:true,otherRoleCannotCorrect:true,mobile390:true,physicalPhone:false,errors},null,2));
 console.log('Correction browser '+stage+' passed');
}catch(error){await page.screenshot({path:out+'failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'failure.txt',await page.locator('body').innerText().catch(()=>''));throw error;}finally{await browser.close();await admin.end();}
