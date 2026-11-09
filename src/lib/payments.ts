import { formatDecimal, mulScaled, parseDecimal, toStroops } from "@/lib/decimal";

export type PaymentItemDraft = { address: string; quantity: string; amount: string };

/**
 * Per-holder amounts for a payment event: on-chain balance (7 dp) × R$ per token (8 dp),
 * rounded half-up to centavos. Treasury/issuer and zero balances are excluded.
 */
export function computePaymentItems(
  holders: { address: string; balance: string }[],
  amountPerToken: string,
  exclude: string[],
): PaymentItemDraft[] {
  const perToken = parseDecimal(amountPerToken, 8);
  const skip = new Set(exclude);
  const items: PaymentItemDraft[] = [];
  for (const holder of holders) {
    if (skip.has(holder.address)) continue;
    const quantity = toStroops(holder.balance);
    if (quantity === 0n) continue;
    const cents = mulScaled(quantity, 7, perToken, 8, 2);
    items.push({ address: holder.address, quantity: formatDecimal(quantity, 7), amount: formatDecimal(cents, 2) });
  }
  return items;
}

export function sumAmounts(values: string[], scale: number): string {
  return formatDecimal(
    values.reduce((acc, v) => acc + parseDecimal(v, scale), 0n),
    scale,
  );
}
