import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { collectBounded, currentPreview, previewStaffImport, staffImportColumns, staffImportExample, staffImportMaxBytes, staffImportMaxRows } from "./staff-import.ts";

const inflate = (data: Uint8Array) => inflateRawSync(data);

test("пример читается и не считает одинаковые имена дублем", async () => {
  const preview = await previewStaffImport(staffImportExample(), inflate);
  assert.equal(preview.saved, false);
  assert.equal(preview.fileError, "");
  assert.deepEqual(preview.rows.map((row) => [row.row, row.key, row.fullName, row.phone, row.errors]), [
    [2, "001", "Иванов Иван Иванович", "+7 900 000-00-01", []],
    [3, "002", "Петрова Анна Сергеевна", "", []],
  ]);
  const sameName = await previewStaffImport(workbook([
    [...staffImportColumns],
    ["001", "Иванов Иван Иванович", ""],
    ["002", "Иванов Иван Иванович", ""],
  ]), inflate);
  assert.deepEqual(sameName.rows.map((row) => row.errors), [[], []]);
});

test("пустая строка пропускается, а ошибки называют номер строки", async () => {
  const preview = await previewStaffImport(workbook([
    [...staffImportColumns],
    ["", "", ""],
    ["", "Без номера", ""],
    ["003", "", "12345"],
    ["004", "Слишком длинный телефон", `x${"1".repeat(500)}`],
  ]), inflate);
  assert.equal(preview.fileError, "");
  assert.deepEqual(preview.rows.map((row) => [row.row, row.errors]), [
    [3, ["Строка 3: нет поля «Табельный номер»."]],
    [4, ["Строка 4: нет поля «ФИО».", "Строка 4: «Телефон» записан не текстом."]],
    [5, ["Строка 5: «Телефон» длиннее 500 знаков."]],
  ]);
});

test("повтор номера виден внутри файла и не выдаётся за базу", async () => {
  const preview = await previewStaffImport(workbook([
    [...staffImportColumns],
    ["А-1", "Первый", ""],
    ["а-1", "Второй", ""],
  ]), inflate);
  assert.equal(preview.rows.length, 2);
  assert.match(preview.rows[0]?.errors[0] ?? "", /строки 2, 3/);
  assert.match(preview.rows[0]?.errors[0] ?? "", /не проверка базы/);
  assert.match(preview.rows[1]?.errors[0] ?? "", /Строка 3/);
});

test("формула не исполняется, чужие колонки и границы файла отклоняются", async () => {
  const formula = await previewStaffImport(workbook([
    [...staffImportColumns],
    [{ formula: "1+1", cached: "2" }, "Из формулы", ""],
  ]), inflate);
  assert.equal(formula.rows[0]?.key, "");
  assert.equal(formula.rows[0]?.fullName, "Из формулы");
  assert.match(formula.rows[0]?.errors[0] ?? "", /Формулы не исполняются/);
  assert.equal((await previewStaffImport(workbook([["ФИО", "Телефон"]]), inflate)).rows.length, 0);
  const wide = await previewStaffImport(new Uint8Array(staffImportMaxBytes + 1), inflate);
  assert.match(wide.fileError, /1 МБ/);
  const rows = [[...staffImportColumns], ...Array.from({ length: staffImportMaxRows + 1 }, (_, index) => [String(index + 1), `Человек ${index}`, ""])];
  const overflow = await previewStaffImport(workbook(rows), inflate);
  assert.match(overflow.fileError, new RegExp(String(staffImportMaxRows)));
  assert.equal(overflow.rows.length, 0);
});

test("книга, записанная текущим writer, читается тем же контрактом", async () => {
  const require = createRequire(new URL("../../api/package.json", import.meta.url));
  const writeExcelFile = require("write-excel-file/node") as (data: unknown[]) => { toBuffer: () => Promise<Buffer> };
  const bytes = await writeExcelFile([{
    sheet: "Сотрудники",
    data: [
      staffImportColumns.map((value) => ({ type: String, value })),
      [{ type: String, value: "010" }, { type: String, value: "Сидоров" }, { type: String, value: "" }],
    ],
  }]).toBuffer();
  const preview = await previewStaffImport(new Uint8Array(bytes), inflate);
  assert.equal(preview.fileError, "");
  assert.deepEqual(preview.rows, [{ row: 2, key: "010", fullName: "Сидоров", phone: "", errors: [] }]);
});

test("первый лист берётся из workbook, даже если связь второго листа записана раньше", async () => {
  const preview = await previewStaffImport(sheets({
    order: ["rId1", "rId2"],
    rels: [["rId2", "worksheets/sheet2.xml"], ["rId1", "worksheets/sheet1.xml"]],
    sheets: { "xl/worksheets/sheet1.xml": "Первый лист", "xl/worksheets/sheet2.xml": "Второй лист" },
  }), inflate);
  assert.equal(preview.fileError, "");
  assert.equal(preview.rows[0]?.fullName, "Первый лист");
  assert.equal(JSON.stringify(preview).includes("Второй лист"), false);
});

test("скрытый и неподдерживаемый первый лист не подменяются следующим", async () => {
  const hidden = await previewStaffImport(sheets({
    order: ["rId1", "rId2"],
    hidden: true,
    rels: [["rId1", "worksheets/sheet1.xml"], ["rId2", "worksheets/sheet2.xml"]],
    sheets: { "xl/worksheets/sheet1.xml": "Скрытый", "xl/worksheets/sheet2.xml": "Видимый" },
  }), inflate);
  assert.match(hidden.fileError, /скрыт или не поддерживается/);
  assert.equal(hidden.rows.length, 0);
  const chart = await previewStaffImport(sheets({
    order: ["rId1", "rId2"],
    rels: [["rId1", "charts/chart1.xml", "chart"], ["rId2", "worksheets/sheet2.xml"]],
    sheets: { "xl/charts/chart1.xml": "Диаграмма", "xl/worksheets/sheet2.xml": "Видимый" },
  }), inflate);
  assert.match(chart.fileError, /скрыт или не поддерживается/);
  assert.equal(JSON.stringify(chart).includes("Видимый"), false);
});

test("битая числовая ссылка XML даёт ошибку файла и не оставляет старый результат", async () => {
  await assert.doesNotReject(async () => {
    const broken = await previewStaffImport(workbook([
      [...staffImportColumns],
      ["001", "&#999999999;", ""],
    ]), inflate);
    assert.match(broken.fileError, /не читается/);
    assert.equal(broken.rows.length, 0);
  });
  let latest = 1;
  const stale = currentPreview(1, latest, { fileError: "", rows: [{ fullName: "Старый" }], saved: false as const });
  latest = 2;
  assert.equal(currentPreview(1, latest, stale), null);
  assert.equal(currentPreview(2, latest, { fileError: "Файл не читается как книга Excel.", rows: [], saved: false as const })?.fileError, "Файл не читается как книга Excel.");
});

test("распаковка прекращается на границе и не дочитывает раздутую запись", async () => {
  let reads = 0;
  let cancelled = false;
  const chunk = 64 * 1024;
  await assert.rejects(collectBounded({
    read: async () => {
      reads += 1;
      return { done: false, value: new Uint8Array(chunk) };
    },
    cancel: () => { cancelled = true; },
  }, chunk));
  assert.equal(cancelled, true);
  assert.equal(reads, 2);
  let chunks = 0;
  const bomb = await previewStaffImport(sheets({
    order: ["rId1"],
    rels: [["rId1", "worksheets/sheet1.xml"]],
    sheets: { "xl/worksheets/sheet1.xml": "x" },
    claimed: 100,
  }), async (_data, limit) => collectBounded({
    read: async () => {
      chunks += 1;
      return { done: false, value: new Uint8Array(64) };
    },
    cancel: () => { cancelled = true; },
  }, limit));
  assert.match(bomb.fileError, /не читается/);
  assert.equal(chunks, 2);
  let opened = 0;
  const crowded = await previewStaffImport(sheets({
    order: ["rId1"],
    rels: [["rId1", "worksheets/sheet1.xml"]],
    sheets: { "xl/worksheets/sheet1.xml": "Один" },
    claimed: 1024 * 1024,
  }), async (_data, limit) => {
    opened += 1;
    return new Uint8Array(limit);
  });
  assert.match(crowded.fileError, /не читается/);
  assert.equal(opened, 2);
});

type Cell = string | { formula: string; cached: string };

function workbook(rows: Cell[][]) {
  const strings: string[] = [];
  const indexOf = (value: string) => {
    let index = strings.indexOf(value);
    if (index < 0) { strings.push(value); index = strings.length - 1; }
    return index;
  };
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((cell, column) => {
      const ref = `${String.fromCharCode(65 + column)}${rowIndex + 1}`;
      if (typeof cell !== "string") return `<c r="${ref}"><f>${cell.formula}</f><v>${cell.cached}</v></c>`;
      if (!cell) return "";
      if (/^\d+$/.test(cell) && rowIndex > 0 && column === 2) return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="s"><v>${indexOf(cell)}</v></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`;
  const shared = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((item) => `<si><t>${item}</t></si>`).join("")}</sst>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;
  return storedZip([
    ["xl/_rels/workbook.xml.rels", deflateRawSync(Buffer.from(rels))],
    ["xl/sharedStrings.xml", deflateRawSync(Buffer.from(shared))],
    ["xl/worksheets/sheet1.xml", deflateRawSync(Buffer.from(sheet))],
  ], [rels, shared, sheet].map((xml) => Buffer.byteLength(xml)));
}

function sheets(input: { order: string[]; hidden?: boolean; rels: [string, string, string?][]; sheets: Record<string, string>; claimed?: number }) {
  const files: [string, Buffer][] = [];
  const sizes: number[] = [];
  const add = (name: string, xml: string) => {
    const raw = Buffer.from(xml);
    files.push([name, deflateRawSync(raw)]);
    sizes.push(input.claimed ?? raw.length);
  };
  add("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${input.order.map((id, index) => `<sheet name="s${index}" sheetId="${index + 1}" r:id="${id}"${input.hidden && index === 0 ? ' state="hidden"' : ""}/>`).join("")}</sheets></workbook>`);
  add("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${input.rels.map(([id, target, kind]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind ?? "worksheet"}" Target="${target}"/>`).join("")}</Relationships>`);
  for (const [name, person] of Object.entries(input.sheets)) {
    const titles = staffImportColumns.map((title, column) => `<c r="${String.fromCharCode(65 + column)}1" t="inlineStr"><is><t>${title}</t></is></c>`).join("");
    const row = `<c r="A2" t="inlineStr"><is><t>001</t></is></c><c r="B2" t="inlineStr"><is><t>${person}</t></is></c>`;
    add(name, `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${titles}</row><row r="2">${row}</row></sheetData></worksheet>`);
  }
  return storedZip(files, sizes);
}

function storedZip(files: [string, Buffer][], sizes: number[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  files.forEach(([name, compressed], index) => {
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const chunk = Buffer.concat([local, compressed]);
    parts.push(chunk);
    const header = Buffer.alloc(46 + nameBytes.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(sizes[index] ?? 0, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    nameBytes.copy(header, 46);
    central.push(header);
    offset += chunk.length;
  });
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBytes, end]));
}
