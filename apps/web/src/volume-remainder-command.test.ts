import assert from 'node:assert/strict';
import test from 'node:test';
import {keepRemainderCommand,readRemainderCommand,clearRemainderCommand,type RemainderCommand} from './volume-remainder-command.ts';
test('потерянный приём остатка сохраняет количество, версию, основание и ключ команды после reload',()=>{
 const data=new Map<string,string>(),storage=()=>({getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}});
 const b:RemainderCommand={path:'/projects/11111111-1111-4111-8111-111111111111/volume-reviews/22222222-2222-4222-8222-222222222222/remainder',body:{requestId:'33333333-3333-4333-8333-333333333333',expectedVersion:2,action:'review',quantity:'0.400',checklistRunId:'44444444-4444-4444-8444-444444444444',reason:'0.2 доработать'}};
 keepRemainderCommand('original',b,storage);b.body.quantity='1';b.body.expectedVersion=8;data.set('reloaded',data.get('original')!);const restored=readRemainderCommand('reloaded',storage);assert.equal(restored?.body.quantity,'0.400');assert.equal(restored?.body.expectedVersion,2);assert.equal(restored?.body.reason,'0.2 доработать');assert.equal(readRemainderCommand('other-user',storage),null);
 clearRemainderCommand('reloaded','wrong-id',storage);assert.ok(readRemainderCommand('reloaded',storage));clearRemainderCommand('reloaded',b.body.requestId,storage);assert.equal(readRemainderCommand('reloaded',storage),null);
});
