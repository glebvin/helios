import assert from "node:assert/strict";
import test from "node:test";
import { canWriteStaff, staffBody, staffDraft, staffRequest, staffWriteError } from "./staff-form.ts";
import type { ServerEmployee } from "./staff-list.ts";

const org = [{ id: "org-1", name: "Своя" }];
const person: ServerEmployee = {
  id: "emp-1", fullName: "Иван Петров", phone: "+7001", organizationId: "org-1", userId: null, version: 2, status: "active",
};

test("создание и правка берут организацию из разрешённого списка", () => {
  const created = staffBody(staffDraft(null, org), null, "req-1");
  assert.equal(created.organizationId, "org-1");
  assert.equal(created.phone, null);
  assert.equal("expectedVersion" in created, false);
  const edited = staffBody({ ...staffDraft(person, org), phone: "  " }, person, "req-2");
  assert.equal(edited.expectedVersion, 2);
  assert.equal(edited.phone, null);
  assert.equal(edited.userId, null);
});

test("повтор того же тела не меняет номер запроса снаружи, а чужая роль не пишет", () => {
  const draft = staffDraft(person, org);
  const first = staffBody(draft, person, "same");
  const second = staffBody(draft, person, "same");
  assert.deepEqual(first, second);
  assert.equal(canWriteStaff("director"), true);
  assert.equal(canWriteStaff("master"), false);
  assert.equal(canWriteStaff("worker"), false);
});

test("устаревшая версия и отказ роли не выглядят как запись", () => {
  assert.match(staffWriteError(409, "stale_version"), /уже изменена/);
  assert.match(staffWriteError(403, "role_denied"), /недоступна/);
  assert.match(staffWriteError(null), /не подтверждена/);
});

test("организация не подменяется первой при нескольких или неизвестной организации карточки", () => {
  assert.equal(staffDraft(null, [...org, { id: "org-2", name: "Другая" }]).organizationId, "");
  assert.equal(staffDraft({ ...person, organizationId: "missing" }, org).organizationId, "");
});

test("подтверждение команды переживает сериализацию, изменённое тело получает другую команду", () => {
  const first = staffRequest({ id: "", key: "" }, "create-body", () => "first-id");
  const restored = JSON.parse(JSON.stringify(first));
  assert.equal(staffRequest(restored, "create-body", () => "wrong-new-id").id, "first-id");
  assert.equal(staffRequest(restored, "different-body", () => "second-id").id, "second-id");
  assert.match(staffWriteError(409, "conflict"), /конфликт данных/);
});
