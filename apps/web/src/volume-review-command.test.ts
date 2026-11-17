import assert from 'node:assert/strict';
import test from 'node:test';
import {readReviewCommand,keepReviewCommand,clearReviewCommand} from './volume-review-command.ts';
test('потерянное решение после reload сохраняет исходные17, версию и requestId',()=>{
 const data=new Map<string,string>(),storage=()=>({getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}});
 const command={path:'/projects/11111111-1111-4111-8111-111111111111/volume-reviews/22222222-2222-4222-8222-222222222222',body:{requestId:'33333333-3333-4333-8333-333333333333',expectedVersion:0,checklistRunId:'44444444-4444-4444-8444-444444444444',acceptedQuantity:'17',reason:'1 требует доработки'}};
 keepReviewCommand('review-original',command,storage);command.body.acceptedQuantity='16';command.body.expectedVersion=1;
 data.set('review-restored',data.get('review-original')!);const restored=readReviewCommand('review-restored',storage);assert.equal(restored?.body.acceptedQuantity,'17');assert.equal(restored?.body.expectedVersion,0);assert.equal(restored?.body.requestId,command.body.requestId);
 assert.equal(readReviewCommand('another-actor',storage),null);
 clearReviewCommand('review-restored','different-request',storage);assert.ok(readReviewCommand('review-restored',storage));
 clearReviewCommand('review-restored',command.body.requestId,storage);assert.equal(readReviewCommand('review-restored',storage),null);
});
