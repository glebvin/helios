const SCALE = 1_000_000n;

export function parseDecimal(value: string | number): bigint {
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`bad_decimal:${value}`);
  }
  const negative = raw.startsWith("-");
  const [whole, frac = ""] = (negative ? raw.slice(1) : raw).split(".");
  const digits = BigInt(whole) * SCALE + BigInt((frac + "000000").slice(0, 6));
  return negative ? -digits : digits;
}

export function formatDecimal(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  const text = frac ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${text}` : text;
}

export function addDecimal(a: string, b: string): string {
  return formatDecimal(parseDecimal(a) + parseDecimal(b));
}

export function subDecimal(a: string, b: string): string {
  return formatDecimal(parseDecimal(a) - parseDecimal(b));
}

export function mulDecimal(a: string, b: string): string {
  return formatDecimal((parseDecimal(a) * parseDecimal(b)) / SCALE);
}

export function divDecimal(a: string, b: string): string {
  const divisor = parseDecimal(b);
  if (divisor === 0n) return "0";
  return formatDecimal((parseDecimal(a) * SCALE) / divisor);
}

export function cmpDecimal(a: string, b: string): number {
  const diff = parseDecimal(a) - parseDecimal(b);
  return diff === 0n ? 0 : diff > 0n ? 1 : -1;
}
