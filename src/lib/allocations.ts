import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { allocations, assets, type User } from "@/lib/db/schema";
import { HttpError } from "@/lib/http";

/** Loads an allocation that belongs to `user`, with its asset; enforces the preconditions to accept it. */
export async function loadAcceptableAllocation(user: User, allocationId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(allocationId)) throw new HttpError(404, "Transferência não encontrada.");
  const [row] = await db()
    .select({ allocation: allocations, asset: assets })
    .from(allocations)
    .innerJoin(assets, eq(assets.id, allocations.assetId))
    .where(and(eq(allocations.id, allocationId), eq(allocations.userId, user.id)))
    .limit(1);
  if (!row) throw new HttpError(404, "Transferência não encontrada.");
  if (row.allocation.status !== "pending") throw new HttpError(409, "Esta transferência não está aguardando aceite.");
  if (row.asset.status !== "tokenized") throw new HttpError(409, "O ativo ainda não foi tokenizado.");
  if (user.kycStatus !== "approved") {
    throw new HttpError(403, "Seu cadastro ainda está em análise (KYC). Aguarde a aprovação da Lastro.");
  }
  if (!user.stellarAddress) throw new HttpError(409, "Crie sua carteira antes de aceitar.");
  return { ...row, walletAddress: user.stellarAddress };
}

export async function markAccepted(allocationId: string, trustlineTxHash: string | null) {
  await db()
    .update(allocations)
    .set({ status: "accepted", acceptedAt: new Date(), trustlineTxHash, lastError: null })
    .where(and(eq(allocations.id, allocationId), eq(allocations.status, "pending")));
}
