import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {NestFactory} from '@nestjs/core';
import type {INestApplication} from '@nestjs/common';
import {AppModule} from '../src/app.module.js';
import {AllExceptionsFilter} from '../src/http.js';
import {createPool,adminUrl} from '../src/db.js';
import {assertVolumeReviewDatabase} from './volume-review-fixture.js';
import {internalInspectionFixture} from './internal-inspection-fixture.js';
const admin=createPool(adminUrl);let app:INestApplication,f:Awaited<ReturnType<typeof internalInspectionFixture>>;
const expect=async(p:Promise<any>,status=200)=>{const r=await p;assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
before(async()=>{await assertVolumeReviewDatabase(admin,true);app=await NestFactory.create(AppModule,{logger:false});app.useGlobalFilters(new AllExceptionsFilter());const server=await app.listen(0,'127.0.0.1');f=await internalInspectionFixture(admin,`http://127.0.0.1:${server.address().port}`);});
after(async()=>{await app?.close();await admin.end();});
test('отозванный приказ не записывает принятие нашего ПТО',async()=>{
 await f.configure();
 await expect(f.action(0,'submit',0),201);
 await expect(f.action(0,'responsible',1),201);
 await admin.query(`UPDATE responsibility_orders SET status='revoked', revocation_reason='проверка отзыва' WHERE id=$1`,[f.orderId]);
 const blocked=await expect(f.action(0,'approve',2),422);
 assert.equal(blocked.error,'revoked');
 assert.equal((await expect(f.action(0,'partial',2,{acceptedQuantity:'16',reason:'Дефект'}),422)).error,'revoked');
 assert.equal((await admin.query(`SELECT count(*)::int n FROM internal_inspection_events WHERE accepted_part_id=$1 AND action='approve'`,[f.parts[0].partId])).rows[0].n,0);
 await admin.query(`UPDATE responsibility_orders SET status='active', revocation_reason=NULL WHERE id=$1`,[f.orderId]);
 const lock=await admin.connect();await lock.query('BEGIN');
 await lock.query('SELECT id FROM responsibility_orders WHERE id=$1 FOR UPDATE',[f.orderId]);
 const pending=f.action(0,'approve',2);
 try{
  let waiting=false;
  for(let i=0;i<100;i++){
   const rows=await admin.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM responsibility_orders WHERE employee_id=%'");
   if(rows.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  assert.equal(waiting,true,'Приёмка должна дождаться изменения приказа');
  await lock.query("UPDATE responsibility_orders SET status='revoked',revocation_reason='Отзыв во время ожидания' WHERE id=$1",[f.orderId]);
  await lock.query('COMMIT');
  assert.equal((await expect(pending,422)).error,'revoked');
 }finally{
  await lock.query('ROLLBACK');lock.release();
  await admin.query("UPDATE responsibility_orders SET status='active',revocation_reason=NULL WHERE id=$1",[f.orderId]);
  await pending.catch(()=>{});
 }
 const accepted=await expect(f.action(0,'approve',2),201);
 assert.equal(accepted.state,'accepted');
});
