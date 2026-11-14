import assert from "node:assert/strict";
import test from "node:test";
import { checklistPage, pinChecklist, validateChecklist, type ChecklistAnswer, type ChecklistItem, type ChecklistTemplate } from "./index.js";

function item(patch: Partial<ChecklistItem> = {}): ChecklistItem {
  return { id: "seam-clear", prompt: "Шов свободен", kind: "yes_no", required: true, critical: true, ...patch };
}

function template(items: ChecklistItem[], version = 1): ChecklistTemplate {
  return { id: "seam", version, items };
}

const ready: ChecklistAnswer[] = [
  { itemId: "seam-clear", value: "yes" },
  { itemId: "thickness", value: "12" },
  { itemId: "photo", value: "file-1" },
  { itemId: "document", value: "doc-1" },
  { itemId: "batch", value: "batch-1" },
];

function full(): ChecklistTemplate {
  return template([
    item(),
    item({ id: "thickness", prompt: "Толщина", kind: "number", unit: "мм", min: "10", max: "20" }),
    item({ id: "photo", prompt: "Фото", kind: "photo", critical: false }),
    item({ id: "document", prompt: "Документ", kind: "document", critical: false }),
    item({ id: "batch", prompt: "Партия", kind: "batch", critical: false }),
  ]);
}

test("старое прохождение остаётся на своей версии шаблона", () => {
  const source = full();
  const pinned = pinChecklist(source);
  source.version = 2;
  source.items[1] = { ...source.items[1], min: "0", max: "5", prompt: "Новая толщина" };
  source.items.push(item({ id: "extra", prompt: "Новый пункт", critical: false, required: false }));
  assert.equal(pinned.templateVersion, 1);
  assert.equal(pinned.items[1].min, "10");
  assert.equal(pinned.items.length, 5);
  assert.equal(validateChecklist(pinned, ready).ok, true);
  assert.equal(validateChecklist(pinChecklist(source), ready).ok, false);
});

test("критичный пустой пункт и нарушение границы дают отказ", () => {
  const pinned = pinChecklist(full());
  const empty = validateChecklist(pinned, ready.filter((answer) => answer.itemId !== "seam-clear"));
  assert.equal(empty.refused, true);
  assert.equal(empty.refusals.some((item) => item.reason === "critical_empty"), true);
  const high = validateChecklist(pinned, ready.map((answer) => answer.itemId === "thickness" ? { ...answer, value: "21" } : answer));
  assert.equal(high.refusals.some((item) => item.itemId === "thickness" && item.reason === "critical_invalid"), true);
  const edge = validateChecklist(pinned, ready.map((answer) => answer.itemId === "thickness" ? { ...answer, value: "20" } : answer));
  assert.equal(edge.ok, true);
  const low = validateChecklist(pinned, ready.map((answer) => answer.itemId === "thickness" ? { ...answer, value: "10" } : answer));
  assert.equal(low.ok, true);
});

test("ответ сверяется с типом пункта, ноль не подставляется вместо пропуска", () => {
  const pinned = pinChecklist(full());
  const text = validateChecklist(pinned, ready.map((answer) => answer.itemId === "thickness" ? { ...answer, value: "двенадцать" } : answer));
  assert.equal(text.refusals.some((item) => item.reason === "critical_invalid"), true);
  const wrong = validateChecklist(pinned, ready.map((answer) => answer.itemId === "photo" ? { ...answer, value: "../secret" } : answer));
  assert.equal(wrong.refusals.some((item) => item.itemId === "photo" && item.reason === "type_mismatch"), true);
  const optional = pinChecklist(template([item({ required: false, critical: false })]));
  assert.equal(validateChecklist(optional, []).ok, true);
  const required = pinChecklist(template([item({ critical: false })]));
  assert.deepEqual(validateChecklist(required, []).refusals, [{ itemId: "seam-clear", reason: "required_empty" }]);
});

test("на экран помещается десять пунктов, фото сверх двадцати отвергаются", () => {
  const items = Array.from({ length: 11 }, (_, index) => item({ id: `item-${index + 1}`, prompt: `Пункт ${index + 1}`, critical: false, required: false }));
  assert.equal(checklistPage(items, 0).length, 10);
  assert.equal(checklistPage(items, 1).length, 1);
  const photos = Array.from({ length: 21 }, (_, index) => item({ id: `photo-${index + 1}`, prompt: "Фото", kind: "photo", critical: false, required: false }));
  const answers = photos.map((photo) => ({ itemId: photo.id, value: `file-${photo.id}` }));
  assert.equal(validateChecklist(pinChecklist(template(photos)), answers).refusals.some((item) => item.reason === "photo_limit"), true);
  assert.equal(validateChecklist(pinChecklist(template(photos.slice(0, 20))), answers.slice(0, 20)).ok, true);
});
