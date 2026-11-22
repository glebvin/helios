import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import {hashPassword} from '../apps/api/src/password.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),out=root+'.data/control-browser';
const db=new pg.Client({connectionString:process.env.ADMIN_DATABASE_URL??'postgres://helios:helios@127.0.0.1:54637/helios_129_final'});await db.connect();
assert.equal(await realpath((await db.query('SHOW data_directory')).rows[0].data_directory),await realpath(root+'.data/pg-54637'));
const tenant=randomUUID(),org=randomUUID(),project=randomUUID(),zone=randomUUID(),work=randomUUID(),template=randomUUID(),batch=randomUUID();
const actors=Object.fromEntries(['master','supply','director','pto'].map(role=>[role,{id:randomUUID(),role,email:role+'-'+tenant+'@control-browser.test'}]));
const password='control-browser-local',hash=hashPassword(password),base=process.env.HELIOS_CONTROL_WEB??'http://127.0.0.1:5307';
await db.query("INSERT INTO tenants(id,name)VALUES($1,'Контроль QA')",[tenant]);
await db.query("INSERT INTO organizations(tenant_id,id,kind,name)VALUES($1,$2,'own','Поставщик QA')",[tenant,org]);
await db.query("INSERT INTO projects(tenant_id,id,name)VALUES($1,$2,'Контроль QA')",[tenant,project]);
for(const a of Object.values(actors)){await db.query('INSERT INTO users(id,email,name,password_hash)VALUES($1,$2,$3,$4)',[a.id,a.email,a.role,hash]);await db.query('INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',[tenant,a.id,a.role]);await db.query("INSERT INTO project_memberships(tenant_id,project_id,user_id,status)VALUES($1,$2,$3,'active')",[tenant,project,a.id]);}
for(const role of ['master','supply','pto'])await db.query('INSERT INTO employees(tenant_id,id,organization_id,user_id,full_name)VALUES($1,$2,$3,$4,$5)',[tenant,randomUUID(),org,actors[role].id,role]);
const order=randomUUID();
const ptoEmployee=(await db.query('SELECT id FROM employees WHERE user_id=$1',[actors.pto.id])).rows[0].id;
await db.query("INSERT INTO responsibility_orders(tenant_id,id,organization_id,project_id,employee_id,order_number,order_date,valid_from,valid_until,document_types,status,version)VALUES($1,$2,$3,$4,$5,'ПР-ВК-QA','2026-01-01','2026-01-01','2099-12-31',ARRAY['incoming-materials'],'active',1)",[tenant,order,org,project,ptoEmployee]);
await db.query("INSERT INTO project_work_zones(tenant_id,project_id,id,name)VALUES($1,$2,$3,'Секция QA')",[tenant,project,zone]);
await db.query("INSERT INTO project_work_types(tenant_id,project_id,id,name,unit,requires_rd,requires_material_control,requires_predecessor_acceptance,requires_id)VALUES($1,$2,$3,'Кладка QA','м3',false,true,false,false)",[tenant,project,work]);
await db.query('INSERT INTO checklist_templates(tenant_id,project_id,id,created_by)VALUES($1,$2,$3,$4)',[tenant,project,template,actors.master.id]);
const items=[{id:'seal',prompt:'Упаковка цела',kind:'yes_no',required:true,critical:true,pass:'yes'},{id:'photo',prompt:'Дополнительное фото',kind:'photo',required:false,critical:false}];
await db.query("INSERT INTO checklist_template_editions(tenant_id,project_id,template_id,edition,title,items,status,version,created_by)VALUES($1,$2,$3,1,'Упаковка QA',$4,'approved',1,$5)",[tenant,project,template,JSON.stringify(items),actors.master.id]);
await db.query('INSERT INTO material_batches(tenant_id,project_id,id,organization_id)VALUES($1,$2,$3,$4)',[tenant,project,batch,org]);
await db.query("INSERT INTO material_batch_revisions(tenant_id,project_id,batch_id,version,material_name,unit,batch_code,supplier_name,delivery_document,delivered_on,delivered_quantity,created_by)VALUES($1,$2,$3,1,'Материал QA','м3','CTRL-QA','Завод QA','УПД-QA','2026-11-16','1.000',$4)",[tenant,project,batch,actors.master.id]);
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true});let page;const errors=[];
try{
 const pages={};for(const a of Object.values(actors)){const c=await browser.newContext({viewport:{width:a.role==='pto'?390:1280,height:844}});const p=await c.newPage();p.setDefaultTimeout(30000);p.on('pageerror',e=>errors.push(e.message));pages[a.role]=p;}
 page=pages.master;await open(page,actors.master);await page.getByLabel('Упаковка цела',{exact:true}).selectOption('yes');
 const commands=[];let resolveCommitted;const committed=new Promise(r=>resolveCommitted=r);
 await page.route('**/control',async route=>{if(route.request().method()!=='POST')return route.continue();commands.push(route.request().postDataJSON());const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');resolveCommitted();});
 await page.getByRole('button',{name:'Записать ответы',exact:true}).click();await committed;await page.getByRole('button',{name:'Повторить шаг контроля',exact:true}).waitFor();
 await page.unrouteAll({behavior:'wait'});await page.reload();await material(page);await page.getByRole('button',{name:'Повторить шаг контроля',exact:true}).waitFor();
 page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/control')&&r.method()==='POST')commands.push(r.postDataJSON());});
 await page.getByRole('button',{name:'Повторить шаг контроля',exact:true}).click();await page.getByText('Сервер подтвердил исходный шаг.',{exact:true}).waitFor();assert.deepEqual(commands[1],commands[0]);assert.equal((await db.query('SELECT count(*)::int n FROM material_control_steps WHERE tenant_id=$1',[tenant])).rows[0].n,1);
 await open(pages.supply,actors.supply);await pages.supply.getByRole('button',{name:'Данные переданы',exact:true}).click();await pages.supply.getByText('Данные ОМТС записаны.',{exact:true}).waitFor();
 await open(pages.director,actors.director);await pages.director.getByRole('button',{name:'Взять ответственность',exact:true}).click();await pages.director.getByText('Ответственность РП записана.',{exact:true}).waitFor();
 await open(pages.pto,actors.pto);
 await db.query("UPDATE responsibility_orders SET status='revoked',revocation_reason='QA' WHERE id=$1",[order]);
 await pages.pto.getByRole('button',{name:'Согласовать',exact:true}).click();
 await pages.pto.getByText('Приказ отозван. Согласование им не подтверждается.',{exact:true}).waitFor();
 assert.equal((await db.query('SELECT count(*)::int n FROM material_control_steps WHERE tenant_id=$1',[tenant])).rows[0].n,3);
 await db.query("UPDATE responsibility_orders SET status='active',revocation_reason=NULL WHERE id=$1",[order]);
 await pages.pto.getByRole('button',{name:'Согласовать',exact:true}).click();await pages.pto.getByText('ПТО согласовало шаг.',{exact:true}).waitFor();await pages.pto.locator('.material-control').getByText('Принята',{exact:true}).waitFor();
 await page.reload();await material(page);await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.getByLabel('Материал',{exact:true}).fill('Материал новая редакция QA');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('heading',{name:'Материал новая редакция QA',exact:true}).waitFor();await page.getByRole('button',{name:'Записать ответы',exact:true}).waitFor();
 await page.getByLabel('Упаковка цела',{exact:true}).selectOption('no');await page.getByRole('button',{name:'Записать ответы',exact:true}).click();await page.getByText('Ответы записаны.',{exact:true}).waitFor();await page.locator('.material-control').getByText('Отклонена',{exact:true}).waitFor();
 await pages.pto.reload();await material(pages.pto);await pages.pto.getByRole('button',{name:'Согласовать',exact:true}).click();await pages.pto.getByText('Критичный пункт не пройден. Согласование его не отменяет.',{exact:true}).waitFor();
 const overflow=await pages.pto.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1);assert.deepEqual(errors,[]);await pages.pto.screenshot({path:out+'/mobile.png',fullPage:true});
 await writeFile(out+'/result.json',JSON.stringify({ok:true,fourRoles:true,lost201ReloadExactRetry:true,optionalFileOmitted:true,oneStepAfterReplay:true,acceptedThenEditedAwaiting:true,criticalRefusal:true,mobile390:true,overflow,errors},null,2));console.log('material control browser passed: four roles, lost201/reload, revision invalidation, critical refusal,390px');
}catch(e){if(page){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''));}throw e;}finally{await browser.close();await db.end();}
async function open(p,a){await p.goto(base);await p.getByLabel('Логин',{exact:true}).fill(a.email);await p.getByLabel('Пароль',{exact:true}).fill(password);await p.getByRole('button',{name:'Войти',exact:true}).click();await p.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('helios.session')??'null')?.token));await material(p);}
async function material(p){await p.getByLabel('Объект',{exact:true}).selectOption(project);await p.getByRole('button',{name:'Материалы',exact:true}).click();await p.getByRole('tab',{name:/CTRL-QA/}).click();await p.getByRole('heading',{name:/Материал.*QA/}).waitFor();}
