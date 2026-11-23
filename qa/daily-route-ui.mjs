import assert from 'node:assert/strict';
import {resolve} from 'node:path';

// Shared real-UI scenario for local Chromium/WebKit and the existing CI Chromium job.
export async function dailyRouteUi(browser,base,out,data,label,beforeBase){
 const {state,task}=data,f=state.fixture,contexts=[],errors=[],results=[];
 const user=key=>f.users.find(u=>u.key===key);
 async function enter(key,url=base){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.getByLabel('Логин',{exact:true}).fill(user(key).email);await page.getByLabel('Пароль',{exact:true}).fill(user(key).password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.login'));
  const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')));assert.equal(session.tenantId,f.tenantId);assert.equal(session.userId,user(key).id);
  return {page,context};
 }
 async function open(page){
  const project=page.getByLabel('Объект',{exact:true});await project.waitFor();if(await project.inputValue()!==f.projectId)await project.selectOption(f.projectId);
  await page.getByRole('button',{name:'Задания',exact:true}).click();await page.getByRole('button',{name:task.title,exact:true}).click();await page.getByRole('heading',{name:task.title,exact:true}).waitFor();
  const panel=page.getByRole('region',{name:'Согласование',exact:true});await panel.getByText(/\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/).waitFor();assert.equal(await panel.getByText('Не настроен',{exact:true}).count(),0);return panel;
 }
 const get=async(path)=>{const r=await fetch(state.base+'/api/v1'+path,{headers:{authorization:`Bearer ${state.tokens.rp}`,'x-tenant-id':f.tenantId}});assert.equal(r.status,200);return r.json();};
 const taskPath=`/projects/${f.projectId}/tasks/${task.id}`;
 try{
  if(beforeBase){const old=await enter('master',beforeBase);const project=old.page.getByLabel('Объект',{exact:true});await project.waitFor();if(await project.inputValue()!==f.projectId)await project.selectOption(f.projectId);await old.page.getByRole('button',{name:'Задания',exact:true}).click();await old.page.getByRole('button',{name:task.title,exact:true}).click();await old.page.getByRole('region',{name:'Публикация',exact:true}).waitFor();await old.page.screenshot({path:resolve(out,`${label}-before.png`),fullPage:true});await old.context.close();}
  const master=await enter('master'),panel=await open(master.page);
  await panel.getByRole('button',{name:'Отправить РП',exact:true}).waitFor();assert.equal(await panel.getByRole('button',{name:'Утвердить и опубликовать',exact:true}).count(),0);await master.page.screenshot({path:resolve(out,`${label}-master-draft.png`),fullPage:true});
  const wrongMaster=await enter('master2'),wrongMasterPanel=await open(wrongMaster.page);assert.equal(await wrongMasterPanel.getByRole('button',{name:'Отправить РП',exact:true}).count(),0);await wrongMaster.context.close();
  const sent=[];let drop=true,committed=false;
  await master.page.route(`**/api/v1/projects/${f.projectId}/tasks/${task.id}/submit`,async route=>{
   sent.push(route.request().postDataJSON().requestId);if(drop){if(!committed){assert.equal((await route.fetch()).status(),200);committed=true;}return route.abort('failed');}return route.continue();
  });
  await panel.getByRole('button',{name:'Отправить РП',exact:true}).click();const send=master.page.getByRole('dialog');await send.getByRole('button',{name:'Отправить РП',exact:true}).click();await send.getByRole('alert').filter({hasText:'Нет подтверждения сервера'}).waitFor();
  assert.equal((await get(taskPath+'/route')).route.history.length,1);drop=false;await send.getByRole('button',{name:'Отправить РП',exact:true}).click();await send.waitFor({state:'hidden'});assert.ok(sent.length>=2);assert.equal(new Set(sent).size,1);await master.page.unroute(`**/api/v1/projects/${f.projectId}/tasks/${task.id}/submit`);results.push('master submit/lost-ack is one attempt');
  const wrongRp=await enter('rp2'),wrongPanel=await open(wrongRp.page);assert.equal(await wrongPanel.getByRole('button',{name:'Утвердить и опубликовать',exact:true}).count(),0);assert.equal(await wrongPanel.getByRole('button',{name:'Вернуть',exact:true}).count(),0);await wrongRp.context.close();results.push('other master/RP have no transition buttons');
  const rp=await enter('rp'),rpPanel=await open(rp.page);await rpPanel.getByRole('button',{name:'Утвердить и опубликовать',exact:true}).waitFor();await rp.page.screenshot({path:resolve(out,`${label}-rp-pending.png`),fullPage:true});
  await rpPanel.getByRole('button',{name:'Вернуть',exact:true}).click();const back=rp.page.getByRole('dialog');await back.getByLabel('Причина',{exact:true}).fill('Уточнить план перед исполнением');await back.getByRole('button',{name:'Вернуть',exact:true}).click();await back.waitFor({state:'hidden'});assert.equal((await get(taskPath)).status,'draft');
  await master.page.reload();const returned=await open(master.page);await returned.locator('summary').filter({hasText:'История согласования'}).click();await returned.getByText('Уточнить план перед исполнением',{exact:true}).waitFor();await master.page.screenshot({path:resolve(out,`${label}-master-returned.png`),fullPage:true});
  await returned.getByRole('button',{name:'Отправить РП',exact:true}).click();await master.page.getByRole('dialog').getByRole('button',{name:'Отправить РП',exact:true}).click();await master.page.getByRole('dialog').waitFor({state:'hidden'});assert.equal((await get(taskPath+'/route')).route.attempt.number,2);results.push('return reason/history and second attempt survive reload');
  await master.context.close();
  await rp.page.reload();const first=await open(rp.page),secondRp=await enter('rp'),second=await open(secondRp.page);
  await first.getByRole('button',{name:'Утвердить и опубликовать',exact:true}).click();await second.getByRole('button',{name:'Утвердить и опубликовать',exact:true}).click();
  await rp.page.getByRole('dialog').getByRole('button',{name:'Утвердить и опубликовать',exact:true}).click();await rp.page.getByRole('dialog').waitFor({state:'hidden'});
  await secondRp.page.getByRole('dialog').getByRole('button',{name:'Утвердить и опубликовать',exact:true}).click();await secondRp.page.getByRole('dialog').getByRole('alert').filter({hasText:'Задание уже изменено'}).waitFor();
  assert.equal((await get(taskPath)).status,'published');assert.equal((await get(taskPath+'/route')).route.history.length,4);results.push('two approval dialogs preserve versions: one publication, other409');
  await secondRp.page.getByRole('dialog').getByRole('button',{name:'Прочитать актуальное задание',exact:true}).click();await secondRp.page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await second.getByRole('button',{name:'Утвердить и опубликовать',exact:true}).count(),0);
  await secondRp.context.close();
  await first.locator('summary').filter({hasText:'История согласования'}).click();await first.getByText('Утверждено и опубликовано',{exact:true}).waitFor();await rp.page.screenshot({path:resolve(out,`${label}-approved.png`),fullPage:true});
  await rp.page.setViewportSize({width:390,height:844});assert.ok(await rp.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await rp.page.screenshot({path:resolve(out,`${label}-390.png`),fullPage:true});await rp.page.evaluate(()=>document.documentElement.dataset.theme='dark');await rp.page.screenshot({path:resolve(out,`${label}-dark-390.png`),fullPage:true});results.push('history, deadline unset,390px/light/dark');
  await rp.context.close();
  const worker=await enter('worker');assert.equal(await worker.page.getByRole('button',{name:/Утвердить и опубликовать|Отправить РП/}).count(),0);results.push('worker has no approval controls');assert.deepEqual(errors,[]);return {browser:label,results,errors};
 }catch(error){for(const [i,context]of contexts.entries())for(const page of context.pages())await page.screenshot({path:resolve(out,`${label}-failure-${i}.png`),fullPage:true}).catch(()=>{});throw error;}
 finally{for(const context of contexts)await context.close();}
}
