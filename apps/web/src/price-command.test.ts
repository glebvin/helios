import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { clearPriceCommand, keepPriceCommand, readPriceCommand } from "./price-command.ts";

test("unconfirmed price keeps its original version and project across reload and blocked storage", async () => {
  const data = new Map<string,string>();
  const storage = () => ({getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}});
  const key="price:"+randomUUID();
  const body={requestId:randomUUID(),workTypeId:randomUUID(),price:"19.99",start:"2026-01-01",end:"2026-06-30",expectedVersion:0};
  keepPriceCommand(key,body,storage);
  const fresh=await import(`./price-command.ts?reload=${randomUUID()}`);
  assert.deepEqual(fresh.readPriceCommand(key,storage),body);
  assert.equal(fresh.readPriceCommand(key+":other-project",storage),null);
  const blocked=()=>{throw Error("blocked")};
  keepPriceCommand(key+":blocked",body,blocked);assert.deepEqual(readPriceCommand(key+":blocked",blocked),body);
  clearPriceCommand(key,storage);assert.equal(readPriceCommand(key,storage),null);assert.equal(data.has(key),false);
});
