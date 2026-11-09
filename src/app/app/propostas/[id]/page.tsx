import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { ProposalRounds, ScenarioCard, ScenarioInputs, roundsOf } from "@/components/scenario";
import { Badge, Card, ExternalLink, LinkButton, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { counterProposal, declineProposal } from "@/lib/actions/proposals";
import { requireClient } from "@/lib/auth";
import { formatBRL, formatDate, formatQuantity, formatUnitPrice } from "@/lib/format";
import { ASSET_KINDS, PROPOSAL_STATUS } from "@/lib/labels";
import { subscriptionAmount } from "@/lib/proposals";
import { loadProposal } from "@/lib/queries";

export const metadata = { title: "Proposta" };

export default async function InstitutionProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireClient();
  const { id } = await params;
  const data = await loadProposal(id, { userId: user.id });
  if (!data) notFound();
  const { proposal, asset, scenarios } = data;
  const [current] = roundsOf(scenarios);
  const answering = proposal.status === "with_institution" ? current : undefined;
  const agreed = scenarios.find((s) => s.id === proposal.agreedScenarioId);

  const facts: [string, string][] = [
    ["Tipo", ASSET_KINDS.find((k) => k.value === asset.kind)?.label ?? asset.kind],
    ["Emissor", asset.issuerName],
    ["Volume da série", formatBRL(asset.totalVolume)],
    ["PU de emissão", formatUnitPrice(asset.unitPrice)],
    ["Emissão prevista", formatDate(asset.issueDate)],
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {asset.name}
            <StatusBadge map={PROPOSAL_STATUS} value={proposal.status} />
          </span>
        }
        description={asset.description ?? undefined}
        actions={
          <>
            <LinkButton href="/app/propostas" variant="secondary">
              Voltar
            </LinkButton>
            {answering && (
              <ActionButton action={declineProposal.bind(null, proposal.id)} label="Recusar a operação" confirm="Recusar?" variant="ghost" size="md" />
            )}
          </>
        }
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card title="Operação" className="lg:col-span-1">
          <dl className="space-y-3 text-sm">
            {facts.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted">{label}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
          {asset.documentsUrl && (
            <p className="mt-4 text-sm">
              <ExternalLink href={asset.documentsUrl}>Documentos da operação</ExternalLink>
            </p>
          )}
        </Card>
        <div className="lg:col-span-2">
          {proposal.status === "with_lastro" && (
            <Notice tone="brand">Sua versão está com a Lastro. Ela confirma com o cliente e fecha, ou responde com novos cenários.</Notice>
          )}
          {proposal.status === "cancelled" && <Notice>Esta proposta foi encerrada.</Notice>}
          {proposal.status === "closed" && agreed && (
            <Card title="Operação fechada" description="A estrutura abaixo foi confirmada com o cliente. A transferência aparece na sua carteira para aceite assim que o ativo for emitido na Stellar.">
              <ScenarioCard scenario={agreed} tag={<Badge tone="ok">Acordado</Badge>} />
              <p className="mt-3 text-sm text-muted">
                Sua parte: {formatQuantity(proposal.committedQuantity)} {asset.code} a {formatUnitPrice(asset.unitPrice)} de valor de face por
                token, com subscrição de {formatBRL(subscriptionAmount(agreed.ticket, agreed.discount))}, paga em reais fora da blockchain.
              </p>
            </Card>
          )}
          {answering && (
            <Card
              title={`Cenários da Lastro · rodada ${proposal.round}`}
              description="Edite os campos do cenário que preferir e envie. Você pode mudar ticket, taxa, prazo, carência, amortização e garantias."
            >
              <div className="grid gap-4 xl:grid-cols-2">
                {answering.items.map(({ scenario }) => (
                  <section key={scenario.id} aria-label={scenario.label} className="rounded-lg border border-line p-4">
                    <h3 className="mb-3 text-sm font-semibold">{scenario.label}</h3>
                    <ActionForm action={counterProposal.bind(null, proposal.id)} submitLabel="Enviar este cenário à Lastro" pendingLabel="Enviando…">
                      <input type="hidden" name="basedOnId" value={scenario.id} />
                      <ScenarioInputs defaults={scenario} withNote />
                    </ActionForm>
                  </section>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Card title="Histórico da negociação">
        <ProposalRounds scenarios={scenarios} skipRound={answering ? proposal.round : undefined} agreedId={proposal.agreedScenarioId} />
        {answering && proposal.round === 1 && <p className="text-sm text-muted">Primeira rodada: os cenários estão acima.</p>}
      </Card>
    </>
  );
}
