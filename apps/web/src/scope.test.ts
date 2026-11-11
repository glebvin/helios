import assert from "node:assert/strict";
import test from "node:test";
import { chosenProject, civilLabel, projectLabel, sameActor, scopeNotice } from "./scope.ts";

const two = [{ id: "a", name: "Первый" }, { id: "b", name: "Второй" }];

test("один объект выбирается сам", () => {
  assert.equal(chosenProject([{ id: "a", name: "Учебный" }], ""), "a");
  assert.equal(projectLabel([{ id: "a", name: "Учебный" }], ""), "Учебный");
});

test("несколько объектов не подменяют первый", () => {
  assert.equal(chosenProject(two, ""), "");
  assert.equal(chosenProject(two, "нет"), "");
  assert.equal(chosenProject(two, "b"), "b");
  assert.equal(scopeNotice({ loading: false, error: "", projects: two, total: 2, selected: "", day: "2026-11-11" }), "Объектов несколько. Выберите один: первый в списке сам не подставляется.");
});

test("пустой список и неполная страница не выглядят как выбранный объект", () => {
  assert.equal(chosenProject([], ""), "");
  assert.match(scopeNotice({ loading: false, error: "", projects: [], total: 0, selected: "", day: "2026-11-11" }), /не показал ни одного объекта/);
  assert.match(scopeNotice({ loading: false, error: "", projects: [{ id: "a", name: "А" }], total: 3, selected: "", day: "2026-11-11" }), /не весь список/);
});

test("дата берётся из календарной строки сервера", () => {
  assert.equal(civilLabel("2026-11-11"), "11 ноября");
  assert.equal(civilLabel("сегодня"), "");
});

test("чужой ответ me не считается тем же входом", () => {
  const session = { userId: "u1", tenantId: "t1", role: "director" };
  assert.equal(sameActor(session, { ...session, name: "Анна", email: "a@b.c" }), true);
  assert.equal(sameActor(session, { userId: "u2", tenantId: "t1", role: "director", name: "Павел", email: "p@b.c" }), false);
});
