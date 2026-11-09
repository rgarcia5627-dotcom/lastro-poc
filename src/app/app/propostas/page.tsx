import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, proposals } from "@/lib/db/schema";
import { formatBRL, formatDateTime } from "@/lib/format";
import { assetKindLabel, PROPOSAL_STATUS } from "@/lib/labels";

export const metadata = { title: "Propostas" };

export default async function InstitutionProposalsPage() {
  const user = await requireClient();
  const rows = await db()
    .select({ proposal: proposals, asset: assets })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .where(eq(proposals.userId, user.id))
    .orderBy(desc(proposals.updatedAt));
  return (
    <>
      <PageHeader
        title="Propostas"
        description="Operações que a Lastro estruturou para a sua instituição. Escolha um cenário, ajuste o que precisar e devolva: a Lastro confirma com o cliente e fecha."
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState>Nenhuma proposta para a sua instituição ainda.</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ proposal, asset }) => (
            <Link
              key={proposal.id}
              href={`/app/propostas/${proposal.id}`}
              className="block rounded-xl border border-line bg-white p-5 transition-colors hover:border-ink/30"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-medium text-muted">
                  {assetKindLabel(asset.kind)} · {asset.code}
                </div>
                <StatusBadge map={PROPOSAL_STATUS} value={proposal.status} />
              </div>
              <h2 className="mt-1 text-base font-semibold">{asset.name}</h2>
              <p className="mt-1 text-sm text-muted">{asset.issuerName}</p>
              <p className="mt-3 text-xs text-muted">
                Série de {formatBRL(asset.totalVolume)} · rodada {proposal.round} · {formatDateTime(proposal.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
