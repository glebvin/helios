import assert from "node:assert/strict";
import test from "node:test";
import { keepMaterialCommand, readMaterialCommand, clearMaterialCommand } from "./material-command.ts";

test("неизвестная правка партии восстанавливает прежнюю версию и документ, а не обновлённую форму", () => {
  const saved = new Map<string, string>();
  const storage = () => ({ getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => { saved.set(k, v); }, removeItem: (k: string) => { saved.delete(k); } });
  const command = { path: "/projects/22222222-2222-4222-8222-222222222222/material-batches/33333333-3333-4333-8333-333333333333", body: { requestId: "11111111-1111-4111-8111-111111111111", expectedVersion: 4, documents: [{ sha256: "a".repeat(64) }] } };
  keepMaterialCommand("original-material", command, storage);
  command.body.expectedVersion = 5;
  saved.set("restored-material", saved.get("original-material")!);
  const restored = readMaterialCommand("restored-material", storage);
  assert.equal(restored?.body.expectedVersion, 4);
  assert.equal(restored?.body.requestId, command.body.requestId);
  assert.deepEqual(restored?.body.documents, [{ sha256: "a".repeat(64) }]);
  assert.equal(readMaterialCommand("another-project", storage), null);
  clearMaterialCommand("restored-material", storage);
  assert.equal(readMaterialCommand("restored-material", storage), null);
});
