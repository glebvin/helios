// Review regression on the explicitly owned release contour; no public data writes.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = 'http://127.0.0.1:15219';
const manifest = JSON.parse(await readFile('.data/review-after-r25/fixture/accounts.json'));
const actor = manifest.accounts.find(a => a.role === 'director');
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const context = await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
const page = await context.newPage();page.setDefaultTimeout(20000);
const results=[];const pass=s=>{results.push(s);console.log('PASS',s)};
try {
 await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(actor.email);await page.getByLabel('Пароль',{exact:true}).fill(actor.password);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectId);await page.locator('.nav-item').filter({hasText:/^Люди$/}).click();await page.getByRole('tab',{name:'Бригады',exact:true}).click();
 const input=page.getByLabel('Название бригады',{exact:true}),create=page.getByRole('button',{name:'Создать бригаду',exact:true});await input.waitFor();
 const name='Повтор '+randomUUID(),writes=[];await input.fill(name);
 await page.route('**/api/v1/projects/'+manifest.projectId+'/crews',async route=>{if(route.request().method()!=='POST')return route.continue();writes.push(route.request().postDataJSON());const response=await route.fetch();if(writes.length===1)await route.abort();else await route.fulfill({response});});
 await create.click();await page.getByRole('alert').waitFor();await create.click();await page.getByRole('row').filter({hasText:name}).waitFor();assert.equal(writes.length,2);assert.deepEqual(writes[0],writes[1]);assert.equal(await page.getByRole('row').filter({hasText:name}).count(),1);pass('lost committed response retries identical requestId and leaves one crew');await page.unroute('**/api/v1/projects/'+manifest.projectId+'/crews');
 const headers=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('helios.session'));return{authorization:'Bearer '+s.token,'x-tenant-id':s.tenantId}});
 // More than one real server page; the last item must remain selectable.
 let current=await(await page.request.get(base+'/api/v1/projects/'+manifest.projectId+'/crews?limit=100',{headers})).json();
 for(let i=current.total;i<103;i++){const response=await page.request.post(base+'/api/v1/projects/'+manifest.projectId+'/crews',{headers,data:{requestId:randomUUID(),name:'Бригада '+i}});assert.equal(response.status(),201);}
 await page.reload();await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectId);await page.locator('.nav-item').filter({hasText:/^Люди$/}).click();await page.getByRole('tab',{name:'Бригады',exact:true}).click();await page.getByRole('row').filter({hasText:'Бригада 102'}).waitFor();assert.ok(await page.getByRole('row').count()>=104);pass('all103 crews load across pages');
 let release;const held=new Promise(resolve=>release=resolve);await page.route('**/api/v1/projects/'+manifest.projectB+'/crews?**',async route=>{await held;await route.continue();});
 await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectB);await page.getByRole('region',{name:'Бригады',exact:true}).getByText('Читаем состав…').waitFor();assert.equal(await page.getByRole('row').filter({hasText:name}).count(),0);assert.equal(await create.count(),0);pass('switching projects immediately hides old crews and commands');release();await input.waitFor();await page.unroute('**/api/v1/projects/'+manifest.projectB+'/crews?**');
 // Commit in B, hold its response, switch to A and write a new draft before B acknowledges.
 let acknowledge;const ack=new Promise(resolve=>acknowledge=resolve);let committed;const commit=new Promise(resolve=>committed=resolve);
 await page.route('**/api/v1/projects/'+manifest.projectB+'/crews',async route=>{if(route.request().method()!=='POST')return route.continue();const response=await route.fetch();committed();await ack;await route.fulfill({response});});
 await input.fill('Поздний ответ '+randomUUID());await create.click();await commit;await page.getByLabel('Объект',{exact:true}).selectOption(manifest.projectId);await input.waitFor();await input.fill('Новый черновик');acknowledge();await page.waitForTimeout(500);assert.equal(await input.inputValue(),'Новый черновик');assert.equal(await page.getByText('Сервер записал бригаду.',{exact:true}).count(),0);pass('late acknowledgement from another project leaves new draft and notifications untouched');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'.data/review-after-r25/crew-pagination-390.png',fullPage:true});
} catch(error) {await page.screenshot({path:'.data/review-after-r25/crew-review-failure.png',fullPage:true});await writeFile('.data/review-after-r25/crew-review-failure.txt',await page.locator('body').innerText());throw error;} finally {await writeFile('.data/review-after-r25/crew-review.json',JSON.stringify({results},null,2));await context.close();await browser.close();}
