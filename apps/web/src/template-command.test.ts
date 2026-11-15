import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { templateCommand, confirmedTemplateCommand } from "./template-command.ts";

test("lost template response retries its identity; confirmed new draft gets a new one", async () => {
  const data = new Map<string,string>();
  const storage = () => ({getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)},removeItem:(k:string)=>{data.delete(k)}});
  const key=randomUUID(),signature=JSON.stringify({title:"Template",items:[{id:"one",pass:"yes"}],expectedVersion:1});
  const original=templateCommand(key,signature,randomUUID,storage);
  assert.equal(templateCommand(key,signature,randomUUID,storage),original);
  const fresh=await import(`./template-command.ts?reload=${randomUUID()}`);
  assert.equal(fresh.templateCommand(key,signature,randomUUID,storage),original);
  assert.notEqual(templateCommand(key+":other-project",signature,randomUUID,storage),original);
  confirmedTemplateCommand(key,storage);
  assert.notEqual(templateCommand(key,signature,randomUUID,storage),original);
  const blocked=()=>{throw Error("blocked")};
  const memoryOnly=templateCommand(key+":blocked",signature,randomUUID,blocked);
  assert.equal(templateCommand(key+":blocked",signature,randomUUID,blocked),memoryOnly);
});
