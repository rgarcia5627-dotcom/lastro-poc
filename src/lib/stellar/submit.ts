import type { Transaction } from "@stellar/stellar-sdk";
import { horizon } from "./config";
import { txHashHex } from "./tx";

export type ResultCodes = { transaction?: string; operations?: string[] };

export type SubmitOutcome =
  | { status: "success"; hash: string; ledger: number }
  /** Definitively rejected — safe to retry with a new transaction. */
  | { status: "failed"; hash: string; codes: ResultCodes; message: string }
  /** Network error / timeout — the tx may still land until it expires. Reconcile by hash. */
  | { status: "unknown"; hash: string; message: string };

const MESSAGES: Record<string, string> = {
  tx_bad_seq: "Sequência da conta desatualizada. Tente novamente.",
  tx_too_late: "A transação expirou antes de ser enviada. Tente novamente.",
  tx_insufficient_fee: "Taxa insuficiente para a rede neste momento. Tente novamente.",
  tx_insufficient_balance: "A conta operadora não tem XLM suficiente para taxas.",
  tx_bad_auth: "Assinatura inválida ou ausente.",
  tx_bad_auth_extra: "A transação tem assinaturas a mais.",
  op_underfunded: "Saldo insuficiente na conta de origem.",
  op_no_trust: "O destinatário ainda não aceitou o token (sem trustline).",
  op_not_authorized: "A trustline não está autorizada pela Lastro.",
  op_low_reserve: "A conta operadora não tem XLM suficiente para patrocinar a reserva.",
  op_already_exists: "A conta Stellar já existe.",
  op_line_full: "O limite da trustline do destinatário foi atingido.",
  op_no_issuer: "Emissor do token não encontrado.",
  op_cant_revoke: "O emissor não tem permissão para revogar (flag AUTH_REVOCABLE ausente).",
  op_not_clawback_enabled: "Esta trustline não permite clawback.",
  op_no_account: "Conta de destino inexistente.",
};

export function describeResultCodes(codes: ResultCodes): string {
  const all = [...(codes.operations ?? []).filter((c) => c !== "op_success"), codes.transaction].filter(
    (c): c is string => Boolean(c),
  );
  for (const code of all) if (MESSAGES[code]) return MESSAGES[code];
  return all.length ? `Transação rejeitada pela rede (${all.join(", ")}).` : "Transação rejeitada pela rede.";
}

export async function submitTx(tx: Transaction): Promise<SubmitOutcome> {
  const hash = txHashHex(tx);
  try {
    const res = await horizon().submitTransaction(tx, { skipMemoRequiredCheck: true });
    return { status: "success", hash: res.hash, ledger: res.ledger };
  } catch (err) {
    const response = (err as { response?: { status?: number; data?: Record<string, unknown> } }).response;
    const extras = response?.data?.extras as { result_codes?: ResultCodes } | undefined;
    if (extras?.result_codes) {
      return { status: "failed", hash, codes: extras.result_codes, message: describeResultCodes(extras.result_codes) };
    }
    if (response?.status && response.status >= 400 && response.status < 500) {
      const title = typeof response.data?.title === "string" ? response.data.title : "requisição inválida";
      return { status: "failed", hash, codes: {}, message: `Horizon recusou a transação: ${title}.` };
    }
    return { status: "unknown", hash, message: (err as Error)?.message ?? "erro de rede" };
  }
}

export type TxLookup = { found: true; successful: boolean } | { found: false };

export async function lookupTx(hash: string): Promise<TxLookup> {
  try {
    const record = await horizon().transactions().transaction(hash).call();
    return { found: true, successful: record.successful };
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return { found: false };
    throw err;
  }
}

/**
 * Resolves a submission whose outcome was unknown.
 * Returns "pending" while the tx could still land (before expiry + a small grace).
 */
export async function reconcileTx(hash: string, expiresAt: Date | null): Promise<"success" | "failed" | "pending"> {
  const found = await lookupTx(hash);
  if (found.found) return found.successful ? "success" : "failed";
  const graceMs = 15_000;
  if (expiresAt && Date.now() > expiresAt.getTime() + graceMs) return "failed";
  return "pending";
}
