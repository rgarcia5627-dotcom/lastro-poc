import { desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { AssetFields } from "@/components/asset-fields";
import {
  Badge,
  Card,
  EmptyState,
  ExternalLink,
  Field,
  inputClass,
  LinkButton,
  Mono,
  Notice,
  PageHeader,
  Stat,
  StatusBadge,
  Table,
  Td,
  Th,
} from "@/components/ui";
import {
  addPrice,
  clawbackHolder,
  reconcileTokenize,
  setHolderAuthorization,
  tokenizeAsset,
  updateAsset,
} from "@/lib/actions/assets";
import { closePaymentList, reconcilePayment, registerPayment, schedulePayment } from "@/lib/actions/payments";
import { db } from "@/lib/db";
import { allocations, assets, paymentItems, payments, proposals, users } from "@/lib/db/schema";
import { formatDecimal, toStroops } from "@/lib/decimal";
import { formatBRL, formatDate, formatQuantity, formatUnitPrice, plainDecimal, positionValue, shortAddress, todayISO } from "@/lib/format";
import { ALLOCATION_STATUS, ASSET_STATUS, PAYMENT_KINDS, PAYMENT_STATUS, PROPOSAL_STATUS, paymentKindLabel } from "@/lib/labels";
import { currentPrice, latestPrices, priceHistory, safeChain } from "@/lib/queries";
import { explorerAccountUrl, explorerAssetUrl, explorerTxUrl, issuerKeypair, lastroAsset, operatorKeypair } from "@/lib/stellar/config";
import { listHolders } from "@/lib/stellar/horizon";

export const metadata = { title: "Ativo" };

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [asset] = await db().select().from(assets).where(eq(assets.id, id)).limit(1);
  if (!asset) notFound();

  const [prices, history, paymentList, paidTotals, allocationRows, proposalRows] = await Promise.all([
    latestPrices(),
    priceHistory(id),
    db().select().from(payments).where(eq(payments.assetId, id)).orderBy(desc(payments.dueDate)),
    // Separate grouped query: a correlated subquery here would lose its table qualifiers.
    db()
      .select({ paymentId: paymentItems.paymentId, total: sql<string>`sum(${paymentItems.amount})` })
      .from(paymentItems)
      .innerJoin(payments, eq(payments.id, paymentItems.paymentId))
      .where(eq(payments.assetId, id))
      .groupBy(paymentItems.paymentId),
    db()
      .select({ allocation: allocations, client: users })
      .from(allocations)
      .innerJoin(users, eq(users.id, allocations.userId))
      .where(eq(allocations.assetId, id))
      .orderBy(desc(allocations.createdAt))
      .limit(50),
    db()
      .select({ proposal: proposals, institution: users })
      .from(proposals)
      .innerJoin(users, eq(users.id, proposals.userId))
      .where(eq(proposals.assetId, id))
      .orderBy(desc(proposals.updatedAt)),
  ]);
  const totalByPayment = new Map(paidTotals.map((t) => [t.paymentId, t.total]));
  const paymentRows = paymentList.map((payment) => ({ payment, total: totalByPayment.get(payment.id) ?? null }));
  const snapshotted = paymentList.filter((p) => p.status === "snapshotted").reverse(); // earliest first
  const pu = currentPrice(asset, prices);
  const tokenized = asset.status === "tokenized";

  const chain = tokenized
    ? await safeChain(async () => {
        const holders = await listHolders(lastroAsset(asset.code));
        return { holders, operator: operatorKeypair().publicKey(), issuer: issuerKeypair().publicKey() };
      })
    : null;

  const holders = chain?.data?.holders ?? [];
  const treasury = holders.find((h) => h.address === chain?.data?.operator);
  const clientHolders = holders.filter((h) => h.address !== chain?.data?.operator);
  const supplyStroops = holders.reduce((acc, h) => acc + toStroops(h.balance), 0n);
  const distributedStroops = clientHolders.reduce((acc, h) => acc + toStroops(h.balance), 0n);
  const distributed = formatDecimal(distributedStroops, 7);

  const holderUsers = clientHolders.length
    ? await db()
        .select({ name: users.name, orgName: users.orgName, address: users.stellarAddress })
        .from(users)
        .where(inArray(users.stellarAddress, clientHolders.map((h) => h.address)))
    : [];
  const nameByAddress = new Map(holderUsers.map((u) => [u.address, u.orgName ?? u.name]));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {asset.name}
            <Badge tone="brand">{asset.code}</Badge>
            <StatusBadge map={ASSET_STATUS} value={asset.status} />
          </span>
        }
        description={`${asset.issuerName}${asset.remuneration ? ` · ${asset.remuneration}` : ""}${asset.maturityDate ? ` · vence em ${formatDate(asset.maturityDate)}` : ""}`}
        actions={
          asset.status === "draft" ? (
            <>
            <LinkButton href={`/admin/propostas/nova?ativo=${asset.id}`} variant="secondary">
              Nova proposta
            </LinkButton>
            <ActionButton
              action={tokenizeAsset.bind(null, asset.id)}
              label="Tokenizar"
              pendingLabel="Emitindo na Stellar…"
              confirm={`Emitir ${formatQuantity(asset.tokenSupply)} ${asset.code}?`}
              variant="primary"
              size="md"
            />
            </>
          ) : asset.status === "tokenizing" ? (
            <ActionButton action={reconcileTokenize.bind(null, asset.id)} label="Verificar transação" pendingLabel="Verificando…" size="md" />
          ) : (
            <LinkButton href={`/historico/${asset.code}`} variant="secondary">
              Histórico público
            </LinkButton>
          )
        }
      />

      {asset.status === "draft" && (
        <Notice tone="brand">
          Em estruturação. Negocie a estrutura com as instituições em Propostas; ao fechar, os termos acordados vêm para este
          ativo. Ao tokenizar, a Lastro emite {formatQuantity(asset.tokenSupply)} {asset.code} na sua tesouraria e o código e a
          quantidade ficam fixos.
        </Notice>
      )}

      {tokenized && (
        <section className="mt-2 space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Emitido (on-chain)" value={chain?.data ? formatQuantity(formatDecimal(supplyStroops, 7)) : "—"} hint={asset.code} />
            <Stat label="Em tesouraria" value={treasury ? formatQuantity(treasury.balance) : chain?.data ? "0" : "—"} />
            <Stat label="Com instituições" value={chain?.data ? formatQuantity(distributed) : "—"} hint={`${clientHolders.length} detentor(es)`} />
            <Stat
              label="Valor com instituições"
              value={chain?.data ? formatBRL(positionValue(distributed, pu.price)) : "—"}
              hint={`PU ${formatUnitPrice(pu.price)}`}
            />
          </div>

          <Card
            title="Detentores na Stellar"
            description="Contas com trustline para o token. Congelar revoga a autorização; clawback retira tokens da conta (são queimados)."
            actions={<ExternalLink href={explorerAssetUrl(asset.code)}>Ver no explorer</ExternalLink>}
          >
            {chain?.error && <Notice tone="danger">{chain.error}</Notice>}
            {chain?.data && clientHolders.length === 0 && <EmptyState>Nenhuma instituição detém este token ainda.</EmptyState>}
            {clientHolders.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <Th>Instituição</Th>
                    <Th>Conta</Th>
                    <Th className="text-right">Quantidade</Th>
                    <Th>Situação</Th>
                    <Th>Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {clientHolders.map((holder) => (
                    <tr key={holder.address}>
                      <Td>{nameByAddress.get(holder.address) ?? <span className="text-muted">Externo</span>}</Td>
                      <Td>
                        <ExternalLink href={explorerAccountUrl(holder.address)}>{shortAddress(holder.address)}</ExternalLink>
                      </Td>
                      <Td className="text-right tabular-nums">{formatQuantity(holder.balance)}</Td>
                      <Td>{holder.authorized ? <Badge tone="ok">Autorizado</Badge> : <Badge tone="warn">Não autorizado</Badge>}</Td>
                      <Td>
                        <div className="flex flex-wrap items-center gap-2">
                          <ActionButton
                            action={setHolderAuthorization.bind(null, asset.id, !holder.authorized)}
                            hidden={{ holder: holder.address }}
                            label={holder.authorized ? "Congelar" : "Autorizar"}
                            confirm={holder.authorized ? "Congelar este detentor?" : "Autorizar esta conta?"}
                          />
                          {holder.clawbackEnabled && toStroops(holder.balance) > 0n && (
                            <ClawbackForm assetId={asset.id} holder={holder.address} max={holder.balance} />
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="PU — valor do token" description="Atualize o preço unitário para acompanhar o valor das posições.">
          <ActionForm action={addPrice.bind(null, asset.id)} submitLabel="Registrar PU" className="mb-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="PU (R$)">
                <input name="price" required inputMode="decimal" className={inputClass} placeholder={plainDecimal(pu.price)} />
              </Field>
              <Field label="Data de referência">
                <input name="refDate" type="date" required defaultValue={todayISO()} className={inputClass} />
              </Field>
            </div>
          </ActionForm>
          <Table wide={false}>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th className="text-right">PU</Th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <tr key={p.id}>
                  <Td className="tabular-nums">{formatDate(p.refDate)}</Td>
                  <Td className="text-right tabular-nums">{formatUnitPrice(p.price)}</Td>
                </tr>
              ))}
              <tr>
                <Td className="text-muted">Inicial{asset.issueDate ? ` (${formatDate(asset.issueDate)})` : ""}</Td>
                <Td className="text-right tabular-nums text-muted">{formatUnitPrice(asset.unitPrice)}</Td>
              </tr>
            </tbody>
          </Table>
        </Card>

        <Card
          className="lg:col-span-2"
          title="Pagamentos"
          description="Juros e amortizações são pagos em reais, fora da blockchain. Na data de corte, a Lastro fecha a lista de detentores pelos saldos on-chain; depois da liquidação, registra o pagamento na Stellar com o hash do registro."
        >
          <ActionForm action={schedulePayment.bind(null, asset.id)} submitLabel="Agendar pagamento" className="mb-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Data">
                <input name="dueDate" type="date" required className={inputClass} />
              </Field>
              <Field label="Tipo">
                <select name="kind" required className={inputClass} defaultValue="juros">
                  {PAYMENT_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="R$ por token">
                <input name="amountPerToken" required inputMode="decimal" className={inputClass} placeholder="12.50" />
              </Field>
            </div>
            <Field label="Observação">
              <input name="notes" className={inputClass} placeholder="Ex.: parcela 1 de 36" />
            </Field>
          </ActionForm>
          {paymentRows.length === 0 ? (
            <EmptyState>Nenhum pagamento agendado.</EmptyState>
          ) : (
            <Table wide={false}>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Tipo</Th>
                  <Th className="text-right">Por token</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                  <Th>Registro</Th>
                </tr>
              </thead>
              <tbody>
                {paymentRows.map(({ payment, total }) => (
                  <tr key={payment.id}>
                    <Td className="tabular-nums">{formatDate(payment.dueDate)}</Td>
                    <Td>{paymentKindLabel(payment.kind)}</Td>
                    <Td className="text-right tabular-nums">{formatUnitPrice(payment.amountPerToken)}</Td>
                    <Td className="text-right tabular-nums">{total ? formatBRL(total) : "—"}</Td>
                    <Td>
                      <StatusBadge map={PAYMENT_STATUS} value={payment.status} />
                    </Td>
                    <Td>
                      {payment.status === "paid" && payment.registryTxHash ? (
                        <span className="flex flex-col gap-0.5 whitespace-nowrap">
                          <ExternalLink href={explorerTxUrl(payment.registryTxHash)}>
                            tx <Mono>{shortAddress(payment.registryTxHash)}</Mono>
                          </ExternalLink>
                          <ExternalLink href={`/api/payments/${payment.id}/record`}>JSON</ExternalLink>
                        </span>
                      ) : payment.status === "registering" ? (
                        <ActionButton action={reconcilePayment.bind(null, payment.id)} label="Verificar registro" pendingLabel="Verificando…" />
                      ) : payment.status === "snapshotted" ? (
                        <span className="whitespace-nowrap">
                          <ExternalLink href={`/api/payments/${payment.id}/holders`}>lista CSV</ExternalLink>
                        </span>
                      ) : payment.status === "scheduled" && tokenized ? (
                        <ActionButton
                          action={closePaymentList.bind(null, payment.id)}
                          label="Fechar lista"
                          pendingLabel="Lendo saldos…"
                          confirm="Fechar com os saldos on-chain de agora?"
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {tokenized && snapshotted.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-sm font-semibold">Registrar liquidação</h3>
              <p className="mb-3 mt-0.5 text-sm text-muted">
                O agente pagador paga em reais a lista fechada. Informe a liquidação: o registro (lista + valores + referência) é
                gravado na Stellar pelo hash.
              </p>
              <ActionForm action={registerPayment.bind(null, asset.id)} submitLabel="Registrar na Stellar" pendingLabel="Registrando na Stellar…">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Pagamento">
                    <select name="paymentId" required className={inputClass}>
                      {snapshotted.map((p) => (
                        <option key={p.id} value={p.id}>
                          {`${formatDate(p.dueDate)} · ${paymentKindLabel(p.kind)} · ${formatUnitPrice(p.amountPerToken)}/token`}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Data da liquidação">
                    <input name="settledOn" type="date" required defaultValue={todayISO()} className={inputClass} />
                  </Field>
                </div>
                <Field label="Referência da liquidação (off-chain)">
                  <input name="settlementRef" required maxLength={120} className={inputClass} placeholder="Ex.: TED 000123 do agente fiduciário" />
                </Field>
              </ActionForm>
            </div>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Propostas"
          description="A estrutura negociada com cada instituição."
          actions={asset.status === "draft" ? <LinkButton href={`/admin/propostas/nova?ativo=${asset.id}`} size="sm" variant="secondary">Nova proposta</LinkButton> : undefined}
        >
          {proposalRows.length === 0 ? (
            <EmptyState>Nenhuma proposta para esta operação.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Instituição</Th>
                  <Th>Rodada</Th>
                  <Th className="text-right">Compromisso</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {proposalRows.map(({ proposal, institution }) => (
                  <tr key={proposal.id}>
                    <Td>
                      <Link href={`/admin/propostas/${proposal.id}`} className="font-medium hover:underline">
                        {institution.orgName ?? institution.name}
                      </Link>
                    </Td>
                    <Td className="tabular-nums">{proposal.round}</Td>
                    <Td className="text-right tabular-nums">{proposal.committedQuantity ? `${formatQuantity(proposal.committedQuantity)} ${asset.code}` : "—"}</Td>
                    <Td>
                      <StatusBadge map={PROPOSAL_STATUS} value={proposal.status} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Transferências deste ativo">
          {allocationRows.length === 0 ? (
            <EmptyState>Nenhuma transferência ainda.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Instituição</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th>Status</Th>
                  <Th>Transação</Th>
                </tr>
              </thead>
              <tbody>
                {allocationRows.map(({ allocation, client }) => (
                  <tr key={allocation.id}>
                    <Td>{client.orgName ?? client.name}</Td>
                    <Td className="text-right tabular-nums">{formatQuantity(allocation.amount)}</Td>
                    <Td>
                      <StatusBadge map={ALLOCATION_STATUS} value={allocation.status} />
                    </Td>
                    <Td>
                      {allocation.transferTxHash && allocation.status === "transferred" ? (
                        <ExternalLink href={explorerTxUrl(allocation.transferTxHash)}>ver</ExternalLink>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Dados do ativo"
          description={
            asset.tokenizeTxHash && tokenized ? (
              <>
                Tokenizado em <ExternalLink href={explorerTxUrl(asset.tokenizeTxHash)}><Mono>{shortAddress(asset.tokenizeTxHash)}</Mono></ExternalLink>
              </>
            ) : undefined
          }
        >
          <ActionForm action={updateAsset.bind(null, asset.id)} submitLabel="Salvar alterações" pendingLabel="Salvando…">
            <AssetFields asset={asset} />
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function ClawbackForm({ assetId, holder, max }: { assetId: string; holder: string; max: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer select-none text-danger">Clawback</summary>
      <div className="mt-2 w-64 rounded-lg border border-line bg-white p-3">
        <ActionForm action={clawbackHolder.bind(null, assetId)} submitLabel="Executar clawback" variant="danger">
          <input type="hidden" name="holder" value={holder} />
          <Field label="Quantidade" hint={`Saldo: ${formatQuantity(max)}`}>
            <input name="amount" required inputMode="decimal" defaultValue={plainDecimal(max)} className={inputClass} />
          </Field>
        </ActionForm>
      </div>
    </details>
  );
}
