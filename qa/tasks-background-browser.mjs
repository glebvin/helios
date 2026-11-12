import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.HELIOS_QA_URL??'http://127.0.0.1:5210';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const manifest=JSON.parse(await readFile(process.env.HELIOS_QA_CREDENTIALS,'utf8'));
const account=manifest.accounts.find(x=>x.role==='director');
const out=process.env.HELIOS_QA_OUTPUT??'.data/tasks-background';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(account.email);await page.getByLabel('Пароль',{exact:true}).fill(account.password);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectId);
 await page.locator('.nav-item').filter({hasText:/^Задания$/}).click();
 await page.getByRole('button',{name:'Создать задание',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByLabel('Название',{exact:true}).fill('Несохранённый черновик при сбое связи');
 await dialog.getByLabel('Зона',{exact:true}).waitFor();
 await page.route('**/api/v1/overview*',r=>r.abort());
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('Нет ответа сервера. Объект и день не подтверждены.',{exact:true}).first().waitFor();
 assert.equal(await dialog.count(),1,'background scope failure must keep the open draft');
 assert.equal(await dialog.getByLabel('Название',{exact:true}).inputValue(),'Несохранённый черновик при сбое связи');
 await page.unroute('**/api/v1/overview*');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.getByText('Нет ответа сервера. Объект и день не подтверждены.',{exact:true}).first().waitFor({state:'hidden'});
 assert.equal(await dialog.getByLabel('Название',{exact:true}).inputValue(),'Несохранённый черновик при сбое связи');
 await dialog.getByRole('button',{name:'Отмена',exact:true}).click();
 results.push('background scope read failure and recovery preserve the unsaved task draft');assert.deepEqual(errors,[]);console.log('PASS',results[0]);
}catch(e){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText());throw e}
finally{await writeFile(out+'/results.json',JSON.stringify({results,errors},null,2));await browser.close()}
