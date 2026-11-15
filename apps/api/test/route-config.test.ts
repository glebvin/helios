import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {defaultRouteConfiguration,routeConfiguration,routeConfigCommand,routeDefinitions} from '../src/route-config.js';
const defaults=()=>defaultRouteConfiguration();
test('fourteen canonical routes keep preparer/R separate, zero C/U valid, paper actors outside accounts',()=>{
 const input=defaults(),result=routeConfiguration(input);assert.equal(result.routes.length,14);assert.equal(new Set(result.routes.map(r=>r.documentType)).size,14);
 const daily=result.routes.find(r=>r.documentType==='daily-task')!;assert.equal(daily.preparers[0]!.role,'master');assert.equal(daily.responsibles[0]!.role,'director');assert.equal(daily.approvers[0]!.role,'director');
 const front=result.routes.find(r=>r.documentType==='front-readiness')!;assert.deepEqual(front.reviewers,[]);assert.deepEqual(front.approvers,[]);
 assert.deepEqual(result.routes.find(r=>r.documentType==='ks2-readiness')!.preparers,[]);
 assert.ok(routeDefinitions.find(d=>d.code==='external-inspection')!.external.length);
 input.routes[0]!.responsibles[0]!.role='admin';assert.equal(defaults().routes[0]!.responsibles[0]!.role,'director');
});
test('fourth C, second U, absent/second R and missing mandatory roles are rejected',()=>{
 for(const mutate of [
  (c:any)=>c.routes[2].reviewers=Array.from({length:4},()=>({role:'safety',userId:randomUUID()})),
  (c:any)=>c.routes[0].approvers.push({role:'director',userId:randomUUID()}),
  (c:any)=>c.routes[0].responsibles=[],
  (c:any)=>c.routes[0].responsibles.push({role:'director',userId:randomUUID()}),
  (c:any)=>c.routes[2].reviewers=[],
  (c:any)=>c.routes[0].approvers=[],
  (c:any)=>c.routes[0].responsibles[0].role='worker',
  (c:any)=>c.routes[0].preparers[0].role='director',
 ]){const c=defaults();mutate(c);assert.throws(()=>routeConfiguration(c));}
 const c=defaults();c.routes[2]!.reviewers=Array.from({length:3},()=>({role:'safety',userId:randomUUID()}));assert.equal(routeConfiguration(c).routes[2]!.reviewers.length,3);
});
test('unknown keys/roles, duplicate documents/actors, unversioned JSON and invalid request IDs fail',()=>{
 for(const c of [null,{}, {...defaults(),schemaVersion:2},{...defaults(),hidden:true}])assert.throws(()=>routeConfiguration(c));
 const duplicate=defaults();duplicate.routes[1]=duplicate.routes[0]!;assert.throws(()=>routeConfiguration(duplicate));
 const actor=defaults();actor.routes[2]!.reviewers.push({...actor.routes[2]!.reviewers[0]!});assert.throws(()=>routeConfiguration(actor));
 const unknown=defaults();(unknown.routes[0]!.responsibles[0]as any).permissions=['admin'];assert.throws(()=>routeConfiguration(unknown));
 for(const expectedVersion of [-1,1.1,'1',2147483647])assert.throws(()=>routeConfigCommand({requestId:randomUUID(),expectedVersion,configuration:defaults()}));
 assert.throws(()=>routeConfigCommand({requestId:'bad',expectedVersion:0,configuration:defaults()}));
 assert.equal(routeConfigCommand({requestId:randomUUID(),expectedVersion:0,configuration:defaults()}).expectedVersion,0);
});
