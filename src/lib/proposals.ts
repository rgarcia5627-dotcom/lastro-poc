import { z } from "zod";
import type { Amortization, ScenarioRow } from "@/lib/db/schema";
import { formatDecimal, parseDecimal, rescale } from "@/lib/decimal";
import { decimalField, optionalText } from "@/lib/validation";

/*
 * The structuring loop, in plain functions (no DB): parsing a scenario out of a form,
 * describing a structure, comparing two structures and turning a ticket into tokens.
 * A scenario's levers: ticket (face value), coupon, term, grace, amortization, discount and
 * fee design, mezzanine/subordinated risk allocation and embedded collateral.
 */

export const AMORTIZATIONS: { value: Amortization; label: string }[] = [
  { value: "bullet", label: "Bullet (no vencimento)" },
  { value: "sac", label: "SAC mensal" },
  { value: "price", label: "Price mensal" },
];

export const amortizationLabel = (a: Amortization) => AMORTIZATIONS.find((x) => x.value === a)?.label ?? a;

/** At most three scenarios per round keeps the choice readable for the institution. */
export const MAX_SCENARIOS = 3;
export const scenarioLetter = (i: number) => String.fromCharCode(65 + i);

const months = (label: string, min: number) =>
  z.coerce
    .number({ message: `${label}: informe um número de meses` })
    .int(`${label}: use meses inteiros`)
    .min(min, `${label}: mínimo de ${min}`)
    .max(600, `${label}: máximo de 600 meses`);

export const scenarioSchema = z
  .object({
    ticket: decimalField(2, { label: "Ticket" }),
    remuneration: z.string().trim().min(3, "Informe a remuneração (ex.: CDI + 4,5% a.a.)").max(80),
    termMonths: months("Prazo", 1),
    graceMonths: months("Carência", 0),
    amortization: z.enum(["bullet", "sac", "price"], { message: "Escolha a amortização" }),
    discount: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : "0"))
      .pipe(decimalField(2, { label: "Deságio", allowZero: true, max: 9999n })),
    fees: optionalText.refine((v) => v === null || v.length <= 200, "Fees: máximo de 200 caracteres"),
    subordination: optionalText.refine((v) => v === null || v.length <= 200, "Subordinação: máximo de 200 caracteres"),
    guarantees: optionalText.refine((v) => v === null || v.length <= 200, "Colateral: máximo de 200 caracteres"),
    note: optionalText.refine((v) => v === null || v.length <= 500, "Comentário: máximo de 500 caracteres"),
  })
  .refine((s) => s.graceMonths < s.termMonths, { message: "A carência deve ser menor que o prazo" });

export type ScenarioInput = z.infer<typeof scenarioSchema>;
export type Structure = Pick<
  ScenarioRow,
  "remuneration" | "termMonths" | "graceMonths" | "amortization" | "discount" | "fees" | "subordination" | "guarantees"
>;

/** Fields of the i-th scenario in a form are suffixed: `ticket_0`, `remuneration_0`, … */
export function scenarioFields(form: Record<string, string>, i: number): Record<string, string> | null {
  const keys = ["ticket", "remuneration", "termMonths", "graceMonths", "amortization", "discount", "fees", "subordination", "guarantees", "note"];
  const out: Record<string, string> = Object.fromEntries(keys.map((k) => [k, form[`${k}_${i}`] ?? ""]));
  // A slot is used once any of its main fields is filled.
  return (out.ticket ?? "").trim() || (out.remuneration ?? "").trim() ? out : null;
}

/** The scenarios a form proposes (1 to MAX_SCENARIOS), or the first error. */
export function parseScenarios(form: Record<string, string>): { scenarios: ScenarioInput[] } | { error: string } {
  const scenarios: ScenarioInput[] = [];
  for (let i = 0; i < MAX_SCENARIOS; i++) {
    const raw = scenarioFields(form, i);
    if (!raw) continue;
    const parsed = scenarioSchema.safeParse(raw);
    if (!parsed.success) return { error: `Cenário ${scenarioLetter(i)}: ${parsed.error.issues[0]?.message ?? "dados inválidos"}` };
    scenarios.push(parsed.data);
  }
  if (!scenarios.length) return { error: "Preencha pelo menos um cenário." };
  return { scenarios };
}

const AMORTIZATION_EN: Record<Amortization, string> = { bullet: "Bullet (at maturity)", sac: "Monthly, constant principal", price: "Monthly, level payments" };

/** "SAC mensal · 36 meses · carência de 6 meses" — written to the asset when a proposal closes. English for the public page. */
export function structureSummary(s: Pick<Structure, "termMonths" | "graceMonths" | "amortization">, lang: "pt" | "en" = "pt"): string {
  if (lang === "en") {
    const parts = [AMORTIZATION_EN[s.amortization], `${s.termMonths} months`];
    if (s.graceMonths > 0) parts.push(`${s.graceMonths}-month grace period`);
    return parts.join(" · ");
  }
  const parts = [amortizationLabel(s.amortization), `${s.termMonths} meses`];
  if (s.graceMonths > 0) parts.push(`carência de ${s.graceMonths} ${s.graceMonths === 1 ? "mês" : "meses"}`);
  return parts.join(" · ");
}

const norm = (v: string | null) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

const FIELDS = [
  "ticket",
  "remuneration",
  "termMonths",
  "graceMonths",
  "amortization",
  "discount",
  "fees",
  "subordination",
  "guarantees",
] as const;
export type ScenarioField = (typeof FIELDS)[number];
type Comparable = Structure & { ticket: string };

/** Which fields the institution (or Lastro) changed from the scenario it started from. */
export function changedFields(from: Comparable, to: Comparable): Set<ScenarioField> {
  const changed = new Set<ScenarioField>();
  for (const f of FIELDS) {
    const a = from[f];
    const b = to[f];
    const differs =
      f === "ticket" || f === "discount"
        ? parseDecimal(String(a), 2) !== parseDecimal(String(b), 2)
        : typeof a === "number"
          ? a !== b
          : norm(a as string | null) !== norm(b as string | null);
    if (differs) changed.add(f);
  }
  return changed;
}

/** Same series terms (the ticket may differ between institutions in the same series). */
export function sameStructure(a: Structure, b: Structure): boolean {
  const diff = changedFields({ ...a, ticket: "0" }, { ...b, ticket: "0" });
  return diff.size === 0;
}

/** What the institution pays for its ticket: face value × (1 − discount%), rounded half up to the centavo. */
export function subscriptionAmount(ticket: string, discount: string): string {
  const face = parseDecimal(ticket, 2);
  const pct = parseDecimal(discount, 2); // 2.50 → 250
  return formatDecimal(rescale(face * (10000n - pct), 6, 2), 2);
}

/** Agreed ticket (face value, R$, 2 dp) ÷ PU (8 dp) → token quantity (7 dp), rounded down so the ticket is never exceeded. */
export function ticketToQuantity(ticket: string, unitPrice: string): string {
  const pu = parseDecimal(unitPrice, 8);
  if (pu <= 0n) throw new Error("PU inválido");
  // ticket·10^2 / pu·10^8 = q, and q·10^7 = ticket2 · 10^13 / pu8
  return formatDecimal((parseDecimal(ticket, 2) * 10n ** 13n) / pu, 7);
}

/** "2026-11-04" + 36 months → "2029-11-04"; the day is clamped to the last day of the month. */
export function addMonths(iso: string, monthsToAdd: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + monthsToAdd;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
