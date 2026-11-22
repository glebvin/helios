import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import {internalInspectionFixture} from '../apps/api/test/internal-inspection-fixture.ts';
import {assertVolumeReviewDatabase} from '../apps/api/test/volume-review-fixture.ts';
assert.equal(process.env.HELIOS_VOLUME_QA_DB_PORT,'54653');
const api=process.env.HELIOS_PARTIAL_API??'http://127.0.0.1:4507';
const web=process.env.HELIOS_PARTIAL_WEB??'http://127.0.0.1:5373';
const out=fileURLToPath(new URL('../.data/partial-pto-browser/',import.meta.url));
await mkdir(out,{recursive:true});
const admin=new pg.Pool({connectionString:process.env.ADMIN_DATABASE_URL});
await assertVolumeReviewDatabase(admin);
const f=await internalInspectionFixture(admin,api);
await f.configure();
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors:string[]=[];
page.on('pageerror',(error:Error)=>errors.push(error.message));
try{
 await login('master');await open(0);
 await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).click();
 await page.getByText('Ждёт ответственного РП',{exact:true}).waitFor();
 await login('director');await open(0);
 await page.getByRole('button',{name:'Подтвердить ответственность',exact:true}).click();
 await page.getByText('Ждёт решения ПТО',{exact:true}).waitFor();
 await login('pto2');await open(0);
 assert.equal(await page.getByRole('button',{name:'Принять часть объёма',exact:true}).count(),0);
 await login('pto');await open(0);
 await page.getByRole('button',{name:'Принять часть объёма',exact:true}).click();
 assert.ok(await page.getByRole('button',{name:'Подтвердить частичную приёмку',exact:true}).isDisabled());
 await page.getByLabel('Принятый объём',{exact:true}).fill('16');
 await page.getByLabel('Причина возврата остатка',{exact:true}).fill('1 м² с дефектом');
 await admin.query("UPDATE responsibility_orders SET status='revoked',revocation_reason='QA' WHERE id=$1",[f.orderId]);
 await page.getByRole('button',{name:'Подтвердить частичную приёмку',exact:true}).click();
 await page.getByText('Приказ отозван. Принятие им не подтверждается.',{exact:true}).waitFor();
 assert.equal((await f.call(f.path(0),undefined,'pto')).body.state,'awaiting_pto');
 await admin.query("UPDATE responsibility_orders SET status='active',revocation_reason=NULL WHERE id=$1",[f.orderId]);
 const commands:unknown[]=[];
 let done:()=>void=()=>{};
 const committed=new Promise<void>(resolve=>{done=resolve;});
 const waiting:Array<()=>void>=[];
 let holdReads=true;
 const endpoint=`/accepted-parts/${f.parts[0].partId}/internal-inspection`;
 await page.route('**/*',async(route)=>{
  const url=route.request().url();
  if(route.request().method()==='POST'&&url.includes(endpoint)){
   commands.push(route.request().postDataJSON());
   const response=await route.fetch();
   assert.equal(response.status(),201);
   await route.abort();
   done();
   return;
  }
  if(holdReads&&route.request().method()==='GET'&&(url.includes('/volume-reviews/')||url.includes(endpoint))){
   await new Promise<void>(resolve=>waiting.push(resolve));
  }
  await route.continue();
 });
 await page.getByRole('button',{name:'Подтвердить частичную приёмку',exact:true}).click();
 await committed;
 await page.getByRole('button',{name:'Повторить приёмку',exact:true}).waitFor();
 holdReads=false;waiting.splice(0).forEach(release=>release());
 await page.unrouteAll({behavior:'wait'});
 await page.reload();await quality();await open(0);
 page.on('request',(request)=>{if(request.url().endsWith(endpoint)&&request.method()==='POST')commands.push(request.postDataJSON());});
 await page.getByText('Исходная часть после решения ПТО',{exact:true}).click();
 await page.getByRole('button',{name:'Повторить приёмку',exact:true}).click();
 await page.getByText('Приёмка подтверждена сервером.',{exact:true}).waitFor();
 await page.getByText('Часть разделена',{exact:true}).waitFor();
 await page.getByText('Принято 16 м2, возвращено 1 м2. Обе доли связаны с исходной частью.',{exact:true}).first().waitFor();
 assert.deepEqual(commands[1],commands[0]);
 await page.reload();await quality();await open(0);
 await page.getByText('Принято нашим ПТО',{exact:true}).waitFor();
 await page.getByText('Возвращено ПТО',{exact:true}).waitFor();
 await page.getByText('Пройдите новый самоконтроль задания после возврата и обновите приёмку.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Принять часть объёма',exact:true}).count(),0);
 await page.getByText('Исходная часть после решения ПТО',{exact:true}).click();
 await page.getByText('История приёмки · 3',{exact:true}).click();
 await page.getByRole('list').getByText('1 м² с дефектом',{exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
 await page.screenshot({path:out+'after-390.png',fullPage:true});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 await login('director');await open(0);
 await page.getByText('Возвращено ПТО',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Принять часть объёма',exact:true}).count(),0);
 const totals=(await admin.query(`SELECT coalesce(sum(quantity),0)::text AS total,count(*)::int AS parts FROM current_accepted_volume_parts WHERE report_id=$1`,[f.parts[0].reportId])).rows[0];
 assert.equal(totals.total,'17.000');assert.equal(totals.parts,2);
 assert.deepEqual(errors,[]);
 await writeFile(out+'result.json',JSON.stringify({ok:true,accepted:'16.000',returned:'1.000',currentTotal:'17.000',lost201ReloadExactRetry:true,otherPtoReadOnly:true,secondLoginRead:true,mobile390:true,physicalPhone:false},null,2));
 console.log('partial PTO browser passed');
}catch(error){
 await page.screenshot({path:out+'failure.png',fullPage:true}).catch(()=>{});
 await writeFile(out+'failure.txt',await page.locator('body').innerText().catch(()=>''));
 throw error;
}finally{await browser.close();await admin.end();}
async function login(key:string){
 await page.goto(web);
 await page.evaluate(()=>localStorage.removeItem('helios.session'));
 await page.reload();
 await page.getByLabel('Логин',{exact:true}).fill(f.actors[key].email);
 await page.getByLabel('Пароль',{exact:true}).fill(f.password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('helios.session')??'null')?.token));
 await quality();
}
async function quality(){
 await page.getByLabel('Объект',{exact:true}).selectOption(f.project);
 await page.getByRole('button',{name:'Приёмка',exact:true}).click();
 await page.getByRole('button',{name:'Самоконтроль мастера',exact:true}).click();
 await page.getByRole('heading',{name:'Самоконтроль мастера',exact:true}).waitFor();
}
async function open(n:number){
 await page.getByRole('button',{name:`Открыть предъявление Кладка ${n+1}`,exact:true}).filter({visible:true}).click();
 await page.getByRole('dialog').getByText('1 м² требует доработки',{exact:true}).waitFor();
 await page.waitForTimeout(250);
}
