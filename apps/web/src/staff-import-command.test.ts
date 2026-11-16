import assert from "node:assert/strict";
import test from "node:test";
import { clearImportCommand, keepImportCommand, readImportCommand } from "./staff-import-command.ts";

const body = { requestId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", fileBase64: "eGxzeA==", verdictHash: "a".repeat(64) };
test("неизвестный результат сохраняет исходный файл, работодателя и requestId после восстановления", () => {
  const saved = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); }, removeItem: (key: string) => { saved.delete(key); } });
  keepImportCommand("original", body, storage);
  saved.set("restored", saved.get("original")!);
  assert.deepEqual(readImportCommand("restored", storage), body);
  assert.equal(readImportCommand("other-user", storage), null);
  clearImportCommand("restored", storage);
  assert.equal(readImportCommand("restored", storage), null);
});
test("заполненное браузерное хранилище не теряет идентичность повтора в текущей вкладке", () => {
  const denied = () => { throw new Error("storage unavailable"); };
  keepImportCommand("memory-only", body, denied);
  assert.deepEqual(readImportCommand("memory-only", denied), body);
  clearImportCommand("memory-only", denied);
  assert.equal(readImportCommand("memory-only", denied), null);
});
