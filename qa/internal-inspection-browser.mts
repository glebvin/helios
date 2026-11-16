import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import {internalInspectionFixture} from '../apps/api/test/internal-inspection-fixture.js';
import {assertVolumeReviewDatabase} from '../apps/api/test/volume-review-fixture.js';
const stage=process.argv[2]??'after';assert.ok(['before','after'].includes(stage));assert.equal(process.env.HELIOS_VOLUME_QA_DB_PORT,'54647');
const out=fileURLToPath(new URL('../.data/internal-browser/',import.meta.url));await mkdir(out,{recursive:true});
const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});await assertVolumeReviewDatabase(admin);
let f:any;
if(stage==='before'){const fixture=await internalInspectionFixture(admin,'http://127.0.0.1:4447');await fixture.configure();f={tenant:fixture.tenant,project:fixture.project,day:fixture.day,actors:fixture.actors,password:fixture.password,parts:fixture.parts};await writeFile(out+'fixture.json',JSON.stringify(f));}
else f=JSON.parse(await readFile(out+'fixture.json','utf8'));
const browser=await chromium.launch({headless:true});let page:any;const errors:string[]=[];
try{
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',(e:any)=>errors.push(e.message));await login('master');await open(0);
 if(stage==='before'){
  await page.screenshot({path:out+'before-master.png',fullPage:true});await login('pto');await open(0);await page.screenshot({path:out+'before-pto.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'before-mobile.png',fullPage:true});console.log('internal inspection baseline captured');
 }else{
  await page.getByRole('region',{name:'Наш ПТО',exact:true}).waitFor();await page.screenshot({path:out+'after-master.png',fullPage:true});
  const commands:any[]=[];let done:any;const committed=new Promise(r=>done=r);const endpoint=`/accepted-parts/${f.parts[0].partId}/internal-inspection`;
  await page.route('**'+endpoint,async(route:any)=>{if(route.request().method()!=='POST')return route.continue();commands.push(route.request().postDataJSON());const response=await route.fetch();assert.equal(response.status(),201);await route.abort();done();});
  await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).click();await committed;await page.getByRole('button',{name:'Повторить приёмку',exact:true}).waitFor();await page.unrouteAll({behavior:'wait'});await page.reload();await quality();await open(0);
  page.on('request',(r:any)=>{if(r.url().endsWith(endpoint)&&r.method()==='POST')commands.push(r.postDataJSON());});await page.getByRole('button',{name:'Повторить приёмку',exact:true}).click();await page.getByText('Приёмка подтверждена сервером.',{exact:true}).waitFor();assert.deepEqual(commands[1],commands[0]);
  await login('pto');await open(0);await page.getByText('Ждёт ответственного РП',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Принять часть',exact:true}).count(),0);
  await login('director');await open(0);await page.getByRole('button',{name:'Подтвердить ответственность',exact:true}).click();await page.getByText('Ждёт решения ПТО',{exact:true}).waitFor();
  await login('pto2');await open(0);await page.getByText('Ждёт решения ПТО',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Принять часть',exact:true}).count(),0);
  const forbidden=await page.evaluate(async({project,part}:any)=>{const s=JSON.parse(localStorage.getItem('helios.session')!);return (await fetch(`/api/v1/projects/${project}/accepted-parts/${part}/internal-inspection`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${s.token}`,'x-tenant-id':s.tenantId},body:JSON.stringify({requestId:crypto.randomUUID(),expectedVersion:2,action:'approve'})})).status;},{project:f.project,part:f.parts[0].partId});assert.equal(forbidden,403);
  await login('pto');await open(0);await page.getByRole('button',{name:'Принять часть',exact:true}).click();await page.getByText('Принято нашим ПТО',{exact:true}).waitFor();await page.reload();await quality();await open(0);await page.getByText('Принято нашим ПТО',{exact:true}).waitFor();await page.getByText('История приёмки · 3',{exact:true}).click();await page.screenshot({path:out+'after-pto.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'after-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  // A second full flow exercises the mandatory reason and terminal return.
  await login('master');await open(1);await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).click();await page.getByText('Ждёт ответственного РП',{exact:true}).waitFor();await login('director');await open(1);await page.getByRole('button',{name:'Подтвердить ответственность',exact:true}).click();await page.getByText('Ждёт решения ПТО',{exact:true}).waitFor();await login('pto');await open(1);await page.getByRole('button',{name:'Вернуть с замечанием',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Подтвердить возврат',exact:true}).isDisabled());await page.getByLabel('Причина возврата',{exact:true}).fill('Устранить дефект примыкания');await page.getByRole('button',{name:'Подтвердить возврат',exact:true}).click();await page.getByText('Возвращено ПТО',{exact:true}).waitFor();await page.getByText('История приёмки · 3',{exact:true}).click();await page.getByText('Устранить дефект примыкания',{exact:true}).waitFor();
  const counts=(await admin.query('SELECT count(*)::int n FROM internal_inspection_events WHERE tenant_id=$1 AND accepted_part_id=$2',[f.tenant,f.parts[0].partId])).rows[0];assert.equal(counts.n,3);
  assert.deepEqual(errors,[]);await writeFile(out+'result.json',JSON.stringify({ok:true,lost201ReloadExactRetry:true,pinnedPto403:true,fullMasterRpPtoFlow:true,returnWithReason:true,mobile390:true,physicalPhone:false,source:'18.000',accepted:'17.000',events:3},null,2));console.log('internal inspection browser passed');
 }
}catch(error){if(page){await page.screenshot({path:out+'failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'failure.txt',await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await browser.close();await admin.end();}
async function login(key:string){await page.goto('http://127.0.0.1:5317');await page.evaluate(()=>localStorage.removeItem('helios.session'));await page.reload();await page.getByLabel('Логин',{exact:true}).fill(f.actors[key].email);await page.getByLabel('Пароль',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('helios.session')??'null')?.token));await quality();}
async function quality(){await page.getByLabel('Объект',{exact:true}).selectOption(f.project);await page.getByRole('button',{name:'Приёмка',exact:true}).click();await page.getByRole('button',{name:'Самоконтроль мастера',exact:true}).click();await page.getByRole('heading',{name:'Самоконтроль мастера',exact:true}).waitFor();}
async function open(n:number){await page.getByRole('button',{name:`Открыть предъявление Кладка ${n+1}`,exact:true}).filter({visible:true}).click();await page.getByRole('dialog').getByText('1 м² требует доработки',{exact:true}).waitFor();await page.waitForTimeout(250);}
