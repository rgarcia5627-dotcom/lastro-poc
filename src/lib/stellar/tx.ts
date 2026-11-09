/**
 * Pure transaction builders for every on-chain action Lastro performs.
 * Only Stellar classic operations — no smart contracts.
 *
 * Accounts:
 *   issuer   – issues the tokens; flags AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED;
 *              also signs the on-chain registry of every off-chain payment
 *   operator – treasury (holds the issued supply), pays fees, sponsors client reserves
 *   client   – investor account whose key is derived from their passkey (PRF)
 */
import {
  type Account,
  type Asset,
  AuthClawbackEnabledFlag,
  type AuthFlag,
  AuthRequiredFlag,
  AuthRevocableFlag,
  Keypair,
  Memo,
  Operation,
  type Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

/** Per-operation fee in stroops. Generous for testnet/mainnet surge without fee-bumps. */
export const FEE_PER_OP = "10000";
/** Validity window: after this the tx can never land, which makes outcomes reconcilable. */
export const TX_TIMEOUT_SECONDS = 120;

type Common = { source: Account; networkPassphrase: string };

function builder({ source, networkPassphrase }: Common) {
  return new TransactionBuilder(source, { fee: FEE_PER_OP, networkPassphrase });
}

export const ISSUER_FLAGS = (AuthRequiredFlag | AuthRevocableFlag | AuthClawbackEnabledFlag) as unknown as AuthFlag;

/** One-time issuer configuration. Must run before any trustline exists (clawback is set per trustline at creation). */
export function buildIssuerSetupTx(opts: Common & { homeDomain?: string }): Transaction {
  return builder(opts)
    .addOperation(
      Operation.setOptions({ setFlags: ISSUER_FLAGS, ...(opts.homeDomain ? { homeDomain: opts.homeDomain } : {}) }),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Creates the client's account with 0 XLM; the operator sponsors its reserves. Signers: operator + client. */
export function buildCreateWalletTx(opts: Common & { client: string }): Transaction {
  return builder(opts)
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: opts.client }))
    .addOperation(Operation.createAccount({ destination: opts.client, startingBalance: "0" }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: opts.client }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** The client "accepts" a token by opening a trustline; operator sponsors the reserve. Signers: operator + client. */
export function buildTrustlineTx(opts: Common & { client: string; asset: Asset }): Transaction {
  return builder(opts)
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: opts.client }))
    .addOperation(Operation.changeTrust({ asset: opts.asset, source: opts.client }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: opts.client }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/**
 * Tokenization: issues the whole supply into the operator treasury.
 * Source = operator. Signers: operator + issuer.
 */
export function buildTokenizeTx(
  opts: Common & { issuer: string; asset: Asset; amount: string; operatorHasTrustline: boolean },
): Transaction {
  const operator = opts.source.accountId();
  const b = builder(opts);
  if (!opts.operatorHasTrustline) b.addOperation(Operation.changeTrust({ asset: opts.asset }));
  return b
    .addOperation(
      Operation.setTrustLineFlags({
        trustor: operator,
        asset: opts.asset,
        flags: { authorized: true },
        source: opts.issuer,
      }),
    )
    .addOperation(
      Operation.payment({ destination: operator, asset: opts.asset, amount: opts.amount, source: opts.issuer }),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/**
 * Transfer from treasury to a client who already accepted (has a trustline).
 * If the trustline is not yet authorized, the issuer authorizes it in the same tx.
 * Signers: operator (+ issuer when `authorize`).
 */
export function buildTransferTx(
  opts: Common & { issuer: string; client: string; asset: Asset; amount: string; authorize: boolean },
): Transaction {
  const b = builder(opts);
  if (opts.authorize) {
    b.addOperation(
      Operation.setTrustLineFlags({
        trustor: opts.client,
        asset: opts.asset,
        flags: { authorized: true },
        source: opts.issuer,
      }),
    );
  }
  return b
    .addOperation(Operation.payment({ destination: opts.client, asset: opts.asset, amount: opts.amount }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Freeze / unfreeze a holder. Signers: operator + issuer. */
export function buildSetAuthorizationTx(
  opts: Common & { issuer: string; holder: string; asset: Asset; authorized: boolean },
): Transaction {
  return builder(opts)
    .addOperation(
      Operation.setTrustLineFlags({
        trustor: opts.holder,
        asset: opts.asset,
        flags: { authorized: opts.authorized },
        source: opts.issuer,
      }),
    )
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Clawback (e.g. lost passkey, court order); the clawed amount is burned. Signers: operator + issuer. */
export function buildClawbackTx(
  opts: Common & { issuer: string; holder: string; asset: Asset; amount: string },
): Transaction {
  return builder(opts)
    .addOperation(Operation.clawback({ asset: opts.asset, from: opts.holder, amount: opts.amount, source: opts.issuer }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

/** Data entry on the issuer account that holds the latest payment-record hash of an asset. */
export const paymentDataKey = (assetCode: string) => `lastro:pay:${assetCode}`;

/**
 * Registers an off-chain payment on-chain. No value moves: the memo is the SHA-256 of the
 * payment record, and the issuer writes the same hash to its `lastro:pay:<CODE>` data entry
 * (the first one costs the issuer a 0.5 XLM reserve per asset).
 * Source = operator (pays the fee). Signers: operator + issuer.
 */
export function buildPaymentRecordTx(
  opts: Common & { issuer: string; assetCode: string; recordHash: Buffer },
): Transaction {
  if (opts.recordHash.length !== 32) throw new Error("O hash do registro deve ter 32 bytes.");
  return builder(opts)
    .addOperation(
      Operation.manageData({ name: paymentDataKey(opts.assetCode), value: opts.recordHash, source: opts.issuer }),
    )
    .addMemo(Memo.hash(opts.recordHash.toString("hex")))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
}

export function txHashHex(tx: Transaction): string {
  return tx.hash().toString("hex");
}

export function txExpiresAt(tx: Transaction): Date {
  const max = Number(tx.timeBounds?.maxTime ?? 0);
  return new Date(max * 1000);
}

/** True if `tx` carries a valid signature from `address` over its hash. */
export function isSignedBy(tx: Transaction, address: string): boolean {
  const kp = Keypair.fromPublicKey(address);
  const hash = tx.hash();
  const hint = kp.signatureHint();
  return tx.signatures.some((s) => s.hint().equals(hint) && kp.verify(hash, s.signature()));
}
