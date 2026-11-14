// Local-only real UI check. No shared/staging ports or data are accepted.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import pg from 'pg';
import {chromium,webkit} from 'playwright';
const base='http://127.0.0.1:5252',before='http://127.0.0.1:5241';
const fixture=JSON.parse(readFileSync('.data/routes-browser-fixture.json','utf8'));
const db=new pg.Client({connectionString:'postgres://helios:helios@127.0.0.1:54551/helios'});await db.connect();
assert.equal(realpathSync((await db.query('SHOW data_directory')).rows[0].data_directory),realpathSync(resolve('.data/pg-54551')));
assert.equal((await db.query('SELECT count(*)::int n FROM projects WHERE tenant_id=$1 AND id=$2',[fixture.tenantId,fixture.projectId])).rows[0].n,1);
mkdirSync('.data/routes-browser',{recursive:true});const results=[],errors=[];
const count=async()=>(await db.query('SELECT count(*)::int n FROM route_config_versions WHERE tenant_id=$1 AND project_id=$2',[fixture.tenantId,fixture.projectId])).rows[0].n;
async function enter(browser,index,url=base){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.getByLabel('Логин',{exact:true}).fill(fixture.users[index].email);await page.getByLabel('Пароль',{exact:true}).fill(fixture.users[index].password);await page.getByRole('button',{name:'Войти',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.login'));
 const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')));assert.equal(session.tenantId,fixture.tenantId);assert.equal(session.userId,fixture.users[index].id);
 await page.getByRole('button',{name:'Настройки',exact:true}).click();return {context,page};
}
try{
 for(const [name,engine]of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true});
  try{
   if(name==='chromium'){
    const old=await enter(browser,0,before);assert.equal(await old.page.getByRole('region',{name:'Маршруты согласования',exact:true}).count(),0);await old.page.screenshot({path:'.data/routes-browser/before-admin-settings.png',fullPage:true});await old.context.close();
   }
   const {page,context}=await enter(browser,0),panel=page.getByRole('region',{name:'Маршруты согласования',exact:true});
   await panel.getByLabel('Документ',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Документ',{exact:true}).locator('option').count(),14);
   const responsible=panel.getByLabel('Ответственный · Р — РП 1',{exact:true});
   const chosen=(await responsible.inputValue())?'':fixture.users[2].id;await responsible.selectOption(chosen);
   const save=()=>panel.getByRole('button',{name:/^Сохранить (первую )?версию$/});
   const initial=await count();await save().click();await page.getByText(`Сервер записал версию ${initial+1}.`,{exact:true}).waitFor();assert.equal(await count(),initial+1);
   await page.reload();await page.getByRole('button',{name:'Настройки',exact:true}).click();await responsible.waitFor();assert.equal(await responsible.inputValue(),chosen);
   await panel.getByLabel('Документ',{exact:true}).selectOption('front-readiness');await panel.getByText('Согласование не требуется',{exact:true}).waitFor();await panel.getByText('Утверждение не требуется',{exact:true}).waitFor();
   await panel.getByLabel('Документ',{exact:true}).selectOption('external-inspection');await panel.getByText(/РП и внешний СК — бумажные подписи/).waitFor();
   await panel.getByLabel('Документ',{exact:true}).selectOption('employee-admission');
   const reviewers=panel.locator('select[aria-label^="Согласуют параллельно"]');
   if(await reviewers.count()===1){
    await reviewers.nth(0).selectOption(fixture.users[4].id);
    await panel.getByRole('button',{name:'Добавить согласующего',exact:true}).click();await reviewers.nth(1).selectOption(fixture.users[7].id);
    await panel.getByRole('button',{name:'Добавить согласующего',exact:true}).click();await reviewers.nth(2).selectOption(fixture.users[8].id);
    assert.equal(await panel.getByRole('button',{name:'Добавить согласующего',exact:true}).count(),0);
    const version=await count();await save().click();await page.getByText(`Сервер записал версию ${version+1}.`,{exact:true}).waitFor();
   }
   assert.equal(await reviewers.count(),3);assert.equal(new Set(await reviewers.evaluateAll(es=>es.map(e=>e.value))).size,3);
   await panel.getByLabel('Документ',{exact:true}).selectOption('daily-task');
   // A committed write with a lost response must keep requestId and create one revision.
   const preparer=panel.getByLabel('Готовит — Мастер СМО 1',{exact:true});await preparer.selectOption((await preparer.inputValue())?'':fixture.users[3].id);
   const sent=[];let lost=true,committed=false;
   // Fault injection must own the request; worker-owned fetches can bypass page routing.
   // PWA behaviour is covered separately; this test deliberately blocks workers in its context.
   await page.route('**/api/v1/projects/*/route-config',async route=>{
    if(route.request().method()!=='POST')return route.continue();sent.push(route.request().postDataJSON());console.log(name,'intercepted route command',sent.length);
    if(lost){if(!committed){const response=await route.fetch();assert.equal(response.status(),201);committed=true;}return route.abort('failed');}return route.continue();
   });
   const prior=await count();await save().click();await panel.getByRole('alert').filter({hasText:'Нет ответа сервера'}).waitFor();assert.equal(await count(),prior+1);lost=false;console.log(name,'lost acknowledgement surfaced, requests',sent.length);
   await save().click();await page.getByText(`Сервер записал версию ${prior+1}.`,{exact:true}).waitFor();assert.equal(await count(),prior+1);assert.ok(sent.length>=2);assert.equal(new Set(sent.map(x=>x.requestId)).size,1);await page.unroute('**/api/v1/projects/*/route-config');
   const second=await enter(browser,1),other=second.page.getByRole('region',{name:'Маршруты согласования',exact:true});await other.getByLabel('Ответственный · Р — РП 1',{exact:true}).waitFor();
   const next=(await responsible.inputValue())?'':fixture.users[2].id;await responsible.selectOption(next);await other.getByLabel('Ответственный · Р — РП 1',{exact:true}).selectOption(next);
   const previous=await count();await save().click();await page.getByText(`Сервер записал версию ${previous+1}.`,{exact:true}).waitFor();await other.getByRole('button',{name:'Сохранить версию',exact:true}).click();await other.getByRole('alert').filter({hasText:'Настройки уже изменены'}).waitFor();assert.equal(await count(),previous+1);assert.ok(await other.getByRole('button',{name:'Сохранить версию',exact:true}).isDisabled());await second.context.close();
   await panel.getByLabel('Версия для просмотра',{exact:true}).selectOption(String(initial+1));await panel.getByText(`История · версия ${initial+1}`,{exact:true}).waitFor();assert.ok(await responsible.isDisabled());await panel.getByRole('button',{name:'Вернуться к текущей версии',exact:true}).click();await panel.locator(".badge").filter({hasText:new RegExp(`^Версия ${previous+1}$`)}).waitFor();
   await page.screenshot({path:`.data/routes-browser/${name}-admin-settings.png`,fullPage:true});
   await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`.data/routes-browser/${name}-admin-390.png`,fullPage:true});
   await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:`.data/routes-browser/${name}-admin-dark-390.png`,fullPage:true});
   await context.close();
   const rp=await enter(browser,2);assert.equal(await rp.page.getByRole('region',{name:'Маршруты согласования',exact:true}).count(),0);await rp.context.close();
   results.push({browser:name,checks:['14 types','save/reload','zero C/U','paper participant','three parallel C','lost-ack stable requestId','two windows409','historical read-only','390px','RP no editor'],versionsBefore:initial,versionsAfter:await count()});
  }finally{await browser.close();}
 }
 assert.deepEqual(errors,[]);writeFileSync('.data/routes-browser/results.json',JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await db.end();}
