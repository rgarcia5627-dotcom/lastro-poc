"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, paymentItems, payments, users } from "@/lib/db/schema";
import { buildPaymentRecord, paymentRecordHash, serializePaymentRecord } from "@/lib/payment-record";
import { computePaymentItems, sumAmounts } from "@/lib/payments";
import { issuerKeypair, lastroAsset, operatorKeypair, stellarNetwork } from "@/lib/stellar/config";
import { listHolders, loadAccount } from "@/lib/stellar/horizon";
import { reconcileTx, submitTx } from "@/lib/stellar/submit";
import { buildPaymentRecordTx, txExpiresAt, txHashHex } from "@/lib/stellar/tx";
import { decimalField, firstIssue, optionalText } from "@/lib/validation";
import { type ActionState, actionError, formObject } from "./shared";

/*
 * Payment lifecycle. The cash never moves on-chain:
 *   scheduled ──close list──▶ snapshotted ──(paying agent pays in BRL)── register ──▶ registering ──▶ paid
 * "Close list" fixes who is entitled to what from on-chain balances (the record date).
 * "Register" writes the payment record with the off-chain settlement reference and anchors
 * its SHA-256 on Stellar.
 */

const isoDate = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message);

const paymentSchema = z.object({
  dueDate: isoDate("Informe a data do pagamento"),
  kind: z.enum(["juros", "amortizacao", "juros_amortizacao"], { message: "Escolha o tipo" }),
  amountPerToken: decimalField(8, { label: "Valor por token" }),
  notes: optionalText,
});

function revalidate() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}

export async function schedulePayment(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = paymentSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const [asset] = await db().select({ id: assets.id }).from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) return { error: "Ativo não encontrado." };
  await db().insert(payments).values({ assetId, ...parsed.data });
  await logActivity({ actorId: admin.id, action: "payment.scheduled", assetId, detail: parsed.data });
  revalidate();
  return { ok: "Pagamento agendado." };
}

/** Record date: snapshots every holder's on-chain balance and fixes each holder's amount. */
export async function closePaymentList(paymentId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const [row] = await db()
    .select({ payment: payments, asset: assets })
    .from(payments)
    .innerJoin(assets, eq(assets.id, payments.assetId))
    .where(eq(payments.id, paymentId))
    .limit(1);
  if (!row) return { error: "Pagamento não encontrado." };
  if (row.payment.status !== "scheduled") return { error: "A lista deste pagamento já foi fechada." };
  if (row.asset.status !== "tokenized") return { error: "O ativo ainda não foi tokenizado." };

  try {
    const holders = await listHolders(lastroAsset(row.asset.code));
    const items = computePaymentItems(holders, row.payment.amountPerToken, [
      operatorKeypair().publicKey(),
      issuerKeypair().publicKey(),
    ]);
    if (!items.length) return { error: "Nenhum detentor com saldo para este ativo." };

    const owners = await db()
      .select({ id: users.id, address: users.stellarAddress })
      .from(users)
      .where(inArray(users.stellarAddress, items.map((i) => i.address)));
    const byAddress = new Map(owners.map((o) => [o.address, o.id]));

    const done = await db().transaction(async (tx) => {
      const updated = await tx
        .update(payments)
        .set({ status: "snapshotted", snapshotAt: new Date() })
        .where(and(eq(payments.id, paymentId), eq(payments.status, "scheduled")))
        .returning({ id: payments.id });
      if (!updated.length) return false;
      await tx.insert(paymentItems).values(
        items.map((i) => ({
          paymentId,
          userId: byAddress.get(i.address) ?? null,
          stellarAddress: i.address,
          quantity: i.quantity,
          amount: i.amount,
        })),
      );
      return true;
    });
    if (!done) return { error: "A lista deste pagamento já foi fechada." };

    const total = sumAmounts(items.map((i) => i.amount), 2);
    await logActivity({
      actorId: admin.id,
      action: "payment.snapshot",
      assetId: row.asset.id,
      detail: { paymentId, holders: items.length, total },
    });
    revalidate();
    return { ok: `Lista fechada: ${items.length} detentor(es).` };
  } catch (err) {
    return actionError(err);
  }
}

const registerSchema = z.object({
  paymentId: z.string().uuid("Escolha o pagamento"),
  settledOn: isoDate("Informe a data da liquidação"),
  settlementRef: z
    .string()
    .trim()
    .min(3, "Informe a referência da liquidação (ex.: nº da TED)")
    .max(120, "Referência muito longa (máx. 120 caracteres)"),
});

/** Back to "snapshotted" when the registry transaction definitively did not land. */
async function revertRegistration(paymentId: string) {
  await db()
    .update(payments)
    .set({
      status: "snapshotted",
      settledOn: null,
      settlementRef: null,
      record: null,
      recordHash: null,
      registryTxHash: null,
      registryTxExpiresAt: null,
    })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "registering")));
}

async function confirmRegistration(paymentId: string, actorId: string) {
  const [row] = await db()
    .update(payments)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(payments.id, paymentId), eq(payments.status, "registering")))
    .returning();
  if (!row) return;
  await logActivity({
    actorId,
    action: "payment.paid",
    assetId: row.assetId,
    txHash: row.registryTxHash,
    detail: { paymentId, recordHash: row.recordHash, settlementRef: row.settlementRef },
  });
}

/**
 * Registers on Stellar a payment the paying agent settled off-chain, in BRL.
 * Builds the payment record from the closed holder list + the settlement reference and
 * anchors its SHA-256 on-chain (tx memo + the issuer's `lastro:pay:<CODE>` data entry).
 */
export async function registerPayment(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = registerSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const { paymentId, settledOn, settlementRef } = parsed.data;

  const [row] = await db()
    .select({ payment: payments, asset: assets })
    .from(payments)
    .innerJoin(assets, eq(assets.id, payments.assetId))
    .where(and(eq(payments.id, paymentId), eq(payments.assetId, assetId)))
    .limit(1);
  if (!row) return { error: "Pagamento não encontrado." };
  if (row.payment.status !== "snapshotted" || !row.payment.snapshotAt) {
    return { error: "Feche a lista de detentores antes de registrar a liquidação." };
  }

  try {
    const issuer = issuerKeypair();
    const operator = operatorKeypair();
    const items = await db()
      .select({ address: paymentItems.stellarAddress, quantity: paymentItems.quantity, amount: paymentItems.amount })
      .from(paymentItems)
      .where(eq(paymentItems.paymentId, paymentId))
      .orderBy(asc(paymentItems.stellarAddress));

    const serialized = serializePaymentRecord(
      buildPaymentRecord({
        network: stellarNetwork().name,
        asset: { code: row.asset.code, issuer: issuer.publicKey() },
        payment: {
          id: row.payment.id,
          kind: row.payment.kind,
          dueDate: row.payment.dueDate,
          amountPerToken: row.payment.amountPerToken,
        },
        settlement: { date: settledOn, reference: settlementRef },
        takenAt: row.payment.snapshotAt,
        items,
      }),
    );
    const hash = paymentRecordHash(serialized);
    const tx = buildPaymentRecordTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: stellarNetwork().passphrase,
      issuer: issuer.publicKey(),
      assetCode: row.asset.code,
      recordHash: hash,
    });
    tx.sign(operator, issuer);

    const [claimed] = await db()
      .update(payments)
      .set({
        status: "registering",
        settledOn,
        settlementRef,
        record: serialized,
        recordHash: hash.toString("hex"),
        registryTxHash: txHashHex(tx),
        registryTxExpiresAt: txExpiresAt(tx),
      })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "snapshotted")))
      .returning({ id: payments.id });
    if (!claimed) return { error: "Este pagamento já foi registrado." };

    const outcome = await submitTx(tx);
    if (outcome.status === "success") {
      await confirmRegistration(paymentId, admin.id);
      revalidate();
      return { ok: `Pagamento registrado na Stellar para ${items.length} detentor(es).` };
    }
    if (outcome.status === "failed") {
      await revertRegistration(paymentId);
      revalidate();
      return { error: outcome.message };
    }
    revalidate();
    return { error: "A rede não confirmou a tempo. Clique em “Verificar registro” em alguns segundos." };
  } catch (err) {
    return actionError(err);
  }
}

export async function reconcilePayment(paymentId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const [payment] = await db().select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!payment || payment.status !== "registering" || !payment.registryTxHash) return { error: "Nada a verificar." };
  try {
    const result = await reconcileTx(payment.registryTxHash, payment.registryTxExpiresAt);
    if (result === "pending") return { error: "Ainda processando. Tente de novo em alguns segundos." };
    if (result === "success") await confirmRegistration(paymentId, admin.id);
    else await revertRegistration(paymentId);
    revalidate();
    return result === "success"
      ? { ok: "Registro confirmado na Stellar." }
      : { error: "A transação não entrou. Registre a liquidação novamente." };
  } catch (err) {
    return actionError(err);
  }
}
