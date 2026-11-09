import { hkdfSync } from "node:crypto";
import { Account, Asset, Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { describeResultCodes } from "@/lib/stellar/submit";
import {
  buildCreateWalletTx,
  buildTokenizeTx,
  buildTransferTx,
  buildTrustlineTx,
  isSignedBy,
  txExpiresAt,
} from "@/lib/stellar/tx";
import { deriveWalletSeed } from "@/lib/wallet-derivation";

const network = Networks.TESTNET;
const operator = Keypair.random();
const issuer = Keypair.random();
const client = Keypair.random();
const asset = new Asset("LCR001", issuer.publicKey());
const source = () => new Account(operator.publicKey(), "100");

describe("passkey wallet derivation", () => {
  it("matches an independent HKDF implementation and is deterministic", async () => {
    const prf = new Uint8Array(32).map((_, i) => i).buffer;
    const seed = await deriveWalletSeed(prf);
    const expected = new Uint8Array(
      hkdfSync("sha256", new Uint8Array(prf), "lastro:hkdf:v1", "stellar-ed25519-seed", 32),
    );
    expect(seed).toEqual(expected);
    expect(await deriveWalletSeed(prf)).toEqual(seed);
  });

  it("gives different passkeys different accounts", async () => {
    const a = await deriveWalletSeed(new Uint8Array(32).fill(1).buffer);
    const b = await deriveWalletSeed(new Uint8Array(32).fill(2).buffer);
    expect(Keypair.fromRawEd25519Seed(Buffer.from(a)).publicKey()).not.toBe(
      Keypair.fromRawEd25519Seed(Buffer.from(b)).publicKey(),
    );
  });

  it("refuses PRF outputs of the wrong size", async () => {
    await expect(deriveWalletSeed(new Uint8Array(16).buffer)).rejects.toThrow(/32 bytes/);
  });
});

describe("transaction builders", () => {
  it("creates the client account with 0 XLM, sponsored by the operator, ended by the client", () => {
    const tx = buildCreateWalletTx({ source: source(), networkPassphrase: network, client: client.publicKey() });
    expect(tx.source).toBe(operator.publicKey());
    expect(tx.operations.map((o) => o.type)).toEqual([
      "beginSponsoringFutureReserves",
      "createAccount",
      "endSponsoringFutureReserves",
    ]);
    const [begin, create, end] = tx.operations;
    expect(begin?.type === "beginSponsoringFutureReserves" && begin.sponsoredId).toBe(client.publicKey());
    expect(create?.type === "createAccount" && create.startingBalance).toBe("0.0000000");
    expect(end?.source).toBe(client.publicKey());
    expect(txExpiresAt(tx).getTime()).toBeGreaterThan(Date.now());
  });

  it("opens the trustline from the client account inside a sponsorship", () => {
    const tx = buildTrustlineTx({ source: source(), networkPassphrase: network, client: client.publicKey(), asset });
    const change = tx.operations[1];
    expect(change?.type).toBe("changeTrust");
    expect(change?.source).toBe(client.publicKey());
  });

  it("tokenizes into the treasury: trustline, issuer authorization, issuer payment", () => {
    const tx = buildTokenizeTx({
      source: source(),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      asset,
      amount: "15000",
      operatorHasTrustline: false,
    });
    expect(tx.operations.map((o) => [o.type, o.source ?? "tx-source"])).toEqual([
      ["changeTrust", "tx-source"],
      ["setTrustLineFlags", issuer.publicKey()],
      ["payment", issuer.publicKey()],
    ]);
  });

  it("only includes the issuer authorization when the trustline is not yet authorized", () => {
    const base = { source: source(), networkPassphrase: network, issuer: issuer.publicKey(), client: client.publicKey(), asset, amount: "1" };
    expect(buildTransferTx({ ...base, authorize: true }).operations.map((o) => o.type)).toEqual(["setTrustLineFlags", "payment"]);
    expect(buildTransferTx({ ...base, authorize: false }).operations.map((o) => o.type)).toEqual(["payment"]);
  });
});

describe("isSignedBy — the guard before the operator co-signs", () => {
  it("accepts the expected signer and rejects anyone else", () => {
    const tx = buildTrustlineTx({ source: source(), networkPassphrase: network, client: client.publicKey(), asset });
    expect(isSignedBy(tx, client.publicKey())).toBe(false);
    tx.sign(Keypair.random());
    expect(isSignedBy(tx, client.publicKey())).toBe(false);
    tx.sign(client);
    expect(isSignedBy(tx, client.publicKey())).toBe(true);
  });

  it("a client-modified envelope has a different hash, so it never matches the issued pending tx", () => {
    const tx = buildTrustlineTx({ source: source(), networkPassphrase: network, client: client.publicKey(), asset });
    const original = tx.hash().toString("hex");
    const tampered = TransactionBuilder.cloneFrom(tx, { fee: "999999", networkPassphrase: network }).build();
    expect(tampered.hash().toString("hex")).not.toBe(original);
    // Signatures do not change the hash: the signed envelope still matches.
    tx.sign(client);
    expect(TransactionBuilder.fromXDR(tx.toXDR(), network).hash().toString("hex")).toBe(original);
  });
});

describe("describeResultCodes", () => {
  it("explains the failure in Portuguese, preferring the operation code", () => {
    expect(describeResultCodes({ transaction: "tx_failed", operations: ["op_success", "op_no_trust"] })).toMatch(/trustline/);
    expect(describeResultCodes({ transaction: "tx_weird" })).toMatch(/tx_weird/);
  });
});
