import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import Link from "next/link";
import { ActionButton } from "@/components/action-form";
import { Badge, Card, EmptyState, ExternalLink, Notice, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { ACTIVITY_LABELS } from "@/lib/activity";
import { transferAllocation } from "@/lib/actions/allocations";
import { db } from "@/lib/db";
import { activity, allocations, assets, payments, proposals, users } from "@/lib/db/schema";
import { formatBRL, formatDate, formatDateTime, formatQuantity, todayISO } from "@/lib/format";
import { PAYMENT_STATUS, paymentKindLabel } from "@/lib/labels";
import { safeChain } from "@/lib/queries";
import { explorerAccountUrl, explorerTxUrl } from "@/lib/stellar/config";
import { lastroHealth } from "@/lib/stellar/horizon";

export const metadata = { title: "Visão geral" };

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async function AdminHome() {
  const today = todayISO();
  const [assetRows, clientRows, withLastro, readyRows, upcoming, recent, health] = await Promise.all([
    db().select({ status: assets.status }).from(assets),
    db().select({ kyc: users.kycStatus, wallet: users.stellarAddress }).from(users).where(eq(users.role, "client")),
    db().select({ id: proposals.id }).from(proposals).where(eq(proposals.status, "with_lastro")),
    db()
      .select({ allocation: allocations, asset: assets, client: users })
      .from(allocations)
      .innerJoin(assets, eq(assets.id, allocations.assetId))
      .innerJoin(users, eq(users.id, allocations.userId))
      .where(eq(allocations.status, "accepted"))
      .orderBy(asc(allocations.acceptedAt)),
    db()
      .select({ payment: payments, asset: assets })
      .from(payments)
      .innerJoin(assets, eq(assets.id, payments.assetId))
      .where(
        and(
          inArray(payments.status, ["scheduled", "snapshotted", "registering"]),
          lte(payments.dueDate, addDays(today, 45)),
          gte(payments.dueDate, addDays(today, -365)),
        ),
      )
      .orderBy(asc(payments.dueDate))
      .limit(10),
    db()
      .select({ entry: activity, asset: assets, subject: users })
      .from(activity)
      .leftJoin(assets, eq(assets.id, activity.assetId))
      .leftJoin(users, eq(users.id, activity.subjectUserId))
      .orderBy(desc(activity.createdAt))
      .limit(12),
    safeChain(lastroHealth),
  ]);

  const tokenized = assetRows.filter((a) => a.status === "tokenized").length;
  const pendingKyc = clientRows.filter((c) => c.kyc === "pending").length;
  const operatorXlm = health.data?.operator.xlm ? Number(health.data.operator.xlm) : null;

  return (
    <>
      <PageHeader title="Visão geral" description="Operações, instituições, transferências e pagamentos da Lastro." />

      {health.error && <Notice tone="danger">{health.error}</Notice>}
      {health.data && (!health.data.issuer.exists || !health.data.issuer.flagsOk) && (
        <Notice tone="danger">
          A conta emissora ainda não está configurada com as flags de autorização. Rode <code>pnpm stellar:setup</code>.
        </Notice>
      )}
      {operatorXlm !== null && operatorXlm < 20 && (
        <div className="mt-3">
          <Notice tone="warn">
            A conta operadora tem {formatQuantity(operatorXlm)} XLM. Ela paga as taxas e as reservas das carteiras das instituições. Recarregue antes que acabe.
          </Notice>
        </div>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ativos tokenizados" value={tokenized} hint={`${assetRows.length} cadastrados`} />
        <Stat label="Instituições" value={clientRows.length} hint={pendingKyc ? `${pendingKyc} com KYB pendente` : "KYB em dia"} />
        <Stat
          label="Propostas com a Lastro"
          value={<Link href="/admin/propostas" className="hover:underline">{withLastro.length}</Link>}
          hint="A instituição respondeu; falta confirmar com o cliente"
        />
        <Stat
          label="Conta operadora"
          value={operatorXlm === null ? "—" : `${formatQuantity(operatorXlm.toFixed(2))} XLM`}
          hint={health.data ? `${health.data.operator.sponsoring} reservas patrocinadas` : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Prontos para transferir" description="A instituição aceitou (criou a trustline). Falta a Lastro enviar.">
          {readyRows.length === 0 ? (
            <EmptyState>Nenhuma transferência aguardando envio.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {readyRows.map(({ allocation, asset, client }) => (
                <li key={allocation.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="text-sm">
                    <div className="font-medium">
                      {formatQuantity(allocation.amount)} {asset.code} → {client.orgName ?? client.name}
                    </div>
                    {allocation.lastError && <div className="text-xs text-danger">{allocation.lastError}</div>}
                  </div>
                  <ActionButton
                    action={transferAllocation.bind(null, allocation.id)}
                    label="Transferir"
                    pendingLabel="Enviando…"
                    confirm="Enviar agora?"
                    variant="primary"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Próximos pagamentos" description="Agendados para os próximos 45 dias ou em atraso, até serem registrados na Stellar.">
          {upcoming.length === 0 ? (
            <EmptyState>Nenhum pagamento previsto.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map(({ payment, asset }) => (
                <li key={payment.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <Link href={`/admin/ativos/${asset.id}`} className="font-medium hover:underline">
                      {asset.code}
                    </Link>{" "}
                    · {paymentKindLabel(payment.kind)} · {formatBRL(payment.amountPerToken)}/token
                  </div>
                  <div className="flex items-center gap-2">
                    {payment.status !== "scheduled" && <StatusBadge map={PAYMENT_STATUS} value={payment.status} />}
                    {payment.dueDate < today && <Badge tone="danger">Atrasado</Badge>}
                    <span className="tabular-nums">{formatDate(payment.dueDate)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Atividade recente">
          {recent.length === 0 ? (
            <EmptyState>Sem atividade ainda.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Evento</Th>
                  <Th>Ativo</Th>
                  <Th>Instituição</Th>
                  <Th>Transação</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map(({ entry, asset, subject }) => (
                  <tr key={entry.id}>
                    <Td className="whitespace-nowrap text-muted">{formatDateTime(entry.createdAt)}</Td>
                    <Td>{ACTIVITY_LABELS[entry.action] ?? entry.action}</Td>
                    <Td>{asset?.code ?? "—"}</Td>
                    <Td>{subject ? (subject.orgName ?? subject.name) : "—"}</Td>
                    <Td>{entry.txHash ? <ExternalLink href={explorerTxUrl(entry.txHash)}>ver</ExternalLink> : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {health.data && (
        <p className="mt-6 text-xs text-muted">
          Emissora: <ExternalLink href={explorerAccountUrl(health.data.issuer.address)}>{health.data.issuer.address}</ExternalLink>
          <br />
          Operadora (tesouraria): <ExternalLink href={explorerAccountUrl(health.data.operator.address)}>{health.data.operator.address}</ExternalLink>
        </p>
      )}
    </>
  );
}
