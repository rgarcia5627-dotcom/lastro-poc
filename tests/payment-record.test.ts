import { createHash } from "node:crypto";
import { Account, Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { buildPaymentRecord, paymentRecordHash, serializePaymentRecord } from "@/lib/payment-record";
import { buildPaymentRecordTx, paymentDataKey } from "@/lib/stellar/tx";

const issuer = Keypair.random().publicKey();
const operator = Keypair.random().publicKey();
const a = Keypair.random().publicKey();
const b = Keypair.random().publicKey();

const input = (items = [
  { address: a, quantity: "250.0000000", amount: "3086.40" },
  { address: b, quantity: "10.0000000", amount: "123.46" },
]) => ({
  network: "testnet",
  asset: { code: "LCR001", issuer },
  payment: { id: "8f1c1a52-1b5e-4c55-9a43-2b1f3c6d7e80", kind: "juros" as const, dueDate: "2026-12-04", amountPerToken: "12.3456" },
  settlement: { date: "2026-12-04", reference: "TED 000123" },
  takenAt: new Date("2026-12-04T15:00:00.000Z"),
  items,
});

describe("payment record", () => {
  it("is canonical: same content in any holder order gives the same string and hash", () => {
    const one = serializePaymentRecord(buildPaymentRecord(input()));
    const two = serializePaymentRecord(buildPaymentRecord(input([...input().items].reverse())));
    expect(two).toBe(one);
    expect(paymentRecordHash(two).equals(paymentRecordHash(one))).toBe(true);
    expect(one).not.toMatch(/\s"/); // no whitespace between tokens
    expect(Object.keys(JSON.parse(one))).toEqual([...Object.keys(JSON.parse(one))].sort());
  });

  it("totals the holders and normalizes the per-token amount to 8 dp", () => {
    const record = buildPaymentRecord(input());
    expect(record.total).toBe("3209.86");
    expect(record.payment.amountPerToken).toBe("12.34560000");
    expect(record.snapshot.holders.map((h) => h.address)).toEqual([a, b].sort());
  });

  it("any change to an amount or to the settlement reference changes the hash", () => {
    const base = paymentRecordHash(serializePaymentRecord(buildPaymentRecord(input()))).toString("hex");
    const otherAmount = input();
    otherAmount.items[0] = { address: a, quantity: "250.0000000", amount: "3086.41" };
    const otherRef = { ...input(), settlement: { date: "2026-12-04", reference: "TED 000124" } };
    for (const changed of [otherAmount, otherRef]) {
      expect(paymentRecordHash(serializePaymentRecord(buildPaymentRecord(changed))).toString("hex")).not.toBe(base);
    }
  });

  it("hash is the plain SHA-256 of the stored string, so anyone can recompute it", () => {
    const serialized = serializePaymentRecord(buildPaymentRecord(input()));
    expect(paymentRecordHash(serialized).toString("hex")).toBe(createHash("sha256").update(serialized).digest("hex"));
  });
});

describe("buildPaymentRecordTx — on-chain registry of an off-chain payment", () => {
  const hash = paymentRecordHash(serializePaymentRecord(buildPaymentRecord(input())));
  const tx = buildPaymentRecordTx({
    source: new Account(operator, "100"),
    networkPassphrase: Networks.TESTNET,
    issuer,
    assetCode: "LCR001",
    recordHash: hash,
  });

  it("moves no value: one manageData op on the issuer account, fee paid by the operator", () => {
    expect(tx.source).toBe(operator);
    expect(tx.operations).toHaveLength(1);
    const [op] = tx.operations;
    expect(op?.type).toBe("manageData");
    expect(op?.source).toBe(issuer);
    if (op?.type !== "manageData") throw new Error("unreachable");
    expect(op.name).toBe(paymentDataKey("LCR001"));
    expect(Buffer.from(op.value ?? []).equals(hash)).toBe(true);
  });

  it("carries the record hash as the memo", () => {
    expect(tx.memo.type).toBe("hash");
    expect(Buffer.from(tx.memo.value as Buffer).equals(hash)).toBe(true);
  });

  it("refuses anything that is not a 32-byte hash", () => {
    expect(() =>
      buildPaymentRecordTx({
        source: new Account(operator, "100"),
        networkPassphrase: Networks.TESTNET,
        issuer,
        assetCode: "LCR001",
        recordHash: Buffer.alloc(16),
      }),
    ).toThrow(/32 bytes/);
  });
});
