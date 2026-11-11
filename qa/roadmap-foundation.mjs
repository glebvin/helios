// Synthetic local QA only. Credentials and fixture IDs are supplied outside Git.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.HELIOS_QA_URL??'http://127.0.0.1:5207';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Only isolated local QA');
const manifest=JSON.parse(await readFile(process.env.HELIOS_QA_CREDENTIALS,'utf8'));
const out=process.env.HELIOS_QA_OUTPUT??'.data/pr-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const results=[],errors=[];
const check=name=>{results.push({name,status:'passed'});console.log('PASS',name);};
async function login(role,viewport={width:1440,height:1000}){
 const context=await browser.newContext({viewport,timezoneId:'Pacific/Honolulu'});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const account=manifest.accounts.find(a=>a.role===role);
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.login'));
 await page.waitForFunction(()=>!document.body.innerText.includes('Читаем вход, объект и день'));
 return {context,page};
}
try{
 for(const account of manifest.accounts){
  const {context,page}=await login(account.role);
  if(account.role!=='worker'){
   await page.getByLabel('Объект',{exact:true}).waitFor();
   if(account.role==='director'){
    assert.equal(await page.getByLabel('Объект',{exact:true}).inputValue(),'');
    await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectId);
    await page.getByText('Задание первого объекта',{exact:true}).first().waitFor();
    assert.equal(await page.getByText('Задание второго объекта',{exact:true}).count(),0);
    await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectB);
    await page.getByText('Задание второго объекта',{exact:true}).first().waitFor();
    assert.equal(await page.getByText('Задание первого объекта',{exact:true}).count(),0);
    await page.screenshot({path:`${out}/r01-director.png`,fullPage:true});
    check('project selection changes visible task data and never selects first of several silently');
   }else assert.equal(await page.getByLabel('Объект',{exact:true}).inputValue(),manifest.projectId);
  }else await page.getByRole('heading',{name:'Моя смена',exact:true}).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('Этому входу сервер не показал ни одного объекта'));
  check(`cabinet ${account.role} retains assigned-project access`);await context.close();
 }
 const {context,page}=await login('director',{width:390,height:844});
 await page.screenshot({path:`${out}/r01-mobile.png`,fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile overflow');
 assert.ok(await page.locator('.page').evaluate(element=>element.scrollWidth<=element.clientWidth+1),'mobile content clipped inside workspace');
 check('390px viewport has no document overflow');
 await page.route('**/api/v1/me',route=>route.fulfill({status:401,contentType:'application/json',body:'{"error":"unauthorized"}'}));
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByRole('heading',{name:'Кто входит',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.getItem('helios.session')),null);
 check('expired session clears account data and returns to login');await context.close();
 assert.deepEqual(errors,[],'browser runtime errors');
}finally{
 await writeFile(`${out}/r01-browser-results.json`,JSON.stringify({results,errors},null,2));await browser.close();
}
