import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { assets, proposals, users } from "@/lib/db/schema";
import { formatDateTime } from "@/lib/format";
import { PROPOSAL_STATUS } from "@/lib/labels";

export const metadata = { title: "Propostas" };

export default async function ProposalsPage() {
  const rows = await db()
    .select({ proposal: proposals, asset: assets, institution: users })
    .from(proposals)
    .innerJoin(assets, eq(assets.id, proposals.assetId))
    .innerJoin(users, eq(users.id, proposals.userId))
    .orderBy(desc(proposals.updatedAt))
    .limit(200);
  return (
    <>
      <PageHeader
        title="Propostas"
        description="A estrutura de cada operação é desenhada com a instituição: a Lastro propõe cenários, a instituição edita, a Lastro confirma com o cliente e fecha."
        actions={<LinkButton href="/admin/propostas/nova">Nova proposta</LinkButton>}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState>Nenhuma proposta ainda.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Operação</Th>
                <Th>Instituição</Th>
                <Th>Rodada</Th>
                <Th>Status</Th>
                <Th>Atualizada</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ proposal, asset, institution }) => (
                <tr key={proposal.id}>
                  <Td>
                    <Link href={`/admin/propostas/${proposal.id}`} className="font-medium hover:underline">
                      {asset.name}
                    </Link>
                    <div className="font-mono text-xs text-muted">{asset.code}</div>
                  </Td>
                  <Td>
                    <div>{institution.orgName ?? institution.name}</div>
                    <div className="text-xs text-muted">{institution.name}</div>
                  </Td>
                  <Td className="tabular-nums">{proposal.round}</Td>
                  <Td>
                    <StatusBadge map={PROPOSAL_STATUS} value={proposal.status} />
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(proposal.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
