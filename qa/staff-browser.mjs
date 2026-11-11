// Read-list and optional write checks run only against an isolated local fixture.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.HELIOS_QA_URL??'http://127.0.0.1:5207';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Only isolated local QA');
const manifest=JSON.parse(await readFile(process.env.HELIOS_QA_CREDENTIALS,'utf8'));
const out=process.env.HELIOS_QA_OUTPUT??'.data/pr-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const results=[],errors=[];const contexts=[];
const check=name=>{results.push({name,status:'passed'});console.log('PASS',name);};
async function login(role,viewport={width:1440,height:1000}){
 const context=await browser.newContext({viewport});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const account=manifest.accounts.find(a=>a.role===role);
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.login'));
 await page.waitForFunction(()=>!document.body.innerText.includes('Читаем вход, объект и день'));
 return {context,page};
}
async function people(page){
 const button=page.getByRole('button',{name:/^(Люди|Работники)$/});
 if(!await button.count())return false;
 await button.first().click();await page.locator('.sheet tbody tr').first().waitFor();return true;
}
try{
 const {page}=await login('director');assert.ok(await people(page));
 const source=await page.request.get(`${base}/api/v1/employees?limit=25`,{headers:await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('helios.session'));return {authorization:`Bearer ${s.token}`,'x-tenant-id':s.tenantId};})});
 const total=(await source.json()).total;assert.ok(total>=32&&total<50);
 assert.equal(await page.locator('.sheet tbody tr').count(),25);
 const first=await page.locator('.sheet tbody tr').first().innerText();
 await page.getByRole('button',{name:'Дальше',exact:true}).click();
 await page.waitForFunction(expected=>document.querySelectorAll('.sheet tbody tr').length===expected,total-25);
 assert.notEqual(await page.locator('.sheet tbody tr').first().innerText(),first);
 await page.getByRole('searchbox').fill('QA Сотрудник 01');
 await page.getByText('На этой странице такого нет. Поиск смотрит только загруженные строки.',{exact:true}).waitFor();
 await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'Назад',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.sheet tbody tr').length===25);
 const name=await page.locator('.sheet tbody tr').first().locator('b').innerText();
 await page.locator('.sheet tbody tr').first().click();await page.getByRole('heading',{name,exact:true}).waitFor();
 await page.reload();assert.ok(await people(page));
 check('real pagination, page-local search, server card and reload');
 await page.route('**/api/v1/employees?*',route=>route.abort());await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('Список не прочитан',{exact:true}).waitFor();
 assert.equal(await page.getByText('Работников пока нет',{exact:true}).count(),0);
 await page.unroute('**/api/v1/employees?*');await page.getByRole('button',{name:'Повторить загрузку',exact:true}).click();
 await page.locator('.sheet tbody tr').first().waitFor();check('network error differs from empty state and can retry');
 await page.route('**/api/v1/employees?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({items:[],total:0,limit:25,offset:0})}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('Работников пока нет',{exact:true}).waitFor();check('successful empty list is displayed separately');
 const {page:master}=await login('master');assert.ok(await people(master));
 assert.equal(await master.locator('.sheet tbody tr').count(),2);
 assert.equal(await master.getByText('QA Сотрудник 01',{exact:true}).count(),0);
 const session=await master.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')));
 const headers={authorization:`Bearer ${session.token}`,'x-tenant-id':session.tenantId};
 const outside=await page.request.get(`${base}/api/v1/employees?limit=25`,{headers:await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('helios.session'));return {authorization:`Bearer ${s.token}`,'x-tenant-id':s.tenantId};})});
 const outsider=(await outside.json()).items.find(row=>row.fullName==='QA Сотрудник 01');
 const denied=await master.request.get(`${base}/api/v1/employees/${outsider.id}`,{headers});assert.equal(denied.status(),404);
 check('master list and direct card access exclude unrelated employees');
 await master.setViewportSize({width:390,height:844});
 await master.screenshot({path:`${out}/r02-master-mobile.png`,fullPage:true});
 assert.ok(await master.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 for(const role of ['gd','ds','zds-sso','zds-soso','supply','safety','hr','customer','admin']){
  const {page:extra}=await login(role);let employeeQueries=0;
  extra.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/v1/employees'))employeeQueries++;});
  if(await people(extra)){
   assert.equal(employeeQueries,0);const employee=await extra.locator('.sheet tbody tr').first().locator('b').innerText();
   await extra.locator('.sheet tbody tr').first().click();await extra.getByRole('heading',{name:employee,exact:true}).waitFor();
   check(`${role}: existing employee list and card remain readable`);
  }
 }
 assert.deepEqual(errors,[],'browser runtime errors');
}finally{
 await writeFile(`${out}/r02-browser-results.json`,JSON.stringify({results,errors},null,2));
 for(const context of contexts)await context.close();await browser.close();
}
