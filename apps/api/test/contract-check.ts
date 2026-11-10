import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Test-only structural validator. No production parser or schema dependency.
export const publicContract=JSON.parse(readFileSync(new URL('../openapi.json',import.meta.url),'utf8'));
export function matchesContract(value:any,schema:any,at='value'):void{
 assert.ok(schema,`${at}: missing schema`);
 if(schema.$ref){const target=schema.$ref.slice(2).split('/').reduce((o:any,k:string)=>o?.[k],publicContract);return matchesContract(value,target,at);}
 if(value===null&&schema.nullable)return;
 if(schema.oneOf){assert.equal(schema.oneOf.filter((s:any)=>{try{matchesContract(value,s,at);return true;}catch{return false;}}).length,1,`${at}: oneOf`);return;}
 if(schema.enum)assert.ok(schema.enum.includes(value),`${at}: enum`);
 if(schema.type==='object'){
  assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`${at}: object`);
  for(const key of schema.required??[])assert.ok(Object.hasOwn(value,key),`${at}.${key}: required`);
  for(const [key,v]of Object.entries(value)){if(schema.additionalProperties===false)assert.ok(Object.hasOwn(schema.properties,key),`${at}.${key}: unexpected`);if(schema.properties?.[key])matchesContract(v,schema.properties[key],`${at}.${key}`);}
 }else if(schema.type==='array'){
  assert.ok(Array.isArray(value),`${at}: array`);if(schema.minItems!==undefined)assert.ok(value.length>=schema.minItems,at);if(schema.maxItems!==undefined)assert.ok(value.length<=schema.maxItems,at);
  value.forEach((v:any,i:number)=>matchesContract(v,schema.items,`${at}[${i}]`));
 }else if(schema.type==='integer'){assert.ok(Number.isSafeInteger(value),`${at}: integer`);}
 else if(schema.format==='binary'){assert.ok(Buffer.isBuffer(value),`${at}: binary`);}
 else assert.equal(typeof value,schema.type,`${at}: type`);
 if(typeof value==='number'){if(schema.minimum!==undefined)assert.ok(value>=schema.minimum,at);if(schema.maximum!==undefined)assert.ok(value<=schema.maximum,at);}
 if(typeof value==='string'){
  if(schema.minLength!==undefined)assert.ok(value.length>=schema.minLength,at);if(schema.maxLength!==undefined)assert.ok(value.length<=schema.maxLength,at);
  if(schema.pattern)assert.match(value,new RegExp(schema.pattern),at);
  if(schema.format==='uuid')assert.match(value,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,at);
  if(schema.format==='date')assert.equal(new Date(value+'T00:00:00Z').toISOString().slice(0,10),value,at);
  if(schema.format==='date-time')assert.ok(Number.isFinite(Date.parse(value)),at);
 }
}
export function checkHttpContract(path:string,method:string,status:number,body:any,headers:Headers):void{
 const pathname=new URL(path,'http://contract.test').pathname;
 const entry=Object.entries(publicContract.paths).find(([template])=>new RegExp('^'+template.replace(/\{[^}]+\}/g,'[^/]+')+'$').test(pathname));
 assert.ok(entry,`Undocumented path ${method} ${pathname}`);
 const operation=(entry[1] as any)[method.toLowerCase()];assert.ok(operation,`Undocumented method ${method} ${pathname}`);
 const response=operation.responses[String(status)];assert.ok(response,`Undocumented status ${method} ${pathname}: ${status}`);
 const mime=headers.get('content-type')?.split(';')[0];assert.ok(mime,`Missing response Content-Type ${pathname}`);
 const schema=response.content?.[mime]?.schema;assert.ok(schema,`Undocumented response MIME ${mime} for ${method} ${pathname} ${status}`);
 matchesContract(body,schema,`${method} ${entry[0]} ${status}`);
 for(const [name,definition]of Object.entries(response.headers??{}) as [string,any][]){const v=headers.get(name);if(definition.required)assert.ok(v,`${name} required`);if(v!==null)matchesContract(v,definition.schema,name);}
}
