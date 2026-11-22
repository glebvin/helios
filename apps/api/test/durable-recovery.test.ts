import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {PoolClient} from 'pg';
import {reserveCommand} from '../src/durable-command.js';
import type {Actor} from '../src/workforce.service.js';

test('recovery freezes new release commands, preserves existing receipts and ordinary writes',async()=>{
 const previous=process.env.HELIOS_RELEASE_RECOVERY;
 const actor={tenantId:'tenant',userId:'actor'} as Actor;
 const client=(rowCount:number)=>({query:async()=>({rowCount})}) as unknown as PoolClient;
 const cases=[['/volume-reviews/report/corrections','correct'],['/accepted-parts/part/internal-inspection','partial'],['/internal-inspection-policy','save'],['/contract-prices/imports','import']];
 try{
  process.env.HELIOS_RELEASE_RECOVERY='1';
  for(const[path,action]of cases){
   const operation='POST /projects/project'+path,body={requestId:'id',action};
   await assert.rejects(reserveCommand(client(1),actor,operation,body),(error:any)=>error.getStatus()===503&&error.message==='release_write_paused');
   assert.equal((await reserveCommand(client(0),actor,operation,body)).inserted,false);
  }
  assert.equal((await reserveCommand(client(1),actor,'POST /projects/project/accepted-parts/part/internal-inspection',{requestId:'id',action:'approve'})).inserted,true);
  assert.equal((await reserveCommand(client(1),actor,'POST /projects/project/tasks',{requestId:'id'})).inserted,true);
  delete process.env.HELIOS_RELEASE_RECOVERY;
  assert.equal((await reserveCommand(client(1),actor,'POST /projects/project/volume-reviews/report/corrections',{requestId:'id'})).inserted,true);
 }finally{if(previous===undefined)delete process.env.HELIOS_RELEASE_RECOVERY;else process.env.HELIOS_RELEASE_RECOVERY=previous;}
});
