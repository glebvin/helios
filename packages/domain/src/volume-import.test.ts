import assert from "node:assert/strict";
import test from "node:test";
import {
  checkVolumeImport,
  volumeImportExample,
  volumeImportExampleCatalog,
  volumeImportFormat,
} from "./volume-import.js";

const catalog = volumeImportExampleCatalog;

test("синтетический пример сходится со справочником объекта", () => {
  const before = structuredClone(volumeImportExample);
  const dictionaries = structuredClone(catalog);
  const result = checkVolumeImport(volumeImportExample, dictionaries);
  assert.equal(volumeImportFormat.customerFormatAgreed, false);
  assert.equal(volumeImportFormat.status, "preliminary");
  assert.deepEqual(volumeImportExample, before);
  assert.deepEqual(dictionaries, catalog);
  assert.equal(result.saved, false);
  assert.equal(result.fileError, "");
  assert.deepEqual(
    result.rows.map((row) => [row.sourceRow, row.zoneId, row.workTypeId, row.quantity, row.errors, row.warnings]),
    [
      [2, "zone-a", "work-masonry", "12.5", [], []],
      [3, "zone-a", "work-plaster", "40", [], []],
      [4, "zone-b", "work-masonry", "7.25", [], []],
    ],
  );
});

test("пустые поля и неточная десятичная запись остаются ошибками строки", () => {
  const rows = [
    { sourceRow: 2, zone: " ", workType: "", unit: "", quantity: "" },
    { sourceRow: 3, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: "1,5" },
    { sourceRow: 4, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: "1.1234567" },
    { sourceRow: 5, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: "-1" },
    { sourceRow: 6, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: 0.1 },
  ];
  const result = checkVolumeImport(rows, catalog);
  assert.deepEqual(result.rows.map((row) => row.quantity), [null, null, null, null, null]);
  assert.deepEqual(result.rows[0].errors, [
    "Строка 2: укажите зону",
    "Строка 2: укажите вид работ",
    "Строка 2: укажите единицу",
    "Строка 2: укажите объём",
  ]);
  assert.deepEqual(result.rows[1].errors, ["Строка 3: десятичный разделитель объёма — точка"]);
  assert.deepEqual(result.rows[2].errors, ["Строка 4: у объёма больше шести знаков после точки, они не отбрасываются"]);
  assert.deepEqual(result.rows[3].errors, ["Строка 5: объём не может быть отрицательным"]);
  assert.deepEqual(result.rows[4].errors, ["Строка 6: объём нужен десятичной строкой"]);
  assert.equal(result.rows.length, rows.length);
});

test("повтор зоны и вида работ не удаляет строки и не складывает объёмы", () => {
  const rows = [
    { sourceRow: 2, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: "1.25" },
    { sourceRow: 5, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: "0.75" },
    { sourceRow: 9, zone: "Секция Б", workType: "Кладка", unit: "м3", quantity: "3" },
  ];
  const result = checkVolumeImport(rows, catalog);
  assert.deepEqual(result.rows.map((row) => row.quantity), ["1.25", "0.75", "3"]);
  assert.deepEqual(result.rows[0].warnings, [
    "Строка 2: зона «Секция А» и вид работ «Кладка» повторяются в строках 2, 5. Строки оставлены, объёмы не складываются.",
  ]);
  assert.match(result.rows[1].warnings[0], /строках 2, 5/);
  assert.deepEqual(result.rows[2].warnings, []);
  assert.deepEqual(result.rows.map((row) => row.errors), [[], [], []]);
});

test("чужой, архивный и неоднозначный справочник не подменяются", () => {
  const foreign = {
    zones: [
      { id: "other-zone", name: "Секция А", status: "active" },
      { id: "archived-zone", name: "Секция Б", status: "archived" },
      { id: "dup-1", name: "Секция В", status: "active" },
      { id: "dup-2", name: "Секция В", status: "active" },
    ],
    workTypes: [
      { id: "work-masonry", name: "Кладка", unit: "м3", status: "active" },
      { id: "archived-work", name: "Штукатурка", status: "archived", unit: "м2" },
    ],
  };
  const rows = [
    { sourceRow: 2, zone: "Секция Г", workType: "Кровля", unit: "м2", quantity: "1" },
    { sourceRow: 3, zone: "Секция Б", workType: "Штукатурка", unit: "м2", quantity: "1" },
    { sourceRow: 4, zone: "Секция В", workType: "Кладка", unit: "м2", quantity: "1" },
    { sourceRow: 5, zone: "секция А", workType: "Кладка", unit: "м3", quantity: "0.000001" },
  ];
  const before = structuredClone(rows);
  const result = checkVolumeImport(rows, foreign);
  assert.deepEqual(rows, before);
  assert.equal(result.rows[0].zoneId, null);
  assert.equal(result.rows[0].workTypeId, null);
  assert.deepEqual(result.rows[0].errors, [
    "Строка 2: зона «Секция Г» не найдена в справочнике объекта",
    "Строка 2: вид работ «Кровля» не найден в справочнике объекта",
  ]);
  assert.deepEqual(result.rows[1].errors, [
    "Строка 3: зона «Секция Б» в архиве справочника объекта",
    "Строка 3: вид работ «Штукатурка» в архиве справочника объекта",
  ]);
  assert.deepEqual(result.rows[2].errors, [
    "Строка 4: в справочнике объекта несколько зон «Секция В»",
    "Строка 4: единица «м2» не совпадает с единицей вида работ «м3»",
  ]);
  assert.equal(result.rows[2].zoneId, null);
  assert.equal(result.rows[2].workTypeId, "work-masonry");
  assert.equal(result.rows[3].zoneId, null);
  assert.equal(result.rows[3].quantity, "0.000001");
  assert.deepEqual(result.rows[3].errors, ["Строка 5: зона «секция А» не найдена в справочнике объекта"]);
});
