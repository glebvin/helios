import { cmpDecimal, formatDecimal, parseDecimal, subDecimal } from "./decimal.js";

/** Договорная цена единицы работы для готовности к КС-2. Это не зарплата и не себестоимость. */
export type ContractPrice = {
  projectId: string;
  workTypeId: string;
  unit: string;
  price: string;
  start: string;
  end: string;
  version: number;
};

export type PricedVolume = {
  projectId: string;
  workTypeId: string;
  unit: string;
  accepted: string;
  closed: string;
  on: string;
};

export type PriceIssue = "invalid_identity" | "invalid_unit" | "invalid_price" | "invalid_period" | "invalid_version";

export type PriceConflict = { left: ContractPrice; right: ContractPrice; reason: "period" | "version" };

export type ReadinessQuote =
  | { outcome: "calculated"; version: number; ready: string; notReady: string }
  | { outcome: "missing" }
  | { outcome: "unit_mismatch" }
  | { outcome: "outside_period" }
  | { outcome: "version_conflict" }
  | { outcome: "invalid_volume" }
  | { outcome: "invalid" }
  | { outcome: "inexact" };

const money = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
const day = /^(\d{4})-(\d{2})-(\d{2})$/;

function calendarDay(value: string): boolean {
  const match = day.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, date));
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === date;
}

function exactProduct(quantity: string, price: string): string | null {
  const product = parseDecimal(quantity) * parseDecimal(price);
  if (product % 1_000_000n !== 0n) return null;
  return formatDecimal(product / 1_000_000n);
}

export function validateContractPrice(price: ContractPrice): PriceIssue | null {
  if (!price.projectId.trim() || !price.workTypeId.trim()) return "invalid_identity";
  if (!price.unit.trim()) return "invalid_unit";
  if (!money.test(price.price)) return "invalid_price";
  if (!calendarDay(price.start) || !calendarDay(price.end) || price.start > price.end) return "invalid_period";
  if (!Number.isInteger(price.version) || price.version < 1) return "invalid_version";
  return null;
}

export function conflictingPrices(prices: readonly ContractPrice[]): PriceConflict[] {
  const conflicts: PriceConflict[] = [];
  for (let left = 0; left < prices.length; left += 1) {
    for (let right = left + 1; right < prices.length; right += 1) {
      const a = prices[left];
      const b = prices[right];
      if (a.projectId !== b.projectId || a.workTypeId !== b.workTypeId || a.unit !== b.unit) continue;
      if (a.version === b.version) conflicts.push({ left: a, right: b, reason: "version" });
      else if (a.start <= b.end && b.start <= a.end) conflicts.push({ left: a, right: b, reason: "period" });
    }
  }
  return conflicts;
}

/** Считает готовую и неготовую стоимость выбранной версии. Принятый и закрытый объёмы передаются вызывающим. */
export function quoteContractReadiness(prices: readonly ContractPrice[], version: number, volume: PricedVolume): ReadinessQuote {
  const matches = prices.filter((price) => price.projectId === volume.projectId && price.workTypeId === volume.workTypeId && price.version === version);
  if (matches.length === 0) return { outcome: "missing" };
  if (matches.length > 1) return { outcome: "version_conflict" };
  const price = matches[0];
  if (validateContractPrice(price)) return { outcome: "invalid" };
  if (price.unit !== volume.unit) return { outcome: "unit_mismatch" };
  if (!calendarDay(volume.on) || volume.on < price.start || volume.on > price.end) return { outcome: "outside_period" };
  if (!money.test(volume.accepted) || !money.test(volume.closed) || cmpDecimal(volume.closed, volume.accepted) > 0) return { outcome: "invalid_volume" };
  const ready = exactProduct(volume.closed, price.price);
  const open = exactProduct(subDecimal(volume.accepted, volume.closed), price.price);
  if (ready === null || open === null) return { outcome: "inexact" };
  return { outcome: "calculated", version: price.version, ready, notReady: open };
}
