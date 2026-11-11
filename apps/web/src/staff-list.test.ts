import assert from "node:assert/strict";
import test from "node:test";
import { searchStaff, staffError, staffNotice, staffQuery, type ServerEmployee } from "./staff-list.ts";

const page: ServerEmployee[] = [
  { id: "a", fullName: "Иван Петров", phone: "+7001", organizationId: "o", userId: null, version: 1, status: "active" },
  { id: "b", fullName: "Яна QA", phone: null, organizationId: "o", userId: "u", version: 1, status: "active" },
];

test("запрос берёт страницу, а не весь список", () => {
  assert.equal(staffQuery(0), "/employees?limit=25&offset=0");
  assert.equal(staffQuery(25), "/employees?limit=25&offset=25");
});

test("поиск не выходит за загруженные строки", () => {
  assert.equal(searchStaff(page, "иван").length, 1);
  assert.equal(searchStaff(page, "+7001")[0]?.id, "a");
  assert.equal(searchStaff(page, "нет").length, 0);
  assert.match(staffNotice({ error: "", total: 40, loaded: 2, shown: 0, needle: "нет" }), /только загруженные/);
  assert.equal(staffNotice({ error: "", total: 2, loaded: 2, shown: 0, needle: "нет" }), "");
});

test("пустой ответ и ошибка не совпадают", () => {
  assert.equal(staffNotice({ error: "", total: 0, loaded: 0, shown: 0, needle: "" }), "");
  assert.match(staffError(null), /не подтверждён/);
  assert.match(staffError(401), /Войдите снова/);
  assert.match(staffError(403), /не разрешён/);
  assert.match(staffError(404, true), /карточку/);
});
