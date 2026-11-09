import { createHash } from "node:crypto";
import type { PaymentKind } from "@/lib/db/schema";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import { type PaymentItemDraft, sumAmounts } from "@/lib/payments";

/**
 * The record of a payment event. The cash moves off-chain (in BRL, by the paying agent);
 * this record says what was paid, to which Stellar accounts, from which on-chain snapshot,
 * and which off-chain settlement it refers to. Its SHA-256 is registered on Stellar
 * (transaction memo + a data entry on the issuer account), so anyone holding the record
 * can check it against the ledger. The hash is taken over exactly the string stored.
 */
export const PAYMENT_RECORD_SCHEMA = "lastro.payment-record.v1";

export type PaymentRecord = {
  schema: typeof PAYMENT_RECORD_SCHEMA;
  network: string;
  asset: { code: string; issuer: string };
  payment: { id: string; kind: PaymentKind; dueDate: string; amountPerToken: string };
  settlement: { date: string; reference: string };
  snapshot: { takenAt: string; holders: PaymentItemDraft[] };
  total: string;
};

export function buildPaymentRecord(input: {
  network: string;
  asset: { code: string; issuer: string };
  payment: { id: string; kind: PaymentKind; dueDate: string; amountPerToken: string };
  settlement: { date: string; reference: string };
  takenAt: Date;
  items: PaymentItemDraft[];
}): PaymentRecord {
  const holders = [...input.items]
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0))
    .map((i) => ({ address: i.address, quantity: i.quantity, amount: i.amount }));
  return {
    schema: PAYMENT_RECORD_SCHEMA,
    network: input.network,
    asset: { code: input.asset.code, issuer: input.asset.issuer },
    payment: {
      id: input.payment.id,
      kind: input.payment.kind,
      dueDate: input.payment.dueDate,
      amountPerToken: formatDecimal(parseDecimal(input.payment.amountPerToken, 8), 8),
    },
    settlement: { date: input.settlement.date, reference: input.settlement.reference },
    snapshot: { takenAt: input.takenAt.toISOString(), holders },
    total: sumAmounts(
      holders.map((h) => h.amount),
      2,
    ),
  };
}

/** Canonical JSON: object keys sorted at every level, no whitespace. */
export function serializePaymentRecord(record: PaymentRecord): string {
  return JSON.stringify(sortKeys(record));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** 32-byte SHA-256 of the stored record string — the value registered on Stellar. */
export function paymentRecordHash(serialized: string): Buffer {
  return createHash("sha256").update(serialized, "utf8").digest();
}
