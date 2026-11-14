// Preview only. Refuses every port except this contour and does not write employees.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import pg from 'pg';
import { staffImportExample } from '../apps/web/src/staff-import.ts';

const web = new URL(process.env.HELIOS_IMPORT_WEB ?? 'http://127.0.0.1:5242');
const dbPort = process.env.HELIOS_IMPORT_DB_PORT ?? '54451';
assert.equal(web.hostname, '127.0.0.1');
assert.equal(web.port, '5242');
assert.equal(dbPort, '54451');
const db = new pg.Client({ host: '127.0.0.1', port: Number(dbPort), user: 'helios', password: 'helios', database: 'helios' });
await db.connect();
assert.equal(String((await db.query('SELECT inet_server_port() port')).rows[0].port), '54451');
const before = await db.query('SELECT count(*)::int n FROM employees');
const out = '.data/import-preview';
await mkdir(out, { recursive: true });
const example = `${out}/example.xlsx`;
const broken = `${out}/broken.xlsx`;
await writeFile(example, staffImportExample());
await writeFile(broken, brokenWorkbook());
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  const writes = [];
  page.on('request', (request) => { if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) writes.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await login(page, 'director@pilot.helios', 'pilot-director');
  writes.length = 0;
  await page.getByRole('button', { name: 'Люди', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить файл', exact: true }).waitFor();
  await page.getByLabel('Файл сотрудников Excel').setInputFiles(example);
  await page.getByRole('heading', { name: 'Сотрудники ещё не сохранены', exact: true }).waitFor();
  await page.getByText('Иванов Иван Иванович', { exact: true }).waitFor();
  await page.getByText('Петрова Анна Сергеевна', { exact: true }).waitFor();
  await page.getByText('Это проверка только этого файла. Совпадения внутри него не означают, что такая запись уже есть в базе.', { exact: true }).waitFor();
  await page.getByLabel('Файл сотрудников Excel').setInputFiles(broken);
  await page.getByText(/табельный номер «А-1» повторяется в этом файле/).waitFor();
  await page.getByText('Это не проверка базы.').first().waitFor();
  await page.getByText('Строка 4: нет поля «ФИО».').waitFor();
  assert.deepEqual(writes, []);
  await page.screenshot({ path: `${out}/desktop.png`, fullPage: true });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const narrow = await phone.newPage();
  await login(narrow, 'director@pilot.helios', 'pilot-director');
  await narrow.getByRole('button', { name: 'Люди', exact: true }).click();
  await narrow.getByLabel('Файл сотрудников Excel').setInputFiles(example);
  await narrow.getByRole('heading', { name: 'Сотрудники ещё не сохранены', exact: true }).waitFor();
  assert.ok(await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await narrow.screenshot({ path: `${out}/mobile.png`, fullPage: true });
  const worker = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const workerPage = await worker.newPage();
  await login(workerPage, 'worker@pilot.helios', 'pilot-worker');
  await workerPage.getByRole('heading', { name: 'Моя смена', exact: true }).waitFor();
  assert.equal(await workerPage.getByRole('button', { name: 'Проверить файл', exact: true }).count(), 0);
  const after = await db.query('SELECT count(*)::int n FROM employees');
  assert.equal(after.rows[0].n, before.rows[0].n);
  console.log(JSON.stringify({ ok: true, employees: after.rows[0].n, uploaded: false, mobile: true }));
} finally {
  await browser.close();
  await db.end();
}

async function login(page, email, password) {
  await page.goto(web.href);
  await page.getByLabel('Логин', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForFunction(() => !!JSON.parse(localStorage.getItem('helios.session') ?? 'null')?.token);
}

function brokenWorkbook() {
  const strings = ['Табельный номер', 'ФИО', 'Телефон', 'А-1', 'Первый', 'а-1', 'Второй', '005'];
  const cells = [
    [0, 1, 2],
    [3, 4, null],
    [5, 6, null],
    [7, null, null],
  ].map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, column) => value === null ? '' : `<c r="${String.fromCharCode(65 + column)}${rowIndex + 1}" t="s"><v>${value}</v></c>`).join('')}</row>`).join('');
  const sheet = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${cells}</sheetData></worksheet>`);
  const shared = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((item) => `<si><t>${item}</t></si>`).join('')}</sst>`);
  const rels = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  return zip([['xl/_rels/workbook.xml.rels', rels], ['xl/sharedStrings.xml', shared], ['xl/worksheets/sheet1.xml', sheet]]);
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, xml] of files) {
    const compressed = deflateRawSync(xml);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    parts.push(Buffer.concat([local, compressed]));
    const header = Buffer.alloc(46 + nameBytes.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(xml.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(offset, 42);
    nameBytes.copy(header, 46);
    central.push(header);
    offset += local.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
