import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,realpath} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {chromium} from 'playwright';
import {hashPassword} from '../apps/api/src/password.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=process.env.HELIOS_MATERIAL_QA_DB_PORT??'54633';assert.equal(port,'54633');
const db=new pg.Client({host:'127.0.0.1',port:Number(port),user:'helios',password:'helios',database:'helios'});await db.connect();
assert.equal(await realpath((await db.query('SHOW data_directory')).rows[0].data_directory),await realpath(root+'.data/pg-'+port));
const base='http://127.0.0.1:5303',tenant=randomUUID(),org=randomUUID(),otherOrg=randomUUID(),project=randomUUID(),otherProject=randomUUID();
const password='material-browser-local';const actors=['master','pto'].map(role=>({role,id:randomUUID(),email:role+'-'+tenant+'@material.test'}));
const hash=hashPassword(password);await db.query("INSERT INTO tenants(id,name)VALUES($1,'QA материалов')",[tenant]);
await db.query("INSERT INTO organizations(tenant_id,id,kind,name)VALUES($1,$2,'own','Свой работодатель'),($1,$3,'subcontractor','Другой работодатель')",[tenant,org,otherOrg]);
await db.query("INSERT INTO projects(tenant_id,id,name)VALUES($1,$2,'Материалы А'),($1,$3,'Материалы Б')",[tenant,project,otherProject]);
for(const actor of actors){await db.query('INSERT INTO users(id,email,name,password_hash)VALUES($1,$2,$3,$4)',[actor.id,actor.email,actor.role,hash]);await db.query('INSERT INTO memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',[tenant,actor.id,actor.role]);for(const p of [project,otherProject])await db.query("INSERT INTO project_memberships(tenant_id,project_id,user_id,status)VALUES($1,$2,$3,'active')",[tenant,p,actor.id]);}
await db.query("INSERT INTO employees(tenant_id,id,organization_id,full_name,user_id)VALUES($1,$2,$3,'Мастер QA',$4)",[tenant,randomUUID(),org,actors[0].id]);
const pdf=Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(70*1024,32),Buffer.from('\n%%EOF')]);
const file={name:'quality.pdf',mimeType:'application/pdf',buffer:pdf};
const out=root+'.data/material-browser';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const errors=[];let page;
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});page=await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
 await login(page,actors[0]);await materials(page,project);await page.getByRole('button',{name:'Новая партия',exact:true}).click();
 await page.getByLabel('Работодатель',{exact:true}).selectOption(org);
 for(const[label,value]of [['Материал','Газоблок QA'],['Единица','м3'],['Номер партии','QA-1'],['Поставщик','Завод QA'],['Документ поставки','УПД-QA'],['Дата поставки','2026-11-16'],['Количество','12,5']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByLabel('Документ качества',{exact:true}).setInputFiles(file);
 const sent=[];
 await page.route('**/api/v1/projects/'+project+'/material-batches',async route=>{if(route.request().method()!=='POST')return route.continue();sent.push(route.request().postDataJSON());const response=await route.fetch();assert.equal(response.status(),201);await route.abort('failed');});
 await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('button',{name:'Повторить запись партии',exact:true}).waitFor();
 await page.unrouteAll({behavior:'wait'});await page.reload();await materials(page,project);
 page.on('request',r=>{if(new URL(r.url()).pathname===`/api/v1/projects/${project}/material-batches`&&r.method()==='POST')sent.push(r.postDataJSON());});
 await page.getByRole('button',{name:'Повторить запись партии',exact:true}).click();
 await page.getByRole('heading',{name:'Газоблок QA',exact:true}).waitFor();assert.deepEqual(sent[1],sent[0]);
 assert.equal((await db.query('SELECT count(*)::int n FROM material_batches WHERE tenant_id=$1',[tenant])).rows[0].n,1);
 await page.getByLabel('Дозагрузить quality.pdf',{exact:true}).setInputFiles(file);
 await page.getByRole('button',{name:'Открыть',exact:true}).waitFor();
 await page.getByRole('button',{name:'Изменить',exact:true}).click();await page.getByLabel('Материал',{exact:true}).fill('Газоблок M500 QA');await page.getByRole('button',{name:'Сохранить',exact:true}).click();await page.getByRole('heading',{name:'Газоблок M500 QA',exact:true}).waitFor();
 let release,started;const hold=new Promise(r=>release=r),begin=new Promise(r=>started=r);
 await page.route('**/api/v1/projects/'+project+'/material-batches?*',async route=>{const response=await route.fetch();started();await hold;await route.fulfill({response});});
 await page.getByLabel('Поиск',{exact:true}).fill('Газоблок');await begin;
 await page.getByLabel('Объект',{exact:true}).selectOption(otherProject);await page.getByText('Партий нет',{exact:true}).waitFor();release();await page.unrouteAll({behavior:'wait'});assert.equal(await page.getByRole('heading',{name:'Газоблок M500 QA',exact:true}).count(),0);
 const reader=await browser.newContext({viewport:{width:390,height:844}});const pto=await reader.newPage();pto.on('pageerror',e=>errors.push(e.message));await login(pto,actors[1]);await materials(pto,project);
 await pto.getByRole('tab',{name:/Газоблок M500 QA/}).click();await pto.getByRole('heading',{name:'Газоблок M500 QA',exact:true}).waitFor();assert.equal(await pto.getByRole('button',{name:'Изменить',exact:true}).count(),0);
 await pto.evaluate(() => { const original = window.open; window.open = function(url,...args) { window.__materialBlobUrl = String(url); return original.call(window,url,...args); }; });
 const download=pto.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes('/documents/')&&r.url().endsWith('/content'));
 await pto.getByRole('button',{name:'Открыть',exact:true}).click();const response=await download;assert.equal(response.status(),200);const renderedBytes=await pto.evaluate(async () => [...new Uint8Array(await (await fetch(window.__materialBlobUrl)).arrayBuffer())]);assert.deepEqual(Buffer.from(renderedBytes),pdf);
 const overflow=await pto.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert.ok(overflow<=1);await pto.screenshot({path:out+'/mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 await writeFile(out+'/result.json',JSON.stringify({ok:true,lostReply:true,exactReloadRetry:true,resumedFile:true,editHistory:true,lateProjectIgnored:true,ptoDownloadedSameBytes:true,mobile390:true,overflow,errors},null,2));console.log('material browser passed: lost reply/reload, file resume, edit, project race, PTO bytes,390px');
} catch(e){if(page){await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});await writeFile(out+'/failure.txt',await page.locator('body').innerText().catch(()=>''));}throw e;}finally{await browser.close();await db.end();}
async function login(page,actor){await page.goto(base);await page.getByLabel('Логин',{exact:true}).fill(actor.email);await page.getByLabel('Пароль',{exact:true}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.waitForFunction(()=>Boolean(JSON.parse(localStorage.getItem('helios.session')??'null')?.token));}
async function materials(page,p){await page.getByLabel('Объект',{exact:true}).waitFor();await page.getByLabel('Объект',{exact:true}).selectOption(p);await page.getByRole('button',{name:'Материалы',exact:true}).click();await page.getByRole('heading',{name:'Материалы',exact:true}).waitFor();}
