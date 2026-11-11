import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.HELIOS_QA_URL??'http://127.0.0.1:5207';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Writes require isolated local QA');
const manifest=JSON.parse(await readFile(process.env.HELIOS_QA_CREDENTIALS,'utf8'));
const out=process.env.HELIOS_QA_OUTPUT??'.data/pr-review';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const results=[],contexts=[],errors=[];const check=name=>{results.push({name,status:'passed'});console.log('PASS',name);};
async function login(role){
 const context=await browser.newContext({viewport:{width:1440,height:1000}});contexts.push(context);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 const account=manifest.accounts.find(a=>a.role===role);
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.login'));
 return {context,page};
}
async function headers(page){return page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('helios.session'));return {authorization:`Bearer ${s.token}`,'x-tenant-id':s.tenantId};});}
async function records(page){const response=await page.request.get(`${base}/api/v1/employees?limit=100`,{headers:await headers(page)});assert.equal(response.status(),200);return (await response.json()).items;}
async function people(page){await page.getByRole('button',{name:/^(Люди|Работники)$/}).first().click();await page.locator('.sheet tbody tr').first().waitFor();}
async function createForm(page,name){await page.getByRole('button',{name:'Добавить сотрудника',exact:true}).click();await page.getByRole('dialog').getByLabel('Имя',{exact:true}).fill(name);}
try{
 const {page}=await login('director');await people(page);
 const name=`00 QA повтор ${randomUUID().slice(0,8)}`;const ids=[];
 await createForm(page,name);
 await page.route('**/api/v1/employees',async route=>{
  if(route.request().method()!=='POST')return route.continue();
  ids.push(route.request().postDataJSON().requestId);
  const response=await route.fetch();assert.equal(response.status(),201);await route.abort();
 });
 await page.getByRole('button',{name:'Создать на сервере',exact:true}).click();await page.getByRole('alert').filter({hasText:'Запись не подтверждена'}).waitFor();
 assert.equal((await records(page)).filter(row=>row.fullName===name).length,1);
 await page.unroute('**/api/v1/employees');await page.reload();await people(page);await createForm(page,name);
 page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/employees')ids.push(request.postDataJSON().requestId);});
 await page.getByRole('button',{name:'Создать на сервере',exact:true}).click();await page.getByText(`Сервер записал «${name}».`,{exact:true}).waitFor();
 assert.equal((await records(page)).filter(row=>row.fullName===name).length,1,'lost response + reload must not duplicate employee');
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);check('lost create response survives reload and repeats same command without duplicate');
 await page.getByRole('dialog').getByRole('button',{name:'Закрыть',exact:true}).last().click();
 const {page:fresh}=await login('director');await people(fresh);await fresh.getByText(name,{exact:true}).click();await fresh.getByRole('heading',{name,exact:true}).waitFor();
 check('created employee is visible after a new login');
 const row=(await records(fresh)).find(row=>row.fullName===name);
 const localPhone=`+700${Date.now()}`;const externalPhone=`+701${Date.now()}`;
 await fresh.getByLabel('Телефон',{exact:true}).fill(localPhone);
 await fresh.route(`**/api/v1/employees/${row.id}`,route=>route.request().method()==='GET'?route.abort():route.continue());
 await fresh.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await fresh.getByRole('alert').filter({hasText:'Показана последняя прочитанная версия'}).waitFor();
 assert.equal(await fresh.getByLabel('Телефон',{exact:true}).inputValue(),localPhone);
 await fresh.unroute(`**/api/v1/employees/${row.id}`);check('temporary background read failure preserves the editable draft with a visible notice');
 const response=await fresh.request.put(`${base}/api/v1/employees/${row.id}`,{headers:await headers(fresh),data:{requestId:randomUUID(),fullName:row.fullName,organizationId:row.organizationId,userId:row.userId,phone:externalPhone,expectedVersion:row.version,status:'active'}});assert.equal(response.status(),200);
 const reread=fresh.waitForResponse(r=>new URL(r.url()).pathname===`/api/v1/employees/${row.id}`&&r.request().method()==='GET');
 await fresh.evaluate(()=>window.dispatchEvent(new Event('focus')));await reread;
 await fresh.getByText(externalPhone,{exact:true}).first().waitFor();
 assert.equal(await fresh.getByLabel('Телефон',{exact:true}).inputValue(),localPhone,'background refresh must preserve draft');
 await fresh.getByRole('button',{name:'Сохранить на сервере',exact:true}).click();await fresh.getByRole('alert').filter({hasText:'Карточка уже изменена'}).waitFor();
 assert.equal((await records(fresh)).find(item=>item.id===row.id).phone,externalPhone);check('concurrent update preserves draft and stale version cannot overwrite server');
 await fresh.getByRole('button',{name:'Прочитать карточку',exact:true}).click();
 await fresh.waitForFunction(value=>[...document.querySelectorAll('input')].some(input=>input.value===value),externalPhone);
 await fresh.getByLabel('Телефон',{exact:true}).fill(localPhone);await fresh.getByRole('button',{name:'Сохранить на сервере',exact:true}).click();
 await fresh.getByText(`Сервер записал «${name}».`,{exact:true}).waitFor();assert.equal((await records(fresh)).find(item=>item.id===row.id).phone,localPhone);
 await fresh.reload();await people(fresh);await fresh.getByText(name,{exact:true}).click();await fresh.getByRole('heading',{name,exact:true}).waitFor();
 assert.equal(await fresh.getByLabel('Телефон',{exact:true}).inputValue(),localPhone);check('explicit reload resolves conflict and edit persists after refresh');
 await fresh.setViewportSize({width:390,height:844});await fresh.screenshot({path:`${out}/r03-edit-mobile.png`,fullPage:true});
 assert.ok(await fresh.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));check('employee form fits 390px viewport');
 await fresh.getByLabel('Состояние',{exact:true}).selectOption('archived');
 await fresh.getByRole('button',{name:'Сохранить на сервере',exact:true}).click();
 await fresh.getByText('Архивную карточку сервер не принимает к правке.',{exact:true}).waitFor();
 assert.equal((await records(fresh)).find(item=>item.id===row.id).status,'archived');
 assert.equal(await fresh.getByRole('button',{name:'Сохранить на сервере',exact:true}).isDisabled(),true);check('archive is confirmed by server and archived card cannot be edited');
 await fresh.reload();await people(fresh);const conflictName=`00 QA конфликт ${randomUUID().slice(0,8)}`;
 await createForm(fresh,conflictName);await fresh.getByRole('dialog').getByLabel('Телефон',{exact:true}).fill(localPhone);
 await fresh.getByRole('button',{name:'Создать на сервере',exact:true}).click();
 await fresh.getByRole('alert').filter({hasText:'конфликт данных'}).waitFor();
 assert.equal((await records(fresh)).filter(item=>item.fullName===conflictName).length,0);check('duplicate phone is reported as conflict without false success');
 for(const role of ['master','worker']){
  const {page:restricted}=await login(role);
  if(role==='master')await people(restricted);
  assert.equal(await restricted.getByRole('button',{name:'Добавить сотрудника',exact:true}).count(),0);
  const denied=await restricted.request.post(`${base}/api/v1/employees`,{headers:await headers(restricted),data:{requestId:randomUUID(),fullName:'Запрещённая запись',organizationId:manifest.organizationId,phone:null,userId:null}});
  assert.equal(denied.status(),403);check(`${role}: no create control and direct write denied`);
 }
 assert.deepEqual(errors,[],'browser runtime errors');
}finally{
 await writeFile(`${out}/r03-browser-results.json`,JSON.stringify({results,errors},null,2));for(const context of contexts)await context.close();await browser.close();
}
