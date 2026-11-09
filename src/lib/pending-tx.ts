import { Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { type PendingTxKind, pendingTxs } from "@/lib/db/schema";
import { HttpError } from "@/lib/http";
import { stellarNetwork } from "@/lib/stellar/config";
import { isSignedBy, txExpiresAt, txHashHex } from "@/lib/stellar/tx";

/** Records a server-built tx the client must sign, and returns it for the browser. */
export async function issuePendingTx(opts: {
  userId: string;
  kind: PendingTxKind;
  refId?: string;
  signer: string;
  tx: Transaction;
}) {
  await db()
    .insert(pendingTxs)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      refId: opts.refId ?? null,
      signer: opts.signer,
      txHash: txHashHex(opts.tx),
      expiresAt: txExpiresAt(opts.tx),
    });
  return { xdr: opts.tx.toXDR(), networkPassphrase: stellarNetwork().passphrase };
}

/**
 * Accepts a client-signed envelope only if it is byte-for-byte the tx we built
 * (same hash), unexpired, unused, and signed by the expected client key.
 */
export async function consumeSignedTx(opts: {
  userId: string;
  kind: PendingTxKind;
  refId?: string;
  signedXdr: unknown;
}): Promise<Transaction> {
  if (typeof opts.signedXdr !== "string" || opts.signedXdr.length > 20_000) {
    throw new HttpError(400, "Transação ausente.");
  }
  let tx: Transaction;
  try {
    const parsed = TransactionBuilder.fromXDR(opts.signedXdr, stellarNetwork().passphrase);
    if (!(parsed instanceof Transaction)) throw new Error("fee bump");
    tx = parsed;
  } catch {
    throw new HttpError(400, "Transação inválida.");
  }

  const hash = txHashHex(tx);
  const conditions = [
    eq(pendingTxs.txHash, hash),
    eq(pendingTxs.userId, opts.userId),
    eq(pendingTxs.kind, opts.kind),
    isNull(pendingTxs.consumedAt),
    gt(pendingTxs.expiresAt, new Date()),
  ];
  if (opts.refId) conditions.push(eq(pendingTxs.refId, opts.refId));

  const [row] = await db()
    .select()
    .from(pendingTxs)
    .where(and(...conditions))
    .limit(1);
  if (!row) throw new HttpError(400, "Transação expirada ou desconhecida. Tente novamente.");
  if (!isSignedBy(tx, row.signer)) throw new HttpError(400, "A transação não foi assinada pela sua carteira.");

  const consumed = await db()
    .update(pendingTxs)
    .set({ consumedAt: new Date() })
    .where(and(eq(pendingTxs.id, row.id), isNull(pendingTxs.consumedAt)))
    .returning({ id: pendingTxs.id });
  if (!consumed.length) throw new HttpError(409, "Esta transação já foi enviada.");
  return tx;
}
