/**
 * Fixed-point decimal helpers on bigint. Money and token quantities never go through
 * floating point: Stellar amounts have 7 decimals, BRL has 2, unit prices use 8.
 */

export class DecimalError extends Error {}

const DECIMAL_RE = /^\d+(\.\d+)?$/;

/** Parses "1234.56" or "1234,56" (no thousands separators) into a scaled bigint. */
export function parseDecimal(input: string, scale: number): bigint {
  let value = input.trim();
  if (value.includes(",") && !value.includes(".")) value = value.replace(",", ".");
  if (!DECIMAL_RE.test(value)) throw new DecimalError(`Valor inválido: "${input}"`);
  const [intPart = "0", frac = ""] = value.split(".");
  if (frac.length > scale) throw new DecimalError(`Use no máximo ${scale} casas decimais`);
  return BigInt(intPart + frac.padEnd(scale, "0"));
}

export function formatDecimal(value: bigint, scale: number, opts: { trim?: boolean } = {}): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, digits.length - scale);
  const frac = digits.slice(digits.length - scale);
  let out = scale > 0 ? `${intPart}.${frac}` : intPart;
  if (opts.trim && scale > 0) out = out.replace(/\.?0+$/, "");
  return (negative ? "-" : "") + out;
}

/** Changes scale, rounding half away from zero when precision is dropped. */
export function rescale(value: bigint, from: number, to: number): bigint {
  if (to >= from) return value * 10n ** BigInt(to - from);
  const divisor = 10n ** BigInt(from - to);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  let quotient = abs / divisor;
  if ((abs % divisor) * 2n >= divisor) quotient += 1n;
  return negative ? -quotient : quotient;
}

/** a (aScale) × b (bScale) → result at outScale, rounded half away from zero. */
export function mulScaled(a: bigint, aScale: number, b: bigint, bScale: number, outScale: number): bigint {
  return rescale(a * b, aScale + bScale, outScale);
}

export const STELLAR_SCALE = 7;
/** Largest amount a Stellar classic asset can hold (int64 stroops). */
export const STELLAR_MAX_STROOPS = 9_223_372_036_854_775_807n;

export const toStroops = (amount: string) => parseDecimal(amount, STELLAR_SCALE);
export const fromStroops = (stroops: bigint) => formatDecimal(stroops, STELLAR_SCALE);
