"use server";

import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { logActivity } from "@/lib/activity";
import { requireAdmin, requireClient } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, proposalScenarios, proposals, users } from "@/lib/db/schema";
import { parseDecimal } from "@/lib/decimal";
import {
  addMonths,
  parseScenarios,
  type ScenarioInput,
  sameStructure,
  scenarioLetter,
  scenarioSchema,
  structureSummary,
  ticketToQuantity,
} from "@/lib/proposals";
import { firstIssue } from "@/lib/validation";
import { type ActionState, actionError, formObject } from "./shared";

/*
 * The structuring loop with an institution:
 *   Lastro proposes scenarios ─▶ the institution edits one and sends it back ─▶
 *   Lastro either revises (new round) or confirms with its client (the borrower) and closes.
 * Closing writes the agreed terms to the asset (still a draft) and fixes the institution's
 * token quantity; the delivery (trustline + transfer) starts after tokenization.
 */

const uuid = (message: string) => z.string().uuid(message);

function revalidate() {
  revalidatePath("/admin", "layout");
  revalidatePath("/app", "layout");
}

function checkTickets(scenarios: ScenarioInput[], totalVolume: string): string | null {
  const max = parseDecimal(totalVolume, 2);
  const over = scenarios.findIndex((s) => parseDecimal(s.ticket, 2) > max);
  return over >= 0 ? `Cenário ${scenarioLetter(over)}: o ticket passa do volume da série.` : null;
}

const scenarioRows = (proposalId: string, round: number, scenarios: ScenarioInput[], basedOnId: string | null = null) =>
  scenarios.map((s, i) => ({
    proposalId,
    round,
    author: "lastro" as const,
    label: `Cenário ${scenarioLetter(i)}`,
    basedOnId: i === 0 ? basedOnId : null,
    ...s,
  }));

/** Lastro opens a structuring proposal with 1–3 scenarios for one institution. */
export async function createProposal(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const form = formObject(formData);
  const ids = z.object({ assetId: uuid("Escolha o ativo"), userId: uuid("Escolha a instituição") }).safeParse(form);
  if (!ids.success) return { error: firstIssue(ids.error) };
  const parsed = parseScenarios(form);
  if ("error" in parsed) return { error: parsed.error };

  const [asset] = await db().select().from(assets).where(eq(assets.id, ids.data.assetId)).limit(1);
  if (!asset) return { error: "Ativo não encontrado." };
  if (asset.status !== "draft") return { error: "A estrutura só pode ser negociada antes da tokenização." };
  const [institution] = await db().select().from(users).where(eq(users.id, ids.data.userId)).limit(1);
  if (!institution || institution.role !== "client") return { error: "Instituição não encontrada." };
  if (institution.kycStatus !== "approved") return { error: "Aprove o KYB da instituição antes de enviar cenários." };
  const ticketError = checkTickets(parsed.scenarios, asset.totalVolume);
  if (ticketError) return { error: ticketError };

  let id: string;
  try {
    id = await db().transaction(async (tx) => {
      const [row] = await tx
        .insert(proposals)
        .values({ assetId: asset.id, userId: institution.id, createdBy: admin.id })
        .returning({ id: proposals.id });
      if (!row) throw new Error("insert failed");
      await tx.insert(proposalScenarios).values(scenarioRows(row.id, 1, parsed.scenarios));
      return row.id;
    });
  } catch (err) {
    return actionError(err);
  }
  await logActivity({
    actorId: admin.id,
    action: "proposal.sent",
    assetId: asset.id,
    subjectUserId: institution.id,
    detail: { proposalId: id, round: 1, scenarios: parsed.scenarios.length },
  });
  revalidate();
  redirect(`/admin/propostas/${id}`);
}

/** The institution sends back one scenario of the current round, edited or as is. */
export async function counterProposal(proposalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireClient();
  const form = formObject(formData);
  const basedOn = uuid("Cenário inválido").safeParse(form.basedOnId);
  if (!basedOn.success) return { error: firstIssue(basedOn.error) };
  const parsed = scenarioSchema.safeParse(form);
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const [row] = await db()
    .select({ proposal: proposals, asset: assets })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .where(and(eq(proposals.id, proposalId), eq(proposals.userId, user.id)))
    .limit(1);
  if (!row) return { error: "Proposta não encontrada." };
  if (row.proposal.status !== "with_institution") return { error: "Esta proposta não está aguardando a sua resposta." };
  const ticketError = checkTickets([parsed.data], row.asset.totalVolume);
  if (ticketError) return { error: "O ticket passa do volume da série." };

  const [base] = await db()
    .select({ id: proposalScenarios.id })
    .from(proposalScenarios)
    .where(
      and(
        eq(proposalScenarios.id, basedOn.data),
        eq(proposalScenarios.proposalId, proposalId),
        eq(proposalScenarios.round, row.proposal.round),
      ),
    )
    .limit(1);
  if (!base) return { error: "Escolha um dos cenários desta rodada." };

  const round = row.proposal.round + 1;
  const done = await db().transaction(async (tx) => {
    const claimed = await tx
      .update(proposals)
      .set({ status: "with_lastro", round, updatedAt: new Date() })
      .where(and(eq(proposals.id, proposalId), eq(proposals.status, "with_institution"), eq(proposals.round, row.proposal.round)))
      .returning({ id: proposals.id });
    if (!claimed.length) return false;
    await tx.insert(proposalScenarios).values({
      proposalId,
      round,
      author: "institution",
      label: "Versão da instituição",
      basedOnId: base.id,
      ...parsed.data,
    });
    return true;
  });
  if (!done) return { error: "Esta proposta já foi respondida." };

  await logActivity({
    actorId: user.id,
    action: "proposal.countered",
    assetId: row.asset.id,
    subjectUserId: user.id,
    detail: { proposalId, round },
  });
  revalidate();
  return { ok: "Enviado à Lastro. Ela confirma com o cliente e fecha, ou manda novos cenários." };
}

/** Lastro answers the institution's version with a new round of scenarios. */
export async function reviseProposal(proposalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = parseScenarios(formObject(formData));
  if ("error" in parsed) return { error: parsed.error };

  const [row] = await db()
    .select({ proposal: proposals, asset: assets })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!row) return { error: "Proposta não encontrada." };
  if (row.proposal.status !== "with_lastro") return { error: "Esta proposta não está com a Lastro." };
  if (row.asset.status !== "draft") return { error: "O ativo já foi tokenizado; a estrutura não muda mais." };
  const ticketError = checkTickets(parsed.scenarios, row.asset.totalVolume);
  if (ticketError) return { error: ticketError };

  const [latest] = await db()
    .select({ id: proposalScenarios.id })
    .from(proposalScenarios)
    .where(and(eq(proposalScenarios.proposalId, proposalId), eq(proposalScenarios.round, row.proposal.round)))
    .limit(1);

  const round = row.proposal.round + 1;
  const done = await db().transaction(async (tx) => {
    const claimed = await tx
      .update(proposals)
      .set({ status: "with_institution", round, updatedAt: new Date() })
      .where(and(eq(proposals.id, proposalId), eq(proposals.status, "with_lastro"), eq(proposals.round, row.proposal.round)))
      .returning({ id: proposals.id });
    if (!claimed.length) return false;
    await tx.insert(proposalScenarios).values(scenarioRows(proposalId, round, parsed.scenarios, latest?.id ?? null));
    return true;
  });
  if (!done) return { error: "Esta proposta mudou enquanto você editava. Recarregue a página." };

  await logActivity({
    actorId: admin.id,
    action: "proposal.sent",
    assetId: row.asset.id,
    subjectUserId: row.proposal.userId,
    detail: { proposalId, round, scenarios: parsed.scenarios.length },
  });
  revalidate();
  return { ok: "Novos cenários enviados à instituição." };
}

const closeSchema = z.object({
  clientConfirmation: z
    .string()
    .trim()
    .min(5, "Registre como o cliente confirmou (quem, quando, por qual canal)")
    .max(300, "Máximo de 300 caracteres"),
});

/**
 * Lastro confirmed the institution's version with its client (the borrower): close the deal.
 * The agreed terms are written to the asset and the institution's token quantity is fixed.
 */
export async function closeProposal(proposalId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const parsed = closeSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const [row] = await db()
    .select({ proposal: proposals, asset: assets })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!row) return { error: "Proposta não encontrada." };
  const { proposal, asset } = row;
  if (proposal.status !== "with_lastro") return { error: "Só é possível fechar a versão enviada pela instituição." };
  if (asset.status !== "draft") return { error: "O ativo já foi tokenizado; a estrutura não muda mais." };

  const [agreed] = await db()
    .select()
    .from(proposalScenarios)
    .where(
      and(
        eq(proposalScenarios.proposalId, proposalId),
        eq(proposalScenarios.round, proposal.round),
        eq(proposalScenarios.author, "institution"),
      ),
    )
    .limit(1);
  if (!agreed) return { error: "Versão da instituição não encontrada." };

  let quantity: string;
  try {
    quantity = ticketToQuantity(agreed.ticket, asset.unitPrice);
  } catch {
    return { error: "PU inicial do ativo inválido." };
  }
  if (parseDecimal(quantity, 7) <= 0n) return { error: "O ticket é menor que um token." };

  // Every institution in a series holds the same token: their closed structures must match.
  const others = await db()
    .select({ proposal: proposals, scenario: proposalScenarios })
    .from(proposals)
    .innerJoin(proposalScenarios, eq(proposalScenarios.id, proposals.agreedScenarioId))
    .where(and(eq(proposals.assetId, asset.id), eq(proposals.status, "closed"), ne(proposals.id, proposalId)));
  if (others.some((o) => !sameStructure(o.scenario, agreed))) {
    return { error: "Outra instituição já fechou esta série com outra estrutura. Revise os cenários para a mesma estrutura." };
  }
  const committed = others.reduce((acc, o) => acc + parseDecimal(o.proposal.committedQuantity ?? "0", 7), 0n);
  if (committed + parseDecimal(quantity, 7) > parseDecimal(asset.tokenSupply, 7)) {
    return { error: "Os compromissos fechados passariam da quantidade de tokens da série." };
  }

  try {
    const done = await db().transaction(async (tx) => {
      const claimed = await tx
        .update(proposals)
        .set({
          status: "closed",
          agreedScenarioId: agreed.id,
          committedQuantity: quantity,
          clientConfirmation: parsed.data.clientConfirmation,
          closedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(proposals.id, proposalId), eq(proposals.status, "with_lastro"), eq(proposals.round, proposal.round)))
        .returning({ id: proposals.id });
      if (!claimed.length) return false;
      const updated = await tx
        .update(assets)
        .set({
          remuneration: agreed.remuneration,
          paymentFrequency: structureSummary(agreed),
          ...(asset.issueDate ? { maturityDate: addMonths(asset.issueDate, agreed.termMonths) } : {}),
        })
        .where(and(eq(assets.id, asset.id), eq(assets.status, "draft")))
        .returning({ id: assets.id });
      if (!updated.length) throw new Error("asset no longer a draft");
      return true;
    });
    if (!done) return { error: "Esta proposta já foi fechada ou mudou." };
  } catch (err) {
    return actionError(err, "Não foi possível fechar. O ativo pode ter sido tokenizado nesse meio tempo.");
  }

  await logActivity({
    actorId: admin.id,
    action: "proposal.closed",
    assetId: asset.id,
    subjectUserId: proposal.userId,
    detail: { proposalId, scenarioId: agreed.id, ticket: agreed.ticket, quantity, clientConfirmation: parsed.data.clientConfirmation },
  });
  revalidate();
  return { ok: "Proposta fechada. A estrutura acordada foi gravada no ativo." };
}

export async function cancelProposal(proposalId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const admin = await requireAdmin();
  const [row] = await db()
    .update(proposals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(proposals.id, proposalId), inArray(proposals.status, ["with_institution", "with_lastro"])))
    .returning({ assetId: proposals.assetId, userId: proposals.userId });
  if (!row) return { error: "Não é possível cancelar neste status." };
  await logActivity({ actorId: admin.id, action: "proposal.cancelled", assetId: row.assetId, subjectUserId: row.userId, detail: { proposalId } });
  revalidate();
  return { ok: "Proposta cancelada." };
}

/** The institution declines the deal. */
export async function declineProposal(proposalId: string, _prev: ActionState, _formData: FormData): Promise<ActionState> {
  const user = await requireClient();
  const [row] = await db()
    .update(proposals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(proposals.id, proposalId), eq(proposals.userId, user.id), eq(proposals.status, "with_institution")))
    .returning({ assetId: proposals.assetId });
  if (!row) return { error: "Não é possível recusar neste status." };
  await logActivity({ actorId: user.id, action: "proposal.declined", assetId: row.assetId, subjectUserId: user.id, detail: { proposalId } });
  revalidate();
  return { ok: "Proposta recusada." };
}
