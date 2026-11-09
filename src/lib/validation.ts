import { z } from "zod";
import { DecimalError, parseDecimal, STELLAR_MAX_STROOPS } from "@/lib/decimal";

const ASSET_CODE_RE = /^[A-Z0-9]{1,12}$/;

export function normalizeAssetCode(input: string): string {
  const code = input.trim().toUpperCase();
  if (!ASSET_CODE_RE.test(code)) {
    throw new Error("O código do token deve ter de 1 a 12 letras ou números, sem espaços.");
  }
  return code;
}

/** zod field: positive decimal string with at most `scale` places, normalized to "123.4500". */
export function decimalField(scale: number, opts: { label: string; allowZero?: boolean; max?: bigint }) {
  return z.string().transform((raw, ctx) => {
    try {
      const value = parseDecimal(raw, scale);
      if (value < 0n || (!opts.allowZero && value === 0n)) {
        ctx.addIssue({ code: "custom", message: `${opts.label}: informe um valor maior que zero` });
        return z.NEVER;
      }
      if (opts.max !== undefined && value > opts.max) {
        ctx.addIssue({ code: "custom", message: `${opts.label}: valor acima do máximo permitido` });
        return z.NEVER;
      }
      const s = value.toString().padStart(scale + 1, "0");
      return scale > 0 ? `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}` : s;
    } catch (err) {
      const message = err instanceof DecimalError ? err.message : "valor inválido";
      ctx.addIssue({ code: "custom", message: `${opts.label}: ${message}` });
      return z.NEVER;
    }
  });
}

export const tokenAmountField = (label: string) =>
  decimalField(7, { label, max: STELLAR_MAX_STROOPS });

export const optionalText = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

export const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Data inválida");

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos";
}
