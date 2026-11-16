import test from "node:test";
import assert from "node:assert/strict";
import {
  blankFrontAnswers, canWriteFrontCheck, canWriteFrontTemplate, frontAnswersComplete, frontCheckBody, frontDraft,
  frontReason, frontTemplateBody, frontTemplateCurrent, frontTemplateValidation, type FrontTemplate,
} from "./front-check.ts";

const template: FrontTemplate = {
  projectId: "p", code: "front", title: "Фронт", version: 2,
  items: [{ id: "a", label: "Ограждение", critical: true }, { id: "b", label: "Освещение", critical: false }],
};

test("only a director edits the checklist, and a worker cannot record a check", () => {
  assert.equal(canWriteFrontTemplate("director"), true);
  assert.equal(canWriteFrontTemplate("master"), false);
  assert.equal(canWriteFrontCheck("master"), true);
  assert.equal(canWriteFrontCheck("worker"), false);
});

test("a check sends every explicit answer and never a client pass", () => {
  const answers = { ...blankFrontAnswers(template), a: false, b: true };
  assert.equal(frontAnswersComplete(template, blankFrontAnswers(template)), false);
  assert.equal(frontAnswersComplete(template, answers), true);
  const body = frontCheckBody(4, template, answers, "req-1");
  assert.deepEqual(body.answers, [{ itemId: "a", value: false }, { itemId: "b", value: true }]);
  assert.equal(body.expectedVersion, 4);
  assert.equal(body.templateVersion, 2);
  assert.equal("passed" in body, false);
  assert.equal(frontTemplateCurrent(template, { ...template, version: 3 }), false);
});

test("missing material and ID modules stay visible blockers", () => {
  assert.match(frontReason("id_unsupported"), /исполнительную документацию/);
  assert.match(frontReason("material_not_accepted"), /принятая партия/);
  assert.match(frontReason("predecessor_acceptance_unsupported"), /предшественника/);
  assert.match(frontReason("critical_failed:a", template.items), /Ограждение/);
  assert.doesNotMatch(frontReason("id_unsupported"), /отключен/);
});

test("a new checklist sends its code, and an edit sends the read version", () => {
  const draft = frontDraft(template);
  assert.equal(frontTemplateValidation({ ...draft, title: "" }), "Укажите название чек-листа до 200 символов.");
  const created = frontTemplateBody(frontDraft(null), null, "req-2");
  assert.equal(created.code, "front");
  assert.equal("expectedVersion" in created, false);
  const updated = frontTemplateBody(draft, template, "req-3");
  assert.equal(updated.expectedVersion, 2);
  assert.equal("code" in updated, false);
  assert.equal(updated.items[0].critical, true);
});


test("lost front reply keeps the full command after a refreshed task version", async () => {
  const { frontCommand } = await import("./front-check.ts");
  const template = { projectId: "p", code: "front", title: "Front", version: 2, items: [{ id: "a", label: "A", critical: true }] };
  const first = frontCommand(null, 7, template, { a: true }, () => "request-a");
  const restored = JSON.parse(JSON.stringify(first));
  assert.deepEqual(frontCommand(restored, 8, template, { a: true }, () => "must-not-create"), first);
  assert.equal(frontCommand(restored, 8, template, { a: false }, () => "request-b").body.requestId, "request-b");
});
