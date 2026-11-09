import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { type AssetRow, assetPrices, assets, proposalScenarios, proposals, users } from "@/lib/db/schema";

/** Latest PU per asset (by reference date). Falls back to the asset's initial PU. */
export async function latestPrices(): Promise<Map<string, { price: string; refDate: string | null }>> {
  const rows = await db()
    .select({ assetId: assetPrices.assetId, price: assetPrices.price, refDate: assetPrices.refDate })
    .from(assetPrices)
    .orderBy(desc(assetPrices.refDate), desc(assetPrices.createdAt));
  const out = new Map<string, { price: string; refDate: string | null }>();
  for (const row of rows) if (!out.has(row.assetId)) out.set(row.assetId, { price: row.price, refDate: row.refDate });
  return out;
}

export function currentPrice(asset: AssetRow, prices: Map<string, { price: string; refDate: string | null }>) {
  return prices.get(asset.id) ?? { price: asset.unitPrice, refDate: asset.issueDate };
}

export async function priceHistory(assetId: string) {
  return db()
    .select()
    .from(assetPrices)
    .where(eq(assetPrices.assetId, assetId))
    .orderBy(desc(assetPrices.refDate), desc(assetPrices.createdAt));
}

/** Runs a Horizon read for a page; returns null instead of crashing the page if Horizon is down. */
export async function safeChain<T>(read: () => Promise<T>): Promise<{ data: T | null; error: string | null }> {
  try {
    return { data: await read(), error: null };
  } catch (err) {
    console.error("[horizon]", err);
    const message = err instanceof Error && err.name === "StellarConfigError" ? err.message : "Não foi possível consultar a rede Stellar agora.";
    return { data: null, error: message };
  }
}

/** A proposal with its asset, institution and every scenario (newest round first). `userId` scopes it to one institution. */
export async function loadProposal(proposalId: string, opts: { userId?: string } = {}) {
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) return null;
  const [row] = await db()
    .select({ proposal: proposals, asset: assets, institution: users })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .innerJoin(users, eq(users.id, proposals.userId))
    .where(opts.userId ? and(eq(proposals.id, proposalId), eq(proposals.userId, opts.userId)) : eq(proposals.id, proposalId))
    .limit(1);
  if (!row) return null;
  const scenarios = await db()
    .select()
    .from(proposalScenarios)
    .where(eq(proposalScenarios.proposalId, proposalId))
    .orderBy(desc(proposalScenarios.round), asc(proposalScenarios.label));
  return { ...row, scenarios };
}
