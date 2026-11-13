import assert from "node:assert/strict";
import test from "node:test";
import { addable, crewError, memberFacts, memberVersion, type Crew, type CrewAssignment } from "./crew.ts";

const open = { eligible: true, reasons: [] };
const closed = { eligible: false, reasons: ["check_failed"] };

test("снятый остаётся в истории состава и не считается допущенным", () => {
  assert.deepEqual(memberFacts("active", true), { membership: "В составе", admission: "Допуск актуален" });
  assert.deepEqual(memberFacts("revoked", false), { membership: "Снят", admission: "Допуск не актуален" });
  assert.equal(memberVersion([{ employeeId: "a", status: "revoked", version: 2, currentAdmission: closed }], "a"), 2);
  assert.equal(memberVersion([], "a"), 0);
});

test("в новую бригаду не предлагается человек из другой и без допуска", () => {
  const crews: Crew[] = [{ id: "c", projectId: "p", name: "А", version: 1, members: [{ employeeId: "busy", status: "active", version: 1, currentAdmission: open }] }];
  const assignments: CrewAssignment[] = [
    { employeeId: "busy", status: "active", currentAdmission: open },
    { employeeId: "free", status: "active", currentAdmission: open },
    { employeeId: "closed", status: "active", currentAdmission: closed },
    { employeeId: "off", status: "revoked", currentAdmission: open },
  ];
  assert.deepEqual(addable(assignments, crews).map((row) => row.employeeId), ["free"]);
});

test("ошибки состава не обещают запись", () => {
  assert.match(crewError(422, "admission_required"), /назначение/);
  assert.match(crewError(409, "crew_conflict"), /другой бригаде/);
  assert.match(crewError(403), /руководитель/);
});


import { crewAttempt } from "./crew.ts";
test("ambiguous crew retry preserves identity; changed command or invalid storage gets a new identity", () => {
  const firstId = "33333333-3333-4333-8333-333333333333";
  const secondId = "44444444-4444-4444-8444-444444444444";
  const first = crewAttempt(null, "actor/project/create/name", () => firstId);
  assert.equal(crewAttempt(first, first.signature, () => secondId).requestId, firstId);
  assert.equal(crewAttempt(first, "actor/other-project/create/name", () => secondId).requestId, secondId);
  assert.equal(crewAttempt({signature:first.signature,requestId:"broken"}, first.signature, () => secondId).requestId, secondId);
});
