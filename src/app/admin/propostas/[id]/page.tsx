import { and, eq, notInArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { ProposalRounds, ScenarioCard, ScenarioInputs, roundsOf } from "@/components/scenario";
import { Badge, Card, Field, inputClass, LinkButton, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { createAllocationFromProposal } from "@/lib/actions/allocations";
import { cancelProposal, closeProposal, reviseProposal } from "@/lib/actions/proposals";
import { db } from "@/lib/db";
import { allocations } from "@/lib/db/schema";
import { formatBRL, formatDateTime, formatQuantity, plainDecimal } from "@/lib/format";
import { ALLOCATION_STATUS, orgTypeLabel, PROPOSAL_STATUS } from "@/lib/labels";
import { scenarioLetter, subscriptionAmount } from "@/lib/proposals";
import { loadProposal } from "@/lib/queries";

export const metadata = { title: "Proposta" };

export default async function AdminProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await loadProposal(id);
  if (!data) notFound();
  const { proposal, asset, institution, scenarios } = data;
  const [current] = roundsOf(scenarios);
  const institutionVersion = proposal.status === "with_lastro" ? current?.items[0] : undefined;
  const agreed = scenarios.find((s) => s.id === proposal.agreedScenarioId);
  const [delivery] =
    proposal.status === "closed"
      ? await db()
          .select()
          .from(allocations)
          .where(and(eq(allocations.proposalId, proposal.id), notInArray(allocations.status, ["cancelled", "declined"])))
          .limit(1)
      : [];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {asset.name}
            <StatusBadge map={PROPOSAL_STATUS} value={proposal.status} />
          </span>
        }
        description={`${institution.orgName ?? institution.name} · ${orgTypeLabel(institution.orgType)} · representante ${institution.name}`}
        actions={
          <>
            <LinkButton href={`/admin/ativos/${asset.id}`} variant="secondary">
              Ver ativo {asset.code}
            </LinkButton>
            {(proposal.status === "with_institution" || proposal.status === "with_lastro") && (
              <ActionButton action={cancelProposal.bind(null, proposal.id)} label="Cancelar proposta" confirm="Cancelar?" variant="ghost" size="md" />
            )}
          </>
        }
      />

      {proposal.status === "with_institution" && (
        <Notice tone="warn">Cenários da rodada {proposal.round} enviados. Aguardando a instituição escolher e editar um deles.</Notice>
      )}

      {institutionVersion && (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card
            className="lg:col-span-2"
            title="Versão da instituição"
            description="O que ela editou aparece destacado, comparado ao cenário de onde partiu."
          >
            <ScenarioCard scenario={institutionVersion.scenario} changed={institutionVersion.changed} className="border-brand/40" />
          </Card>
          <Card
            className="lg:col-span-3"
            title="Confirmar com o cliente e fechar"
            description="Fale com o cliente (o tomador). Com o de acordo dele, feche: a estrutura vai para o ativo e o ticket vira quantidade de tokens."
          >
            <ActionForm action={closeProposal.bind(null, proposal.id)} submitLabel="Fechar proposta" pendingLabel="Fechando…">
              <Field label="Confirmação do cliente" hint="Quem confirmou, quando e por qual canal. Fica no registro da operação.">
                <input
                  name="clientConfirmation"
                  required
                  maxLength={300}
                  className={inputClass}
                  placeholder="Ex.: aprovado pelo CFO da Kalata por e-mail em 05/11/2026"
                />
              </Field>
            </ActionForm>
            <details className="mt-5 border-t border-line pt-4">
              <summary className="cursor-pointer text-sm font-semibold">Ou enviar novos cenários</summary>
              <div className="mt-3">
                <ActionForm action={reviseProposal.bind(null, proposal.id)} submitLabel="Enviar nova rodada" pendingLabel="Enviando…">
                  {[0, 1].map((i) => (
                    <fieldset key={i} className="rounded-lg border border-line p-4">
                      <legend className="px-1 text-sm font-semibold">
                        Cenário {scenarioLetter(i)}
                        {i > 0 && <span className="font-normal text-muted"> (opcional)</span>}
                      </legend>
                      <ScenarioInputs index={i} defaults={i === 0 ? institutionVersion.scenario : undefined} />
                    </fieldset>
                  ))}
                </ActionForm>
              </div>
            </details>
          </Card>
        </div>
      )}

      {proposal.status === "closed" && agreed && (
        <div className="grid gap-6 lg:grid-cols-5">
          <Card className="lg:col-span-2" title="Estrutura acordada">
            <ScenarioCard scenario={agreed} tag={<Badge tone="ok">Acordado</Badge>} />
          </Card>
          <Card className="lg:col-span-3" title="Fechamento">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Confirmação do cliente</dt>
                <dd className="text-right font-medium">{proposal.clientConfirmation}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Fechada em</dt>
                <dd className="text-right font-medium">{formatDateTime(proposal.closedAt)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Compromisso</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatQuantity(proposal.committedQuantity)} {asset.code} · {formatBRL(agreed.ticket)}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Subscrição (off-chain)</dt>
                <dd className="text-right font-medium tabular-nums">
                  {formatBRL(subscriptionAmount(agreed.ticket, agreed.discount))}
                  {Number(agreed.discount) > 0 && <span className="font-normal text-muted"> · deságio de {plainDecimal(agreed.discount).replace(".", ",")}%</span>}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Entrega</dt>
                <dd className="text-right">
                  {delivery ? (
                    <StatusBadge map={ALLOCATION_STATUS} value={delivery.status} />
                  ) : asset.status === "tokenized" ? (
                    <ActionButton action={createAllocationFromProposal.bind(null, proposal.id)} label="Criar transferência" variant="primary" />
                  ) : (
                    <span className="text-muted">
                      Tokenize o ativo para entregar.{" "}
                      <Link href={`/admin/ativos/${asset.id}`} className="text-brand-strong hover:underline">
                        Abrir ativo
                      </Link>
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card title="Histórico da negociação">
          <ProposalRounds scenarios={scenarios} skipRound={institutionVersion ? proposal.round : undefined} agreedId={proposal.agreedScenarioId} />
        </Card>
      </div>
    </>
  );
}
