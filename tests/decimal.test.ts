import { describe, expect, it } from "vitest";
import { DecimalError, formatDecimal, mulScaled, parseDecimal, rescale, toStroops } from "@/lib/decimal";
import { positionValue, plainDecimal } from "@/lib/format";
import { computePaymentItems, sumAmounts } from "@/lib/payments";
import { normalizeAssetCode, tokenAmountField } from "@/lib/validation";

describe("parseDecimal", () => {
  it("accepts dot or comma as the decimal separator", () => {
    expect(parseDecimal("1234.56", 2)).toBe(123456n);
    expect(parseDecimal("1234,56", 2)).toBe(123456n);
    expect(parseDecimal("7", 7)).toBe(70_000_000n);
  });

  it("rejects thousands separators, signs, and excess precision instead of guessing", () => {
    expect(() => parseDecimal("1.234,56", 2)).toThrow(DecimalError);
    expect(() => parseDecimal("-1", 2)).toThrow(DecimalError);
    expect(() => parseDecimal("1e3", 2)).toThrow(DecimalError);
    expect(() => parseDecimal("0.12345678", 7)).toThrow(/7 casas/);
  });
});

describe("rescale / mulScaled", () => {
  it("rounds half away from zero when dropping precision", () => {
    expect(rescale(12345n, 3, 2)).toBe(1235n); // 12.345 → 12.35
    expect(rescale(12344n, 3, 2)).toBe(1234n);
    expect(rescale(-12345n, 3, 2)).toBe(-1235n);
  });

  it("multiplies without float error (0.1 × 0.2 style traps)", () => {
    // 3 tokens × R$ 0.10000001 = R$ 0.30000003 → R$ 0.30
    expect(formatDecimal(mulScaled(toStroops("3"), 7, parseDecimal("0.10000001", 8), 8, 2), 2)).toBe("0.30");
    expect(positionValue("123456789.1234567", "1000.12345678")).toBe("123472030701.11");
  });
});

describe("computePaymentItems", () => {
  const holders = [
    { address: "TREASURY", balance: "900.0000000" },
    { address: "A", balance: "100.0000000" },
    { address: "B", balance: "0.0000001" },
    { address: "C", balance: "0.0000000" },
  ];

  it("excludes the treasury and empty trustlines and rounds each holder to centavos", () => {
    const items = computePaymentItems(holders, "12.34567891", ["TREASURY"]);
    expect(items).toEqual([
      { address: "A", quantity: "100.0000000", amount: "1234.57" },
      { address: "B", quantity: "0.0000001", amount: "0.00" },
    ]);
    expect(sumAmounts(items.map((i) => i.amount), 2)).toBe("1234.57");
  });
});

describe("validation", () => {
  it("normalizes asset codes to Stellar's alphanumeric 1–12 rule", () => {
    expect(normalizeAssetCode(" lcr001 ")).toBe("LCR001");
    expect(() => normalizeAssetCode("LCR-001")).toThrow();
    expect(() => normalizeAssetCode("ABCDEFGHIJKLM")).toThrow();
  });

  it("caps token amounts at Stellar's int64 limit", () => {
    expect(tokenAmountField("Q").safeParse("922337203685.4775807").success).toBe(true);
    expect(tokenAmountField("Q").safeParse("922337203685.4775808").success).toBe(false);
    expect(tokenAmountField("Q").safeParse("0").success).toBe(false);
    expect(tokenAmountField("Q").parse("10,5")).toBe("10.5000000");
  });

  it("plainDecimal trims trailing zeros exactly", () => {
    expect(plainDecimal("15000.0000000")).toBe("15000");
    expect(plainDecimal("12.5000")).toBe("12.5");
    expect(plainDecimal("100")).toBe("100");
  });
});
