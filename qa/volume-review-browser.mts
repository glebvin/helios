import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import {assertVolumeReviewDatabase,volumeReviewFixture} from '../apps/api/test/volume-review-fixture.js';
const stage=process.argv[2]??'after';assert.ok(['before','after'].includes(stage));
const out=fileURLToPath(new URL('../.data/volume-browser/',import.meta.url));await mkdir(out,{recursive:true});
const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});await assertVolumeReviewDatabase(admin);
let f:any;
if(stage==='before'){const fixture=await volumeReviewFixture(admin,'http://127.0.0.1:4443');const report=await fixture.report('18');f={tenant:fixture.tenant,project:fixture.project,day:fixture.day,actors:fixture.actors,password:fixture.password,...report};await writeFile(out+'fixture.json',JSON.stringify(f));}
else {
 f=JSON.parse(await readFile(out+'fixture.json','utf8'));
 if((await admin.query('SELECT 1 FROM master_volume_reviews WHERE tenant_id=$1 AND report_id=$2',[f.tenant,f.reportId])).rowCount){
  const fresh=await volumeReviewFixture(admin,'http://127.0.0.1:4443');const report=await fresh.report('18');f={tenant:fresh.tenant,project:fresh.project,day:fresh.day,actors:fresh.actors,password:fresh.password,...report};await writeFile(out+'fixture.json',JSON.stringify(f));
 }
}
const browser=await chromium.launch({headless:true});let page:any;const errors:string[]=[];
try{
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',(e:any)=>errors.push(e.message));await login(page,'master');
 if(stage==='before'){await page.screenshot({path:out+'before-master.png',fullPage:true});await login(page,'pto');await page.screenshot({path:out+'before-pto.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'before-mobile.png',fullPage:true});console.log('volume review baseline captured');}
 else {
  const commands:any[]=[];let resolveCommitted:any;const committed=new Promise(r=>resolveCommitted=r);
  await page.route('**/volume-reviews/'+f.reportId,async(route:any)=>{if(route.request().method()!=='POST')return route.continue();commands.push(route.request().postDataJSON());const r=await route.fetch();assert.equal(r.status(),201);await route.abort();resolveCommitted();});
  await page.getByRole('button',{name:'Открыть предъявление Кладка 1',exact:true}).click();const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Принято мастером',{exact:true}).fill('17');await dialog.getByLabel('Причина разницы',{exact:true}).fill('1 м² нужно доработать');
  await dialog.getByRole('button',{name:'Подтвердить объём',exact:true}).click();await committed;await dialog.getByRole('button',{name:'Повторить решение',exact:true}).waitFor();
  await page.unrouteAll({behavior:'wait'});await page.reload();await quality(page);await page.getByRole('button',{name:'Открыть предъявление Кладка 1',exact:true}).click();
  page.on('request',(r:any)=>{if(r.url().endsWith('/volume-reviews/'+f.reportId)&&r.method()==='POST')commands.push(r.postDataJSON());});
  await page.getByRole('button',{name:'Повторить решение',exact:true}).click();await page.getByText('Решение мастера подтверждено сервером.',{exact:true}).waitFor();assert.deepEqual(commands[1],commands[0]);
  const row=(await admin.query('SELECT accepted_quantity::text accepted,difference_quantity::text difference FROM master_volume_reviews WHERE tenant_id=$1 AND report_id=$2',[f.tenant,f.reportId])).rows;assert.equal(row.length,1);assert.equal(row[0].accepted,'17.000');assert.equal(row[0].difference,'1.000');
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.screenshot({path:out+'after-master.png',fullPage:true});
  await login(page,'pto');await page.getByRole('button',{name:'Открыть предъявление Кладка 1',exact:true}).click();await page.getByText('1 м² нужно доработать',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Подтвердить объём',exact:true}).count(),0);
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await page.getByLabel('День предъявления',{exact:true}).fill('2020-01-01');await page.getByText('За этот день предъявлений нет',{exact:true}).waitFor();await page.getByLabel('День предъявления',{exact:true}).fill(f.day);await page.getByRole('button',{name:'Открыть предъявление Кладка 1',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Открыть предъявление Кладка 1',exact:true}).waitFor();await page.screenshot({path:out+'after-mobile.png',fullPage:true});assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
  await writeFile(out+'result.json',JSON.stringify({ok:true,lost201ReloadExactRetry:true,oneDecision:true,accepted:'17.000',difference:'1.000',ptoReadOnly:true,daySwitch:true,mobile390:true},null,2));console.log('volume review browser passed');
 }
}catch(error){if(page){await page.screenshot({path:out+'failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'failure.txt',await page.locator('body').innerText().catch(()=>''));}throw error;}
finally{await browser.close();await admin.end();}
async function login(p:any,key:string){await p.goto('http://127.0.0.1:5313');await p.evaluate(()=>localStorage.removeItem('helios.session'));await p.reload();await p.getByLabel('Логин',{exact:true}).fill(f.actors[key].email);await p.getByLabel('Пароль',{exact:true}).fill(f.password);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('helios.session')??'null')?.token));await quality(p);}
async function quality(p:any){await p.getByLabel('Объект',{exact:true}).selectOption(f.project);await p.getByRole('button',{name:'Приёмка',exact:true}).click();await p.getByRole('heading',{name:'Приёмка',exact:true}).waitFor();if(stage==='after')await p.getByRole('button',{name:'Самоконтроль мастера',exact:true}).click();await p.waitForTimeout(500);}
