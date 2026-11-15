import { formatDecimal, parseDecimal } from "./decimal.js";

/** Предварительный каркас. Образца заказчика нет, формат не согласован. */
export const volumeImportFormat = {
  status: "preliminary" as const,
  customerFormatAgreed: false,
  columns: [
    { key: "sourceRow", title: "Номер исходной строки" },
    { key: "zone", title: "Зона" },
    { key: "workType", title: "Вид работ" },
    { key: "unit", title: "Единица" },
    { key: "quantity", title: "Объём" },
  ],
  description:
    "Строка уже разобрана: номер исходной строки, зона, вид работ, единица и объём. Зона и вид работ ищутся по имени в справочнике переданного объекта, без смены регистра. Единица должна совпасть с единицей найденного вида работ. Объём — неотрицательная десятичная строка с точкой и не больше чем шестью знаками после неё; лишние знаки не отбрасываются. Повтор зоны и вида работ остаётся отдельными строками и не суммируется.",
};

export type VolumeImportRow = {
  sourceRow: number;
  zone: string;
  workType: string;
  unit: string;
  quantity: string;
};

export type VolumeImportCatalogItem = {
  id: string;
  name: string;
  status: string;
  unit?: string;
};

export type VolumeImportCatalog = {
  zones: readonly VolumeImportCatalogItem[];
  workTypes: readonly VolumeImportCatalogItem[];
};

export type VolumeImportCheckedRow = {
  sourceRow: number | null;
  zone: string;
  workType: string;
  unit: string;
  quantity: string | null;
  zoneId: string | null;
  workTypeId: string | null;
  errors: string[];
  warnings: string[];
};

export type VolumeImportCheck = {
  preliminary: true;
  saved: false;
  fileError: string;
  rows: VolumeImportCheckedRow[];
};

export const volumeImportExampleCatalog: VolumeImportCatalog = {
  zones: [
    { id: "zone-a", name: "Секция А", status: "active" },
    { id: "zone-b", name: "Секция Б", status: "active" },
  ],
  workTypes: [
    { id: "work-masonry", name: "Кладка", unit: "м3", status: "active" },
    { id: "work-plaster", name: "Штукатурка", unit: "м2", status: "active" },
  ],
};

export const volumeImportExample: VolumeImportRow[] = [
  { sourceRow: 2, zone: "Секция А", workType: "Кладка", unit: "м3", quantity: "12.500" },
  { sourceRow: 3, zone: "Секция А", workType: "Штукатурка", unit: "м2", quantity: "40" },
  { sourceRow: 4, zone: "Секция Б", workType: "Кладка", unit: "м3", quantity: "7.25" },
];

const QUANTITY = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,6})?$/;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sourceRow(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_048_576 ? value : null;
}

function prefix(row: number | null): string {
  return row === null ? "Строка: " : `Строка ${row}: `;
}

function findItem(
  items: readonly VolumeImportCatalogItem[],
  name: string,
  phrases: { missing: string; archived: string; inactive: (status: string) => string; several: string },
): { item?: VolumeImportCatalogItem; error?: string } {
  const same = items.filter((item) => item.name.trim() === name && item.id.trim() !== "");
  const active = same.filter((item) => item.status === "active");
  if (active.length === 1) return { item: active[0] };
  if (active.length > 1) return { error: phrases.several };
  if (same.length > 0) {
    if (same.every((item) => item.status === "archived")) return { error: phrases.archived };
    const status = [...new Set(same.map((item) => item.status))].join(", ");
    return { error: phrases.inactive(status) };
  }
  return { error: phrases.missing };
}

function readQuantity(value: unknown, head: string, errors: string[]): string | null {
  if (typeof value === "number") {
    errors.push(`${head}объём нужен десятичной строкой`);
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${head}укажите объём`);
    return null;
  }
  const raw = value.trim();
  if (raw.includes(",")) {
    errors.push(`${head}десятичный разделитель объёма — точка`);
    return null;
  }
  if (raw.startsWith("-")) {
    errors.push(`${head}объём не может быть отрицательным`);
    return null;
  }
  const fraction = raw.split(".")[1] ?? "";
  if (fraction.length > 6) {
    errors.push(`${head}у объёма больше шести знаков после точки, они не отбрасываются`);
    return null;
  }
  if (!QUANTITY.test(raw)) {
    errors.push(`${head}объём не является десятичным числом`);
    return null;
  }
  return formatDecimal(parseDecimal(raw));
}

function checkRow(input: unknown, catalog: VolumeImportCatalog): VolumeImportCheckedRow {
  const record = input !== null && typeof input === "object" ? input as Record<string, unknown> : {};
  const row = sourceRow(record.sourceRow);
  const zone = text(record.zone);
  const workType = text(record.workType);
  const unit = text(record.unit);
  const errors: string[] = [];
  const head = prefix(row);
  if (row === null) errors.push(`${head}укажите номер исходной строки`);
  if (!zone) errors.push(`${head}укажите зону`);
  if (!workType) errors.push(`${head}укажите вид работ`);
  if (!unit) errors.push(`${head}укажите единицу`);
  const quantity = readQuantity(record.quantity, head, errors);
  const zoneMatch = zone ? findItem(catalog.zones, zone, {
    missing: `зона «${zone}» не найдена в справочнике объекта`,
    archived: `зона «${zone}» в архиве справочника объекта`,
    inactive: (status) => `зона «${zone}» не действует, её статус «${status}»`,
    several: `в справочнике объекта несколько зон «${zone}»`,
  }) : undefined;
  const workMatch = workType ? findItem(catalog.workTypes, workType, {
    missing: `вид работ «${workType}» не найден в справочнике объекта`,
    archived: `вид работ «${workType}» в архиве справочника объекта`,
    inactive: (status) => `вид работ «${workType}» не действует, его статус «${status}»`,
    several: `в справочнике объекта несколько видов работ «${workType}»`,
  }) : undefined;
  if (zoneMatch?.error) errors.push(`${head}${zoneMatch.error}`);
  if (workMatch?.error) errors.push(`${head}${workMatch.error}`);
  const work = workMatch?.item;
  if (work && unit && (work.unit ?? "").trim() !== unit) {
    errors.push(`${head}единица «${unit}» не совпадает с единицей вида работ «${(work.unit ?? "").trim()}»`);
  }
  return {
    sourceRow: row,
    zone,
    workType,
    unit,
    quantity,
    zoneId: zoneMatch?.item?.id ?? null,
    workTypeId: work?.id ?? null,
    errors,
    warnings: [],
  };
}

function warnRepeats(rows: VolumeImportCheckedRow[]): void {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    if (row.sourceRow === null || row.zoneId === null || row.workTypeId === null) continue;
    const key = `${row.zoneId}\0${row.workTypeId}`;
    const list = groups.get(key) ?? [];
    list.push(row.sourceRow);
    groups.set(key, list);
  }
  for (const row of rows) {
    if (row.sourceRow === null || row.zoneId === null || row.workTypeId === null) continue;
    const list = groups.get(`${row.zoneId}\0${row.workTypeId}`);
    if (!list || list.length < 2) continue;
    row.warnings.push(
      `${prefix(row.sourceRow)}зона «${row.zone}» и вид работ «${row.workType}» повторяются в строках ${list.join(", ")}. Строки оставлены, объёмы не складываются.`,
    );
  }
}

export function checkVolumeImport(rows: unknown, catalog: VolumeImportCatalog): VolumeImportCheck {
  if (!Array.isArray(rows)) {
    return { preliminary: true, saved: false, fileError: "Нужен список строк.", rows: [] };
  }
  if (!Array.isArray(catalog?.zones) || !Array.isArray(catalog?.workTypes)) {
    return { preliminary: true, saved: false, fileError: "Нужен справочник зон и видов работ этого объекта.", rows: [] };
  }
  const checked = rows.map((row) => checkRow(row, catalog));
  const seen = new Map<number, number>();
  for (const row of checked) {
    if (row.sourceRow === null) continue;
    seen.set(row.sourceRow, (seen.get(row.sourceRow) ?? 0) + 1);
  }
  for (const row of checked) {
    if (row.sourceRow !== null && (seen.get(row.sourceRow) ?? 0) > 1) {
      row.errors.push(`${prefix(row.sourceRow)}номер исходной строки повторяется`);
    }
  }
  warnRepeats(checked);
  return { preliminary: true, saved: false, fileError: "", rows: checked };
}
