import assert from 'node:assert/strict';
import test from 'node:test';
import {readInspectionCommand,keepInspectionCommand,clearInspectionCommand,type InspectionCommand} from './internal-inspection-command.ts';
test('потерянная приёмка после reload сохраняет действие, исходную версию и закреплённый маршрут',()=>{
 const data=new Map<string,string>(),storage=()=>({getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}});
 const command:InspectionCommand={path:'/projects/11111111-1111-4111-8111-111111111111/accepted-parts/22222222-2222-4222-8222-222222222222/internal-inspection',body:{requestId:'33333333-3333-4333-8333-333333333333',expectedVersion:0,action:'submit',expectedRouteVersion:4}};
 keepInspectionCommand('inspection-original',command,storage);command.body.action='approve';command.body.expectedVersion=2;
 data.set('inspection-restored',data.get('inspection-original')!);assert.deepEqual(readInspectionCommand('inspection-restored',storage)?.body,{requestId:command.body.requestId,expectedVersion:0,action:'submit',expectedRouteVersion:4});
 assert.equal(readInspectionCommand('another-actor-part',storage),null);clearInspectionCommand('inspection-restored','another-request',storage);assert.ok(readInspectionCommand('inspection-restored',storage));clearInspectionCommand('inspection-restored',command.body.requestId,storage);assert.equal(readInspectionCommand('inspection-restored',storage),null);
 data.set('broken',JSON.stringify({path:command.path,body:{...command.body,action:'delete'}}));assert.equal(readInspectionCommand('broken',storage),null);
});
