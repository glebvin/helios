import assert from "node:assert/strict";
import test from "node:test";
import { expiringWithin30Days, orderApplies, plusDays, type ResponsibilityOrderFact } from "../src/responsibility-orders.js";

const order = (patch: Partial<ResponsibilityOrderFact>): ResponsibilityOrderFact => ({
  id: "order-1", employeeId: "person", organizationId: "company", projectId: "object",
  documentTypes: ["hidden-works-act"], validFrom: "2026-01-01", validUntil: "2026-12-31", status: "active", ...patch,
});
const query = { employeeId: "person", organizationId: "company", projectId: "object", documentType: "hidden-works-act", on: "2026-06-01" };

test("действующий приказ подходит человеку, компании, объекту, типу и сроку", () => {
  assert.deepEqual(orderApplies([order({})], query), { applicable: true, reason: "active", orderId: "order-1" });
});

test("чужие человек, компания, объект и тип не подменяются", () => {
  const rows = [order({})];
  assert.equal(orderApplies(rows, { ...query, employeeId: "other" }).reason, "person");
  assert.equal(orderApplies(rows, { ...query, organizationId: "other" }).reason, "company");
  assert.equal(orderApplies(rows, { ...query, projectId: "other" }).reason, "object");
  assert.equal(orderApplies(rows, { ...query, documentType: "daily-task" }).reason, "type");
});

test("истёкший и отозванный приказ не действуют, строки не складываются", () => {
  assert.equal(orderApplies([order({ validUntil: "2026-05-01" })], query).reason, "expired");
  assert.equal(orderApplies([order({ validFrom: "2026-07-01" })], query).reason, "not_started");
  assert.equal(orderApplies([order({ status: "revoked" })], query).reason, "revoked");
  assert.equal(orderApplies([order({ id: "old", status: "revoked" }), order({ id: "new" })], query).orderId, "new");
});

test("истечение в ближайшие 30 дней не считает уже прошедший или дальний срок", () => {
  assert.equal(expiringWithin30Days("active", plusDays("2026-11-15", 30), "2026-11-15"), true);
  assert.equal(expiringWithin30Days("active", plusDays("2026-11-15", 31), "2026-11-15"), false);
  assert.equal(expiringWithin30Days("active", "2026-11-14", "2026-11-15"), false);
  assert.equal(expiringWithin30Days("revoked", "2026-11-20", "2026-11-15"), false);
});
