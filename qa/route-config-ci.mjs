import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {resolve} from 'node:path';

// Called by the existing disposable CI browser job, never by a published site.
export async function routeConfigUiSmoke(browser,base,out,sourceAccount){
 assert.equal(process.env.HELIOS_CI_FIXTURE,'disposable');
 assert.equal(process.env.ADMIN_DATABASE_URL,'postgres://helios:helios@127.0.0.1:54339/helios');
 assert.equal(base,'http://127.0.0.1:5207');
 const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL});await db.connect();
 const tenant=randomUUID(),project=randomUUID();
 const users=['admin','director','master'].map(role=>({id:randomUUID(),role,email:`${randomUUID()}@route-ci.test`}));
 let owned=false,context,page;
 try{
  assert.ok((await db.query('SHOW data_directory')).rows[0].data_directory.endsWith('/codex-api/.data/pg-54339'));
  // Reuse only the public synthetic seed password/hash, never real accounts.
  const hash=(await db.query('SELECT password_hash FROM users WHERE lower(email)=$1',[sourceAccount.email.toLowerCase()])).rows[0]?.password_hash;assert.ok(hash);
  await db.query('BEGIN');await db.query("INSERT INTO tenants(id,name) VALUES($1,'Route UI CI')",[tenant]);await db.query("INSERT INTO projects(tenant_id,id,name) VALUES($1,$2,'Route UI CI project')",[tenant,project]);
  for(const u of users){await db.query('INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4)',[u.id,u.email,`CI ${u.role}`,hash]);await db.query('INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',[tenant,u.id,u.role]);await db.query('INSERT INTO project_memberships(tenant_id,project_id,user_id) VALUES($1,$2,$3)',[tenant,project,u.id]);}
  await db.query('COMMIT');owned=true;
  context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(users[0].email);await page.getByLabel('Пароль',{exact:true}).fill(sourceAccount.password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.login'));
  const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('helios.session')));assert.equal(session.tenantId,tenant);assert.equal(session.role,'admin');
  await page.getByRole('button',{name:'Настройки',exact:true}).click();const panel=page.getByRole('region',{name:'Маршруты согласования',exact:true});await panel.getByLabel('Документ',{exact:true}).waitFor();
  assert.equal(await panel.getByLabel('Документ',{exact:true}).locator('option').count(),14);
  await panel.getByLabel('Ответственный · Р — РП 1',{exact:true}).selectOption(users[1].id);await panel.getByRole('button',{name:'Сохранить первую версию',exact:true}).click();await page.getByText('Сервер записал версию 1.',{exact:true}).waitFor();
  await page.reload();await page.getByRole('button',{name:'Настройки',exact:true}).click();await panel.getByLabel('Документ',{exact:true}).waitFor();assert.equal(await panel.getByLabel('Ответственный · Р — РП 1',{exact:true}).inputValue(),users[1].id);
  await panel.getByLabel('Готовит — Мастер СМО 1',{exact:true}).selectOption(users[2].id);
  const ids=[];let drop=true,committed=false;
  await page.route('**/api/v1/projects/*/route-config',async route=>{
   if(route.request().method()!=='POST')return route.continue();ids.push(route.request().postDataJSON().requestId);
   if(drop){if(!committed){assert.equal((await route.fetch()).status(),201);committed=true;}return route.abort('failed');}return route.continue();
  });
  await panel.getByRole('button',{name:'Сохранить версию',exact:true}).click();await panel.getByRole('alert').filter({hasText:'Нет ответа сервера'}).waitFor();drop=false;
  await panel.getByRole('button',{name:'Сохранить версию',exact:true}).click();await page.getByText('Сервер записал версию 2.',{exact:true}).waitFor();assert.ok(ids.length>=2);assert.equal(new Set(ids).size,1);
  assert.equal((await db.query('SELECT count(*)::int n FROM route_config_versions WHERE tenant_id=$1',[tenant])).rows[0].n,2);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:resolve(out,'route-config-390.png'),fullPage:true});
 }catch(error){
  await page?.screenshot({path:resolve(out,"route-config-failure.png"),fullPage:true}).catch(()=>{});throw error;
 }finally{
  await context?.close();await db.query('ROLLBACK');
  if(owned){
   await db.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])',[users.map(u=>u.id)]);
   for(const table of ['route_config_versions','people_command_receipts','project_memberships','memberships','projects','audit_log','tenants'])await db.query(`DELETE FROM ${table} WHERE ${table==='tenants'?'id':'tenant_id'}=$1`,[tenant]);
   await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[users.map(u=>u.id)]);
  }
  await db.end();
 }
}
