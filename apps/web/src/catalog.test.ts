import test from "node:test";
import assert from "node:assert/strict";
import { activeForNewTask, canWriteCatalog, catalogBody, catalogError, catalogValidation, workTypeDraft, type WorkType, type Zone } from "./catalog.ts";

const zone: Zone = { id: "z", projectId: "p", name: "Этаж 2", version: 3, status: "active" };
const archived: Zone = { ...zone, id: "old", name: "Старый этаж", status: "archived" };
const work: WorkType = {
  id: "w", projectId: "p", name: "Бетонирование", version: 2, status: "active", unit: "м3",
  requiresRd: true, requiresMaterialControl: true, requiresPredecessorAcceptance: false, requiresId: true,
};

test("archived zone and work type are not offered for a new task", () => {
  assert.deepEqual(activeForNewTask([zone, archived, work, { ...work, id: "old-type", status: "archived" }]).map((item) => item.id), ["z", "w"]);
});

test("only a director writes the catalog", () => {
  assert.equal(canWriteCatalog("director"), true);
  assert.equal(canWriteCatalog("master"), false);
  assert.equal(canWriteCatalog("pto"), false);
  assert.equal(canWriteCatalog("worker"), false);
});

test("work type keeps every requirement and does not invent a pass", () => {
  const draft = workTypeDraft(work);
  const body = catalogBody("work-types", draft, work, "req-1");
  assert.equal(body.requiresRd, true);
  assert.equal(body.requiresMaterialControl, true);
  assert.equal(body.requiresPredecessorAcceptance, false);
  assert.equal(body.requiresId, true);
  assert.equal("passed" in body, false);
  assert.equal(body.expectedVersion, 2);
  assert.equal(body.unit, "м3");
  const created = catalogBody("work-types", { ...draft, status: "archived" }, null, "req-2");
  assert.equal("expectedVersion" in created, false);
  assert.equal("status" in created, false);
  assert.equal(created.requiresId, true);
});

test("zone update sends the version and archive state, creation does not", () => {
  assert.deepEqual(catalogBody("zones", { name: "  Секция А  ", status: "archived" }, zone, "req-3"), {
    requestId: "req-3", name: "Секция А", expectedVersion: 3, status: "archived",
  });
  assert.equal("status" in catalogBody("zones", { name: "Секция А", status: "active" }, null, "req-4"), false);
  assert.match(catalogValidation("work-types", { ...workTypeDraft(null), name: "Кладка" }), /единицу/);
});

test("permission, stale version and a lost answer stay different", () => {
  assert.match(catalogError(403), /недоступно/);
  assert.match(catalogError(409, "stale_version"), /Прочитайте актуальную/);
  assert.match(catalogError(null), /Нет подтверждения/);
});
