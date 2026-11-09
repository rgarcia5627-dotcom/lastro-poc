import { db } from "@/lib/db";
import { activity } from "@/lib/db/schema";

export async function logActivity(entry: {
  actorId?: string | null;
  action: string;
  assetId?: string | null;
  subjectUserId?: string | null;
  txHash?: string | null;
  detail?: Record<string, unknown>;
}) {
  try {
    await db()
      .insert(activity)
      .values({
        actorId: entry.actorId ?? null,
        action: entry.action,
        assetId: entry.assetId ?? null,
        subjectUserId: entry.subjectUserId ?? null,
        txHash: entry.txHash ?? null,
        detail: entry.detail ?? null,
      });
  } catch (err) {
    // The audit log must never break the action it describes.
    console.error("[activity]", err);
  }
}

export const ACTIVITY_LABELS: Record<string, string> = {
  "wallet.created": "Carteira criada",
  "asset.tokenized": "Ativo tokenizado",
  "allocation.created": "Transferência criada",
  "allocation.accepted": "Instituição aceitou o token",
  "allocation.transferred": "Tokens transferidos",
  "allocation.declined": "Instituição recusou",
  "allocation.cancelled": "Transferência cancelada",
  "holder.frozen": "Detentor congelado",
  "holder.unfrozen": "Detentor descongelado",
  "holder.clawback": "Clawback executado",
  "price.added": "PU atualizado",
  "payment.scheduled": "Pagamento agendado",
  "payment.snapshot": "Lista de detentores fechada",
  "payment.paid": "Pagamento registrado na Stellar",
  "kyc.updated": "KYB atualizado",
  "proposal.sent": "Cenários enviados",
  "proposal.countered": "Instituição respondeu com a sua versão",
  "proposal.closed": "Proposta fechada com o cliente",
  "proposal.cancelled": "Proposta cancelada",
  "proposal.declined": "Instituição recusou a proposta",
};
