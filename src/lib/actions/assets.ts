"use server";

import { StrKey } from "@stellar/stellar-sdk";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { requireAdmin } from "@/lib/auth";
import { db, isUniqueViolation } from "@/lib/db";
import { assetPrices, assets, users } from "@/lib/db/schema";
import { toStroops } from "@/lib/decimal";
import {
  issuerKeypair,
  lastroAsset,
  operatorKeypair,
  stellarNetwork,
} from "@/lib/stellar/config";
import { findTrustline, lastroHealth, loadAccount } from "@/lib/stellar/horizon";
import { reconcileTx, submitTx } from "@/lib/stellar/submit";
import {
  buildClawbackTx,
  buildSetAuthorizationTx,
  buildTokenizeTx,
  txExpiresAt,
  txHashHex,
} from "@/lib/stellar/tx";
import {
  decimalField,
  firstIssue,
  normalizeAssetCode,
  optionalDate,
  optionalText,
  tokenAmountField,
} from "@/lib/validation";
import { type ActionState, actionError, formObject } from "./shared";

const KINDS = ["CR", "CCB", "CRI", "CRA", "DEBENTURE", "PRECATORIO", "OUTRO"] as const;

const assetSchema = z.object({
  code: z.string().transform((value, ctx) => {
    try {
      return normalizeAssetCode(value);
    } catch (err) {
      ctx.addIssue({ code: "custom", message: (err as Error).message });
      return z.NEVER;
    }
  }),
  name: z.string().trim().min(2, "Informe o nome do ativo").max(160),
  kind: z.enum(KINDS, { message: "Escolha o tipo do ativo" }),
  issuerName: z.string().trim().min(2, "Informe o emissor / devedor").max(160),
  totalVolume: decimalField(2, { label: "Volume total" }),
  tokenSupply: tokenAmountField("Quantidade de tokens"),
  unitPrice: decimalField(8, { label: "PU inicial" }),
  remuneration: optionalText,
  issueDate: optionalDate,
  maturityDate: optionalDate,
  paymentFrequency: optionalText,
  documentsUrl: optionalText.refine((v) => v === null || /^https?:\/\//.test(v), "O link deve começar com http(s)://"),
  description: optionalText,
});

export async function createAsset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = assetSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  let id: string;
  try {
    const [row] = await db().insert(assets).values(parsed.data).returning({ id: assets.id });
    if (!row) return { error: "Não foi possível salvar." };
    id = row.id;
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `O código ${parsed.data.code} já está em uso.` };
    return actionError(err);
  }
  revalidatePath("/admin", "layout");
  redirect(`/admin/ativos/${id}`);
}

export async function updateAsset(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin();
  const [current] = await db().select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!current) return { error: "Ativo não encontrado." };

  const raw = formObject(formData);
  // Code and supply are frozen once the token exists on-chain.
  if (current.status !== "draft") {
    raw.code = current.code;
    raw.tokenSupply = current.tokenSupply;
  }
  const parsed = assetSchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  try {
    await db().update(assets).set(parsed.data).where(eq(assets.id, id));
  } catch (err) {
    if (isUniqueViolation(err)) return { error: `O código ${parsed.data.code} já está em uso.` };
    return actionError(err);
  }
  revalidatePath("/admin", "layout");
  return { ok: "Dados salvos." };
}

/** Issues the full supply into the operator treasury. */
export async function tokenizeAsset(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();

  const [asset] = await db()
    .update(assets)
    .set({ status: "tokenizing" })
    .where(and(eq(assets.id, id), eq(assets.status, "draft")))
    .returning();
  if (!asset) return { error: "Este ativo não está em rascunho." };

  const revert = () =>
    db()
      .update(assets)
      .set({ status: "draft", tokenizeTxHash: null, tokenizeTxExpiresAt: null })
      .where(eq(assets.id, id));

  let submitted = false;
  try {
    const health = await lastroHealth();
    if (!health.issuer.exists || !health.issuer.flagsOk) {
      await revert();
      return { error: "A conta emissora não está configurada (flags de autorização). Rode `pnpm stellar:setup`." };
    }
    const issuer = issuerKeypair();
    const operator = operatorKeypair();
    const stellarAsset = lastroAsset(asset.code);
    const operatorAccount = await loadAccount(operator.publicKey());
    const tx = buildTokenizeTx({
      source: operatorAccount,
      networkPassphrase: stellarNetwork().passphrase,
      issuer: issuer.publicKey(),
      asset: stellarAsset,
      amount: asset.tokenSupply,
      operatorHasTrustline: Boolean(findTrustline(operatorAccount, stellarAsset)),
    });
    tx.sign(operator, issuer);

    await db()
      .update(assets)
      .set({ tokenizeTxHash: txHashHex(tx), tokenizeTxExpiresAt: txExpiresAt(tx) })
      .where(eq(assets.id, id));
    submitted = true;
    const outcome = await submitTx(tx);

    if (outcome.status === "success") {
      await db().update(assets).set({ status: "tokenized", tokenizedAt: new Date() }).where(eq(assets.id, id));
      await logActivity({
        actorId: admin.id,
        action: "asset.tokenized",
        assetId: id,
        txHash: outcome.hash,
        detail: { code: asset.code, supply: asset.tokenSupply },
      });
      revalidatePath("/admin", "layout");
      return { ok: `${asset.code} emitido na Stellar.` };
    }
    if (outcome.status === "failed") {
      await revert();
      revalidatePath("/admin", "layout");
      return { error: outcome.message };
    }
    revalidatePath("/admin", "layout");
    return { error: "A rede não confirmou a tempo. Clique em “Verificar transação” em alguns segundos." };
  } catch (err) {
    if (!submitted) await revert();
    revalidatePath("/admin", "layout");
    return actionError(err);
  }
}

export async function reconcileTokenize(id: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const [asset] = await db().select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset || asset.status !== "tokenizing" || !asset.tokenizeTxHash) return { error: "Nada a verificar." };
  try {
    const result = await reconcileTx(asset.tokenizeTxHash, asset.tokenizeTxExpiresAt);
    if (result === "pending") return { error: "Ainda processando. Tente de novo em alguns segundos." };
    if (result === "success") {
      await db()
        .update(assets)
        .set({ status: "tokenized", tokenizedAt: new Date() })
        .where(and(eq(assets.id, id), eq(assets.status, "tokenizing")));
      await logActivity({ actorId: admin.id, action: "asset.tokenized", assetId: id, txHash: asset.tokenizeTxHash });
    } else {
      await db()
        .update(assets)
        .set({ status: "draft", tokenizeTxHash: null, tokenizeTxExpiresAt: null })
        .where(and(eq(assets.id, id), eq(assets.status, "tokenizing")));
    }
    revalidatePath("/admin", "layout");
    return result === "success" ? { ok: "Tokenização confirmada." } : { error: "A transação não entrou. Tente tokenizar novamente." };
  } catch (err) {
    return actionError(err);
  }
}

const priceSchema = z.object({
  price: decimalField(8, { label: "PU" }),
  refDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data de referência"),
});

export async function addPrice(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = priceSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  await db().insert(assetPrices).values({ assetId, ...parsed.data });
  await logActivity({ actorId: admin.id, action: "price.added", assetId, detail: parsed.data });
  revalidatePath("/admin", "layout");
  return { ok: "PU registrado." };
}

async function tokenizedAsset(assetId: string) {
  const [asset] = await db().select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset || asset.status !== "tokenized") throw new Error("Ativo não tokenizado");
  return asset;
}

async function userIdByAddress(address: string): Promise<string | null> {
  const [row] = await db().select({ id: users.id }).from(users).where(eq(users.stellarAddress, address)).limit(1);
  return row?.id ?? null;
}

function parseHolder(formData: FormData): string | null {
  const holder = formData.get("holder");
  return typeof holder === "string" && StrKey.isValidEd25519PublicKey(holder) ? holder : null;
}

/** Freeze (authorized=false) or unfreeze a holder's trustline. */
export async function setHolderAuthorization(
  assetId: string,
  authorized: boolean,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireAdmin();
  const holder = parseHolder(formData);
  if (!holder) return { error: "Endereço inválido." };
  if (holder === operatorKeypair().publicKey()) return { error: "A tesouraria não pode ser congelada." };
  try {
    const asset = await tokenizedAsset(assetId);
    const issuer = issuerKeypair();
    const operator = operatorKeypair();
    const tx = buildSetAuthorizationTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: stellarNetwork().passphrase,
      issuer: issuer.publicKey(),
      holder,
      asset: lastroAsset(asset.code),
      authorized,
    });
    tx.sign(operator, issuer);
    const outcome = await submitTx(tx);
    if (outcome.status !== "success") return { error: outcome.message };
    await logActivity({
      actorId: admin.id,
      action: authorized ? "holder.unfrozen" : "holder.frozen",
      assetId,
      subjectUserId: await userIdByAddress(holder),
      txHash: outcome.hash,
      detail: { holder },
    });
    revalidatePath("/admin", "layout");
    return { ok: authorized ? "Detentor descongelado." : "Detentor congelado." };
  } catch (err) {
    return actionError(err);
  }
}

export async function clawbackHolder(assetId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const holder = parseHolder(formData);
  if (!holder) return { error: "Endereço inválido." };
  const parsed = tokenAmountField("Quantidade").safeParse(formData.get("amount") ?? "");
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  try {
    const asset = await tokenizedAsset(assetId);
    const issuer = issuerKeypair();
    const operator = operatorKeypair();
    const stellarAsset = lastroAsset(asset.code);
    const account = await loadAccount(holder);
    const line = findTrustline(account, stellarAsset);
    if (!line || toStroops(line.balance) < toStroops(parsed.data)) {
      return { error: "Quantidade maior que o saldo do detentor." };
    }
    const tx = buildClawbackTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: stellarNetwork().passphrase,
      issuer: issuer.publicKey(),
      holder,
      asset: stellarAsset,
      amount: parsed.data,
    });
    tx.sign(operator, issuer);
    const outcome = await submitTx(tx);
    if (outcome.status !== "success") return { error: outcome.message };
    await logActivity({
      actorId: admin.id,
      action: "holder.clawback",
      assetId,
      subjectUserId: await userIdByAddress(holder),
      txHash: outcome.hash,
      detail: { holder, amount: parsed.data },
    });
    revalidatePath("/admin", "layout");
    return { ok: "Clawback executado." };
  } catch (err) {
    return actionError(err);
  }
}
