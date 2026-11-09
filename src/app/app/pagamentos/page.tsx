import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Card, EmptyState, ExternalLink, Mono, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { requireClient } from "@/lib/auth";
import { db } from "@/lib/db";
import { assets, paymentItems, payments } from "@/lib/db/schema";
import { formatDecimal, mulScaled, parseDecimal } from "@/lib/decimal";
import { formatBRL, formatDate, formatQuantity, formatUnitPrice, shortAddress } from "@/lib/format";
import { paymentKindLabel } from "@/lib/labels";
import { safeChain } from "@/lib/queries";
import { explorerTxUrl } from "@/lib/stellar/config";
import { lastroBalances } from "@/lib/stellar/horizon";

export const metadata = { title: "Pagamentos" };

export default async function ClientPaymentsPage() {
  const user = await requireClient();

  const received = await db()
    .select({ item: paymentItems, payment: payments, asset: assets })
    .from(paymentItems)
    .innerJoin(payments, eq(payments.id, paymentItems.paymentId))
    .innerJoin(assets, eq(assets.id, payments.assetId))
    .where(and(eq(paymentItems.userId, user.id), eq(payments.status, "paid")))
    .orderBy(desc(payments.dueDate));

  const balances = user.stellarAddress ? await safeChain(() => lastroBalances(user.stellarAddress as string)) : null;
  const heldCodes = balances?.data
    ? [...balances.data.entries()].filter(([, v]) => parseDecimal(v.balance, 7) > 0n).map(([code]) => code)
    : [];
  const upcoming = heldCodes.length
    ? await db()
        .select({ payment: payments, asset: assets })
        .from(payments)
        .innerJoin(assets, eq(assets.id, payments.assetId))
        .where(and(inArray(payments.status, ["scheduled", "snapshotted", "registering"]), inArray(assets.code, heldCodes)))
        .orderBy(asc(payments.dueDate))
    : [];
  // Once the holder list is closed, the amount is fixed: show it instead of an estimate.
  const fixedItems = upcoming.length
    ? await db()
        .select({ paymentId: paymentItems.paymentId, amount: paymentItems.amount, quantity: paymentItems.quantity })
        .from(paymentItems)
        .where(and(eq(paymentItems.userId, user.id), inArray(paymentItems.paymentId, upcoming.map((u) => u.payment.id))))
    : [];
  const fixedByPayment = new Map(fixedItems.map((i) => [i.paymentId, i]));

  const receivedTotal = formatDecimal(
    received.reduce((acc, r) => acc + parseDecimal(r.item.amount, 2), 0n),
    2,
  );

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Juros e amortizações dos ativos da instituição, pagos em reais pelo agente pagador. Cada pagamento tem um registro público na Stellar com quanto cada carteira recebeu, que qualquer pessoa pode conferir."
      />

      <Card title="Próximos pagamentos" description="Até a data de corte, o valor é estimado com a quantidade atual de tokens; depois dela, fica fixo.">
        {balances?.error && <Notice tone="danger">{balances.error}</Notice>}
        {upcoming.length === 0 ? (
          <EmptyState>Nenhum pagamento previsto para os ativos da instituição.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Data</Th>
                <Th>Ativo</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Por token</Th>
                <Th className="text-right">Tokens</Th>
                <Th className="text-right">Valor</Th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map(({ payment, asset }) => {
                const fixed = fixedByPayment.get(payment.id);
                const qty = fixed?.quantity ?? balances?.data?.get(asset.code)?.balance ?? "0";
                const estimate =
                  fixed?.amount ??
                  formatDecimal(mulScaled(parseDecimal(qty, 7), 7, parseDecimal(payment.amountPerToken, 8), 8, 2), 2);
                return (
                  <tr key={payment.id}>
                    <Td className="tabular-nums">{formatDate(payment.dueDate)}</Td>
                    <Td>{asset.code}</Td>
                    <Td>{paymentKindLabel(payment.kind)}</Td>
                    <Td className="text-right tabular-nums">{formatUnitPrice(payment.amountPerToken)}</Td>
                    <Td className="text-right tabular-nums">{formatQuantity(qty)}</Td>
                    <Td className="text-right tabular-nums font-medium">{formatBRL(estimate)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="mt-6">
        <Card title="Recebidos" description={received.length ? `Total: ${formatBRL(receivedTotal)}` : undefined}>
          {received.length === 0 ? (
            <EmptyState>Nenhum pagamento recebido ainda.</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Ativo</Th>
                  <Th>Tipo</Th>
                  <Th className="text-right">Tokens na data</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Registro on-chain</Th>
                </tr>
              </thead>
              <tbody>
                {received.map(({ item, payment, asset }) => (
                  <tr key={item.id}>
                    <Td className="tabular-nums">{formatDate(payment.dueDate)}</Td>
                    <Td>{asset.code}</Td>
                    <Td>{paymentKindLabel(payment.kind)}</Td>
                    <Td className="text-right tabular-nums">{formatQuantity(item.quantity)}</Td>
                    <Td className="text-right tabular-nums font-medium">{formatBRL(item.amount)}</Td>
                    <Td>
                      {payment.registryTxHash ? (
                        <span className="flex flex-wrap gap-x-3">
                          <ExternalLink href={explorerTxUrl(payment.registryTxHash)}>
                            tx <Mono>{shortAddress(payment.registryTxHash)}</Mono>
                          </ExternalLink>
                          <ExternalLink href={`/api/payments/${payment.id}/record`}>registro (JSON)</ExternalLink>
                          <ExternalLink href={`/historico/${asset.code}`}>verificar</ExternalLink>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
