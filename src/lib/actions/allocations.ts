"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { requireAdmin, requireClient } from "@/lib/auth";
import { db, isUniqueViolation } from "@/lib/db";
import { allocations, assets, proposals, users } from "@/lib/db/schema";
import { toStroops } from "@/lib/decimal";
import { issuerKeypair, lastroAsset, operatorKeypair, stellarNetwork } from "@/lib/stellar/config";
import { AccountNotFoundError, findTrustline, loadAccount } from "@/lib/stellar/horizon";
import { reconcileTx, submitTx } from "@/lib/stellar/submit";
import { buildTransferTx, txExpiresAt, txHashHex } from "@/lib/stellar/tx";
import { type ActionState, actionError } from "./shared";

/**
 * Starts the delivery of a closed proposal: the institution accepts (trustline), then Lastro transfers.
 * Every allocation comes from a deal closed with the borrower; there is no free-form transfer.
 */
export async function createAllocationFromProposal(proposalId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const [row] = await db()
    .select({ proposal: proposals, asset: assets, institution: users })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .innerJoin(users, eq(users.id, proposals.userId))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!row) return { error: "Proposta não encontrada." };
  const { proposal, asset, institution } = row;
  if (proposal.status !== "closed" || !proposal.committedQuantity) return { error: "Só propostas fechadas geram transferência." };
  if (asset.status !== "tokenized") return { error: "Tokenize o ativo primeiro." };
  if (institution.kycStatus !== "approved") return { error: "O KYB da instituição não está aprovado." };
  if (!institution.stellarAddress) return { error: "A instituição ainda não criou a carteira." };

  try {
    const [created] = await db()
      .insert(allocations)
      .values({
        assetId: asset.id,
        userId: institution.id,
        proposalId,
        amount: proposal.committedQuantity,
        createdBy: admin.id,
      })
      .returning({ id: allocations.id });
    await logActivity({
      actorId: admin.id,
      action: "allocation.created",
      assetId: asset.id,
      subjectUserId: institution.id,
      detail: { allocationId: created?.id, proposalId, amount: proposal.committedQuantity },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "Esta proposta já tem uma transferência em andamento." };
    return actionError(err);
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  return { ok: "Transferência criada. A instituição verá o pedido de aceite na carteira." };
}

/** Sends the tokens from the treasury to an institution that accepted. Authorizes the trustline if needed. */
export async function transferAllocation(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const [allocation] = await db()
    .update(allocations)
    .set({ status: "transferring", lastError: null })
    .where(and(eq(allocations.id, id), eq(allocations.status, "accepted")))
    .returning();
  if (!allocation) return { error: "Esta transferência não está pronta para envio." };

  const revert = async (message: string) => {
    await db()
      .update(allocations)
      .set({ status: "accepted", transferTxHash: null, transferTxExpiresAt: null, lastError: message })
      .where(eq(allocations.id, id));
    revalidatePath("/admin", "layout");
    return { error: message };
  };

  let submitted = false;
  try {
    const [asset] = await db().select().from(assets).where(eq(assets.id, allocation.assetId)).limit(1);
    const [client] = await db().select().from(users).where(eq(users.id, allocation.userId)).limit(1);
    if (!asset || asset.status !== "tokenized") return await revert("Ativo não tokenizado.");
    if (!client?.stellarAddress) return await revert("Instituição sem carteira.");
    if (client.kycStatus !== "approved") return await revert("KYB da instituição não está aprovado.");

    const stellarAsset = lastroAsset(asset.code);
    const issuer = issuerKeypair();
    const operator = operatorKeypair();

    let clientAccount: Awaited<ReturnType<typeof loadAccount>>;
    try {
      clientAccount = await loadAccount(client.stellarAddress);
    } catch (err) {
      if (err instanceof AccountNotFoundError) return await revert("A conta Stellar da instituição não existe.");
      throw err;
    }
    const clientLine = findTrustline(clientAccount, stellarAsset);
    if (!clientLine) return await revert("A instituição ainda não tem trustline para este token.");

    const operatorAccount = await loadAccount(operator.publicKey());
    const treasury = findTrustline(operatorAccount, stellarAsset);
    if (!treasury || toStroops(treasury.balance) < toStroops(allocation.amount)) {
      return await revert("Saldo insuficiente na tesouraria para esta quantidade.");
    }

    const authorize = !clientLine.is_authorized;
    const tx = buildTransferTx({
      source: operatorAccount,
      networkPassphrase: stellarNetwork().passphrase,
      issuer: issuer.publicKey(),
      client: client.stellarAddress,
      asset: stellarAsset,
      amount: allocation.amount,
      authorize,
    });
    // Only add the issuer signature when an issuer operation is present (extra signatures are rejected).
    if (authorize) tx.sign(operator, issuer);
    else tx.sign(operator);

    await db()
      .update(allocations)
      .set({ transferTxHash: txHashHex(tx), transferTxExpiresAt: txExpiresAt(tx) })
      .where(eq(allocations.id, id));
    submitted = true;
    const outcome = await submitTx(tx);

    if (outcome.status === "success") {
      await db()
        .update(allocations)
        .set({ status: "transferred", transferredAt: new Date() })
        .where(eq(allocations.id, id));
      await logActivity({
        actorId: admin.id,
        action: "allocation.transferred",
        assetId: asset.id,
        subjectUserId: client.id,
        txHash: outcome.hash,
        detail: { amount: allocation.amount },
      });
      revalidatePath("/admin", "layout");
      revalidatePath("/app", "layout");
      return { ok: "Tokens transferidos." };
    }
    if (outcome.status === "failed") return await revert(outcome.message);
    await db().update(allocations).set({ lastError: outcome.message }).where(eq(allocations.id, id));
    revalidatePath("/admin", "layout");
    return { error: "A rede não confirmou a tempo. Clique em “Verificar” em alguns segundos." };
  } catch (err) {
    if (!submitted) return await revert("Erro ao preparar a transferência. Tente novamente.");
    return actionError(err);
  }
}

export async function reconcileTransfer(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const [allocation] = await db().select().from(allocations).where(eq(allocations.id, id)).limit(1);
  if (!allocation || allocation.status !== "transferring" || !allocation.transferTxHash) {
    return { error: "Nada a verificar." };
  }
  try {
    const result = await reconcileTx(allocation.transferTxHash, allocation.transferTxExpiresAt);
    if (result === "pending") return { error: "Ainda processando. Tente de novo em alguns segundos." };
    if (result === "success") {
      await db()
        .update(allocations)
        .set({ status: "transferred", transferredAt: new Date(), lastError: null })
        .where(and(eq(allocations.id, id), eq(allocations.status, "transferring")));
      await logActivity({
        actorId: admin.id,
        action: "allocation.transferred",
        assetId: allocation.assetId,
        subjectUserId: allocation.userId,
        txHash: allocation.transferTxHash,
      });
    } else {
      await db()
        .update(allocations)
        .set({
          status: "accepted",
          transferTxHash: null,
          transferTxExpiresAt: null,
          lastError: "A transação anterior não entrou.",
        })
        .where(and(eq(allocations.id, id), eq(allocations.status, "transferring")));
    }
    revalidatePath("/admin", "layout");
    revalidatePath("/app", "layout");
    return result === "success" ? { ok: "Transferência confirmada." } : { error: "Não entrou. Você pode enviar novamente." };
  } catch (err) {
    return actionError(err);
  }
}

export async function cancelAllocation(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const updated = await db()
    .update(allocations)
    .set({ status: "cancelled" })
    .where(and(eq(allocations.id, id), inArray(allocations.status, ["pending", "accepted"])))
    .returning({ assetId: allocations.assetId, userId: allocations.userId });
  if (!updated[0]) return { error: "Não é possível cancelar neste status." };
  await logActivity({
    actorId: admin.id,
    action: "allocation.cancelled",
    assetId: updated[0].assetId,
    subjectUserId: updated[0].userId,
  });
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
  return { ok: "Cancelada." };
}

/** The institution declines a delivery of tokens. */
export async function declineAllocation(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requireClient();
  const updated = await db()
    .update(allocations)
    .set({ status: "declined" })
    .where(and(eq(allocations.id, id), eq(allocations.userId, user.id), eq(allocations.status, "pending")))
    .returning({ assetId: allocations.assetId });
  if (!updated[0]) return { error: "Não é possível recusar neste status." };
  await logActivity({ actorId: user.id, action: "allocation.declined", assetId: updated[0].assetId, subjectUserId: user.id });
  revalidatePath("/app", "layout");
  revalidatePath("/admin", "layout");
  return { ok: "Recusado." };
}
