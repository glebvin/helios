// Synthetic staff workbook. The customer's real columns are not confirmed.
// A repeated name is not an identity. Formulas are rejected, never calculated.
export const staffImportColumns = ["Табельный номер", "ФИО", "Телефон"] as const;
export const staffImportMaxBytes = 1024 * 1024;

export function currentPreview<T>(token: number, latest: number, value: T): T | null {
  return token === latest ? value : null;
}
export const staffImportMaxRows = 200;
const maxEntries = 40;
const maxEntryBytes = 2 * 1024 * 1024;

export type StaffImportRow = { row: number; key: string; fullName: string; phone: string; errors: string[] };
export type StaffImportPreview = { fileError: string; rows: StaffImportRow[]; saved: false };

type ZipEntry = { name: string; method: number; compressed: Uint8Array; size: number };

export async function previewStaffImport(bytes: Uint8Array, inflate: (data: Uint8Array, limit: number) => Promise<Uint8Array> | Uint8Array): Promise<StaffImportPreview> {
  if (bytes.length > staffImportMaxBytes) return empty("Файл больше 1 МБ. Предпросмотр его не читает.");
  try {
    const files = await readZip(bytes, inflate);
    const sheetName = firstSheet(files);
    const sheet = sheetName ? files.get(sheetName) : undefined;
    if (!sheet) return empty("В книге нет первого листа.");
    const strings = files.has("xl/sharedStrings.xml") ? sharedStrings(textOf(files.get("xl/sharedStrings.xml")!)) : [];
    return readSheet(textOf(sheet), strings);
  } catch (error) {
    if (error instanceof Error && error.message === "sheet") return empty("Первый лист скрыт или не поддерживается.");
    return empty("Файл не читается как книга Excel.");
  }
}

/** Copies inflated chunks until `limit`. A larger chunk cancels the reader and is not kept. */
export async function collectBounded(reader: { read: () => Promise<{ done: boolean; value?: Uint8Array }>; cancel: () => Promise<void> | void }, limit: number) {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const chunk = next.value ?? new Uint8Array();
    if (chunk.length > limit - total) {
      await reader.cancel();
      throw new Error("inflate");
    }
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

export function staffImportExample(): Uint8Array {
  const strings = [...staffImportColumns, "001", "Иванов Иван Иванович", "+7 900 000-00-01", "002", "Петрова Анна Сергеевна"];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c></row><row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c></row></sheetData></worksheet>`;
  const shared = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((item) => `<si><t>${escapeXml(item)}</t></si>`).join("")}</sst>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Сотрудники" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`;
  return storeZip([
    ["[Content_Types].xml", types],
    ["_rels/.rels", rootRels],
    ["xl/workbook.xml", workbook],
    ["xl/_rels/workbook.xml.rels", rels],
    ["xl/sharedStrings.xml", shared],
    ["xl/worksheets/sheet1.xml", sheet],
  ].map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
}

function empty(fileError: string): StaffImportPreview {
  return { fileError, rows: [], saved: false };
}

function readSheet(xml: string, strings: string[]): StaffImportPreview {
  const rows = [...xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map((match) => ({
    row: numberAttr(match[1] ?? "", "r"),
    cells: readCells(match[2] ?? "", strings),
  }));
  const header = rows.find((item) => item.row === 1);
  if (!header) return empty("В первой строке нет заголовка.");
  const titles = [header.cells[0]?.value ?? "", header.cells[1]?.value ?? "", header.cells[2]?.value ?? ""];
  if (titles.some((title, index) => title !== staffImportColumns[index]) || header.cells.some((cell) => cell.column > 2 && cell.value)) {
    return empty(`Нужны колонки «${staffImportColumns.join("», «")}». Другой состав колонок не подменяется образцом заказчика.`);
  }
  const data = rows.filter((item) => item.row > 1);
  const filled = data.filter((item) => item.cells.some((cell) => cell.value || cell.formula || cell.badType));
  if (filled.length > staffImportMaxRows) return empty(`В файле больше ${staffImportMaxRows} строк. Предпросмотр их не показывает.`);
  const parsed: StaffImportRow[] = filled.map((item) => {
    const cells = [0, 1, 2].map((column) => item.cells.find((cell) => cell.column === column));
    const errors: string[] = [];
    if (item.cells.some((cell) => cell.column > 2 && (cell.value || cell.formula))) errors.push(`Строка ${item.row}: есть колонка за пределами примера.`);
    const key = field(item.row, "Табельный номер", cells[0], 80, true, errors);
    const fullName = field(item.row, "ФИО", cells[1], 200, true, errors);
    const phone = field(item.row, "Телефон", cells[2], 500, false, errors);
    return { row: item.row, key, fullName, phone, errors };
  });
  const seen = new Map<string, number[]>();
  for (const item of parsed) {
    const id = item.key.trim().toLowerCase();
    if (!id) continue;
    const rowsWithKey = seen.get(id) ?? [];
    rowsWithKey.push(item.row);
    seen.set(id, rowsWithKey);
  }
  for (const item of parsed) {
    const same = seen.get(item.key.trim().toLowerCase()) ?? [];
    if (same.length > 1) item.errors.push(`Строка ${item.row}: табельный номер «${item.key}» повторяется в этом файле (строки ${same.join(", ")}). Это не проверка базы.`);
  }
  return { fileError: "", rows: parsed, saved: false };
}

type Cell = { column: number; value: string; formula: boolean; badType: boolean };

function field(row: number, label: string, cell: Cell | undefined, max: number, required: boolean, errors: string[]) {
  if (!cell || (!cell.value && !cell.formula && !cell.badType)) {
    if (required) errors.push(`Строка ${row}: нет поля «${label}».`);
    return "";
  }
  if (cell.formula) {
    errors.push(`Строка ${row}: в «${label}» формула. Формулы не исполняются.`);
    return "";
  }
  if (cell.badType) {
    errors.push(`Строка ${row}: «${label}» записан не текстом.`);
    return "";
  }
  if (cell.value.length > max) errors.push(`Строка ${row}: «${label}» длиннее ${max} знаков.`);
  return cell.value;
}

function readCells(xml: string, strings: string[]): Cell[] {
  return [...xml.matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((match) => {
    const attrs = match[1] ?? "";
    const body = match[2] ?? "";
    const ref = attr(attrs, "r");
    const kind = attr(attrs, "t");
    const formula = /<f[\s/>]/.test(body);
    const raw = tagText(body, "v") || inlineText(body);
    let value = "";
    let badType = false;
    if (!formula) {
      if (kind === "s") {
        const index = Number(raw);
        value = Number.isInteger(index) && strings[index] !== undefined ? strings[index] : "";
        if (raw && strings[index] === undefined) badType = true;
      } else if (kind === "inlineStr" || kind === "str") value = raw;
      else if (raw) badType = true;
    }
    return { column: columnIndex(ref), value: value.trim(), formula, badType };
  });
}

function sharedStrings(xml: string) {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) =>
    [...(match[1] ?? "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1] ?? "")).join(""));
}

function firstSheet(files: Map<string, Uint8Array>) {
  const workbook = files.get("xl/workbook.xml");
  if (!workbook) return files.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : "";
  const rels = files.get("xl/_rels/workbook.xml.rels");
  const sheet = /<sheet\b[^>]*\/?>/.exec(textOf(workbook));
  if (!sheet || !rels) throw new Error("sheet");
  const tag = sheet[0];
  const state = attr(tag, "state");
  if (state && state !== "visible") throw new Error("sheet");
  const id = attr(tag, "r:id");
  const rel = [...textOf(rels).matchAll(/<Relationship\b[^>]*\/?>/g)].find((item) => attr(item[0], "Id") === id);
  const type = rel ? attr(rel[0], "Type") : "";
  const target = rel ? attr(rel[0], "Target") : "";
  if (!id || !type.endsWith("/worksheet") || !target || target.includes("..") || target.startsWith("/") || /^[a-z]+:/i.test(target)) throw new Error("sheet");
  const name = `xl/${target.replace(/^\.\//, "")}`;
  if (!files.has(name)) throw new Error("sheet");
  return name;
}

async function readZip(bytes: Uint8Array, inflate: (data: Uint8Array, limit: number) => Promise<Uint8Array> | Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 65535); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("eocd");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (count > maxEntries || centralOffset + centralSize > bytes.length) throw new Error("central");
  const entries: ZipEntry[] = [];
  let used = 0;
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("central-entry");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (view.getUint16(cursor + 8, true) & 1) throw new Error("encrypted");
    if (size > maxEntryBytes || compressedSize > maxEntryBytes) throw new Error("entry");
    const room = maxEntryBytes - used;
    if (room <= 0 || size > room) throw new Error("inflate");
    const localName = view.getUint16(localOffset + 26, true);
    const localExtra = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localName + localExtra;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? (compressed.length > size ? null : compressed) : method === 8 ? await inflate(compressed, size) : null;
    if (!data || data.length !== size || data.length > room) throw new Error("inflate");
    used += data.length;
    entries.push({ name: name.replaceAll("\\", "/"), method, compressed: data, size });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return new Map(entries.map((entry) => [entry.name, entry.compressed]));
}

function storeZip(files: { name: string; data: Uint8Array }[]) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const local = header(0x04034b50, name, file.data, offset, false);
    locals.push(local);
    central.push(header(0x02014b50, name, file.data, offset, true));
    offset += local.length;
  }
  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, files.length, true);
  view.setUint16(10, files.length, true);
  view.setUint32(12, centralBytes.length, true);
  view.setUint32(16, offset, true);
  return concat([...locals, centralBytes, end]);
}

function header(signature: number, name: Uint8Array, data: Uint8Array, offset: number, central: boolean) {
  const bytes = new Uint8Array((central ? 46 : 30) + name.length + (central ? 0 : data.length));
  const view = new DataView(bytes.buffer);
  view.setUint32(0, signature, true);
  view.setUint16(4, 20, true);
  if (central) view.setUint16(6, 20, true);
  const sizeAt = central ? 20 : 18;
  view.setUint32(sizeAt - 4, crc32(data), true);
  view.setUint32(sizeAt, data.length, true);
  view.setUint32(sizeAt + 4, data.length, true);
  view.setUint16(central ? 28 : 26, name.length, true);
  if (central) view.setUint32(42, offset, true);
  bytes.set(name, central ? 46 : 30);
  if (!central) bytes.set(data, 30 + name.length);
  return bytes;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

const crcTable = new Uint32Array(256).map((_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function textOf(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function attr(source: string, name: string) {
  return source.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "";
}

function numberAttr(source: string, name: string) {
  const value = Number(attr(source, name));
  return Number.isInteger(value) ? value : 0;
}

function tagText(source: string, tag: string) {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? decodeXml(match[1] ?? "") : "";
}

function inlineText(source: string) {
  return [...source.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => decodeXml(item[1] ?? "")).join("");
}

function decodeXml(value: string) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return "\"";
    if (entity === "apos") return "'";
    if (entity.startsWith("#")) {
      const code = entity[1] === "x" || entity[1] === "X" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error("xml");
      return String.fromCodePoint(code);
    }
    return all;
  });
}

function columnIndex(ref: string) {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? "";
  let index = 0;
  for (const char of letters.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index - 1;
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
