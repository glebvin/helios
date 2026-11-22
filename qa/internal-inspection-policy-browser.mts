import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium, type Page} from 'playwright';
import {internalInspectionFixture} from '../apps/api/test/internal-inspection-fixture.ts';
import {assertVolumeReviewDatabase} from '../apps/api/test/volume-review-fixture.ts';
assert.equal(process.env.HELIOS_VOLUME_QA_DB_PORT,'54661');
const api=process.env.HELIOS_POLICY_API??'http://127.0.0.1:4517';
const web=process.env.HELIOS_POLICY_WEB??'http://127.0.0.1:5383';
const out=fileURLToPath(new URL('../.data/inspection-policy-browser/',import.meta.url));
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
 await login(page,'director');
 await page.getByRole('button',{name:'Объект',exact:true}).click();
 const works=page.getByRole('region',{name:'Виды работ',exact:true});
 await works.getByRole('heading',{name:'Виды работ',exact:true}).waitFor();
 const policy=works.getByRole('checkbox',{name:'Для остальных работ наш ПТО обязателен',exact:true});
 await policy.waitFor();
 assert.equal(await policy.isChecked(),true);
 await works.getByText('Скрытые работы и субподряд эта настройка не отменяет.',{exact:true}).waitFor();
 await works.getByRole('button',{name:'Изменить',exact:true}).click();
 const hidden=page.getByRole('checkbox',{name:'Скрытые работы',exact:true});
 assert.equal(await hidden.isChecked(),false);
 await hidden.check();
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();
 await page.getByText('Сервер записал «Кладка QA».',{exact:true}).waitFor();
 await page.getByText('скрытые',{exact:true}).first().waitFor();
 await policy.uncheck();
 await page.getByRole('button',{name:'Сохранить настройку',exact:true}).click();
 await page.getByText('Для остальных работ наш ПТО выключен.',{exact:true}).waitFor();
 await page.reload();
 const reloaded=await openWorks(page);
 assert.equal(await reloaded.getByRole('checkbox',{name:'Для остальных работ наш ПТО обязателен',exact:true}).isChecked(),false);
 await reloaded.getByText('скрытые',{exact:true}).waitFor();
 await login(page,'master');await open(0);
 await page.getByText('Скрытые работы проверяет наш ПТО. Настройка объекта это не отменяет.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).waitFor();
 await admin.query(`UPDATE project_work_types SET hidden_work=false WHERE tenant_id=$1`,[f.tenant]);
 await page.getByRole('button',{name:'Обновить приёмку',exact:true}).click();
 await page.getByText('Для остальных работ этого объекта проверка нашего ПТО выключена.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).count(),0);
 await admin.query(`UPDATE organizations SET kind='subcontractor' WHERE tenant_id=$1 AND id=$2`,[f.tenant,f.org]);
 await page.getByRole('button',{name:'Обновить приёмку',exact:true}).click();
 await page.getByText('Субподрядные работы проверяет наш ПТО. Настройка объекта это не отменяет.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Передать нашему ПТО',exact:true}).waitFor();
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
 await page.screenshot({path:out+'inspection-390.png',fullPage:true});
 await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const second=await browser.newPage({viewport:{width:1280,height:900}});
 second.on('pageerror',(error:Error)=>errors.push(error.message));
 await login(second,'director');
 const secondWorks=await openWorks(second);
 assert.equal(await secondWorks.getByRole('checkbox',{name:'Для остальных работ наш ПТО обязателен',exact:true}).isChecked(),false);
 await second.setViewportSize({width:390,height:844});
 assert.ok(await second.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1);
 await second.screenshot({path:out+'catalog-390.png',fullPage:true});
 await second.close();
 assert.deepEqual(errors,[]);
 await writeFile(out+'result.json',JSON.stringify({ok:true,hiddenSurvivesSetting:true,ordinaryOffHidesSubmit:true,subcontractSurvivesSetting:true,reloadKeepsSetting:true,secondLogin:true,mobile390:true,physicalPhone:false},null,2));
 console.log('mandatory PTO browser passed');
}catch(error){
 await page.screenshot({path:out+'failure.png',fullPage:true}).catch(()=>{});
 await writeFile(out+'failure.txt',await page.locator('body').innerText().catch(()=>''));
 throw error;
}finally{await browser.close();await admin.end();}
async function login(target:Page,key:string){
 await target.goto(web);
 await target.evaluate(()=>localStorage.removeItem('helios.session'));
 await target.reload();
 await target.getByLabel('Логин',{exact:true}).fill(f.actors[key].email);
 await target.getByLabel('Пароль',{exact:true}).fill(f.password);
 await target.getByRole('button',{name:'Войти',exact:true}).click();
 await target.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('helios.session')??'null')?.token));
 await target.getByRole('option',{name:'Самоконтроль QA',exact:true}).waitFor({state:'attached'});
 const select=target.getByLabel('Объект',{exact:true});
 for(let attempt=0;attempt<3;attempt++){
  await select.selectOption(f.project);
  try{await target.waitForFunction((id)=>{const el=document.querySelector('select[aria-label="Объект"]');return el instanceof HTMLSelectElement&&el.value===id;},f.project,{timeout:2000});return;}
  catch{ /* The list can ignore a choice that arrives before its options. */ }
 }
 throw new Error('project was not selected');
}
async function openWorks(target:Page){
 if(await target.getByLabel('Объект',{exact:true}).inputValue()!==f.project){
  await target.getByLabel('Объект',{exact:true}).selectOption(f.project);
  await target.getByText('Объектов несколько. Выберите один: первый в списке сам не подставляется.').waitFor({state:'hidden'});
 }
 await target.getByRole('button',{name:'Объект',exact:true}).click();
 const works=target.getByRole('region',{name:'Виды работ',exact:true});
 await works.getByRole('heading',{name:'Виды работ',exact:true}).waitFor();
 return works;
}
async function open(n:number){
 await page.getByRole('button',{name:'Приёмка',exact:true}).click();
 await page.getByRole('button',{name:'Самоконтроль мастера',exact:true}).click();
 await page.getByRole('heading',{name:'Самоконтроль мастера',exact:true}).waitFor();
 await page.getByRole('button',{name:`Открыть предъявление Кладка ${n+1}`,exact:true}).filter({visible:true}).click();
 await page.getByRole('dialog').getByText('1 м² требует доработки',{exact:true}).waitFor();
}
