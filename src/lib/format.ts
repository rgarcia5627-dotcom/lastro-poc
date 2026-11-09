import { mulScaled, parseDecimal, formatDecimal } from "@/lib/decimal";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const qty = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 7 });
const pu = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 8 });

export const formatBRL = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "—" : brl.format(Number(value));

export const formatUnitPrice = (value: string | null | undefined) => (value ? pu.format(Number(value)) : "—");

export const formatQuantity = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "—" : qty.format(Number(value));

/** "2026-03-15" → "15/03/2026" without timezone shifts. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : value;
}

export function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";
  return value.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
}

export const shortAddress = (address: string | null | undefined) =>
  address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "—";

/** quantity (7 dp) × unit price (8 dp) → R$ string with 2 dp. */
export function positionValue(quantity: string, unitPrice: string): string {
  return formatDecimal(mulScaled(parseDecimal(quantity, 7), 7, parseDecimal(unitPrice, 8), 8, 2), 2);
}

export const todayISO = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/** "15000.0000000" → "15000", "12.5000" → "12.5" — exact, no float round-trip. */
export const plainDecimal = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);
