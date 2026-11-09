import { and, asc, desc, eq, notExists, notInArray } from "drizzle-orm";
import Link from "next/link";
import { ActionButton } from "@/components/action-form";
import { Card, EmptyState, ExternalLink, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { cancelAllocation, createAllocationFromProposal, reconcileTransfer, transferAllocation } from "@/lib/actions/allocations";
import { db } from "@/lib/db";
import { allocations, assets, proposals, users } from "@/lib/db/schema";
import { formatDateTime, formatQuantity } from "@/lib/format";
import { ALLOCATION_STATUS } from "@/lib/labels";
import { explorerTxUrl } from "@/lib/stellar/config";

export const metadata = { title: "Transferências" };

export default async function TransfersPage() {
  const [closed, rows] = await Promise.all([
    // Closed proposals without a live delivery: what Lastro still owes each institution.
    db()
      .select({ proposal: proposals, asset: assets, institution: users })
      .from(proposals)
      .innerJoin(assets, eq(assets.id, proposals.assetId))
      .innerJoin(users, eq(users.id, proposals.userId))
      .where(
        and(
          eq(proposals.status, "closed"),
          notExists(
            db()
              .select({ id: allocations.id })
              .from(allocations)
              .where(and(eq(allocations.proposalId, proposals.id), notInArray(allocations.status, ["cancelled", "declined"]))),
          ),
        ),
      )
      .orderBy(asc(proposals.closedAt)),
    db()
      .select({ allocation: allocations, asset: assets, client: users })
      .from(allocations)
      .innerJoin(assets, eq(assets.id, allocations.assetId))
      .innerJoin(users, eq(users.id, allocations.userId))
      .orderBy(desc(allocations.createdAt))
      .limit(200),
  ]);

  return (
    <>
      <PageHeader
        title="Transferências"
        description="Cada transferência nasce de uma proposta fechada. 1) A Lastro cria a transferência. 2) A instituição aceita na carteira, o que cria a trustline. 3) A Lastro envia os tokens da tesouraria."
      />

      <Card title="Compromissos fechados" description="Propostas fechadas com o cliente que ainda não foram entregues.">
        {closed.length === 0 ? (
          <EmptyState>Nenhum compromisso a entregar.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Operação</Th>
                <Th>Instituição</Th>
                <Th className="text-right">Quantidade</Th>
                <Th>Fechada</Th>
                <Th>Ação</Th>
              </tr>
            </thead>
            <tbody>
              {closed.map(({ proposal, asset, institution }) => (
                <tr key={proposal.id}>
                  <Td>
                    <Link href={`/admin/propostas/${proposal.id}`} className="font-medium hover:underline">
                      {asset.code}
                    </Link>
                    <div className="text-xs text-muted">{asset.name}</div>
                  </Td>
                  <Td>{institution.orgName ?? institution.name}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(proposal.committedQuantity)}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDateTime(proposal.closedAt)}</Td>
                  <Td>
                    {asset.status !== "tokenized" ? (
                      <span className="text-sm text-muted">Tokenize o ativo primeiro</span>
                    ) : !institution.stellarAddress || institution.kycStatus !== "approved" ? (
                      <span className="text-sm text-muted">Instituição sem carteira ou KYB</span>
                    ) : (
                      <ActionButton action={createAllocationFromProposal.bind(null, proposal.id)} label="Criar transferência" variant="primary" />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6">
        <Card title="Histórico">
          {rows.length === 0 ? (
            <EmptyState>Nenhuma transferência ainda.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Criada</Th>
                  <Th>Ativo</Th>
                  <Th>Instituição</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th>Status</Th>
                  <Th>Ações</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ allocation, asset, client }) => (
                  <tr key={allocation.id}>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(allocation.createdAt)}</Td>
                    <Td className="font-mono text-xs">{asset.code}</Td>
                    <Td>{client.orgName ?? client.name}</Td>
                    <Td className="text-right tabular-nums">{formatQuantity(allocation.amount)}</Td>
                    <Td>
                      <StatusBadge map={ALLOCATION_STATUS} value={allocation.status} />
                      {allocation.lastError && allocation.status !== "transferred" && (
                        <div className="mt-1 max-w-56 text-xs text-danger">{allocation.lastError}</div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        {allocation.status === "accepted" && (
                          <ActionButton
                            action={transferAllocation.bind(null, allocation.id)}
                            label="Transferir"
                            pendingLabel="Enviando…"
                            confirm="Enviar agora?"
                            variant="primary"
                          />
                        )}
                        {allocation.status === "transferring" && (
                          <ActionButton action={reconcileTransfer.bind(null, allocation.id)} label="Verificar" pendingLabel="Verificando…" />
                        )}
                        {(allocation.status === "pending" || allocation.status === "accepted") && (
                          <ActionButton
                            action={cancelAllocation.bind(null, allocation.id)}
                            label="Cancelar"
                            confirm="Cancelar esta transferência?"
                            variant="ghost"
                          />
                        )}
                        {allocation.status === "transferred" && allocation.transferTxHash && (
                          <ExternalLink href={explorerTxUrl(allocation.transferTxHash)}>Ver transação</ExternalLink>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
