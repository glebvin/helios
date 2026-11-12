import test from "node:test";
import assert from "node:assert/strict";
import { timeDecisionId } from "./time-command.ts";

test("a lost response retains the time command identity when storage is blocked", () => {
  const key = crypto.randomUUID();
  const denied = () => { throw new Error("SecurityError"); };
  const first = timeDecisionId(key, "approve version 0", denied);
  assert.equal(timeDecisionId(key, "approve version 0", denied), first);
  assert.notEqual(timeDecisionId(key, "approve version 1", denied), first);
});

test("a full storage still permits a command and its identical retry", () => {
  const key = crypto.randomUUID();
  const full = () => ({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } });
  assert.equal(timeDecisionId(key, "revoke version 2", full), timeDecisionId(key, "revoke version 2", full));
});

test("saved pending commands survive a new module context and stay scoped", () => {
  const key = crypto.randomUUID(), requestId = crypto.randomUUID(), signature = "same reason and source";
  const storage = () => ({ getItem: () => JSON.stringify({ signature, requestId }), setItem: () => {} });
  assert.equal(timeDecisionId(key, signature, storage), requestId);
  assert.notEqual(timeDecisionId(key + ":another-user", signature, () => ({ getItem: () => null, setItem: () => {} })), requestId);
  assert.notEqual(timeDecisionId(key, signature + ":edited-reason", storage), requestId);
});
