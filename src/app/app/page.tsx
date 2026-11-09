import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { ActionButton } from "@/components/action-form";
import { Badge, Card, EmptyState, ExternalLink, Mono, Notice, PageHeader, Stat, StatusBadge, Table, Td, Th } from "@/components/ui";
import { AcceptAllocationButton, CopyButton, CreateWalletButton } from "@/components/wallet-actions";
import { declineAllocation } from "@/lib/actions/allocations";
import { requireClient } from "@/lib/auth";
import { db } from "@/lib/db";
import { allocations, assets } from "@/lib/db/schema";
import { formatDecimal, parseDecimal } from "@/lib/decimal";
import { formatBRL, formatDate, formatQuantity, formatUnitPrice, positionValue } from "@/lib/format";
import { ALLOCATION_STATUS } from "@/lib/labels";
import { currentPrice, latestPrices, safeChain } from "@/lib/queries";
import { explorerAccountUrl, explorerTxUrl } from "@/lib/stellar/config";
import { lastroBalances } from "@/lib/stellar/horizon";
import { relyingParty } from "@/lib/webauthn";

export const metadata = { title: "Carteira" };

export default async function WalletPage({ searchParams }: { searchParams: Promise<{ carteira?: string }> }) {
  const user = await requireClient();
  const { carteira } = await searchParams;
  const rpId = relyingParty().rpID;

  if (!user.stellarAddress) {
    return (
      <>
        <PageHeader title={user.orgName ?? user.name} />
        <Card title="Crie a carteira Stellar da instituição" description="É nela que a instituição recebe e guarda os tokens da Lastro.">
          <div className="space-y-4 text-sm">
            {carteira === "pendente" && (
              <Notice tone="warn">O cadastro foi criado, mas a carteira ainda não. Tente de novo abaixo.</Notice>
            )}
            <p className="max-w-xl text-muted">
              A chave da carteira é gerada pela sua passkey, no seu dispositivo, e nunca é enviada à Lastro. A Lastro paga as
              taxas da rede — você não precisa de criptomoedas.
            </p>
            {user.walletCredentialId ? (
              <CreateWalletButton credentialId={user.walletCredentialId} rpId={rpId} />
            ) : (
              <Notice tone="danger">Nenhuma passkey de carteira vinculada a esta conta. Fale com a Lastro.</Notice>
            )}
          </div>
        </Card>
      </>
    );
  }

  const [rows, prices, balances] = await Promise.all([
    db()
      .select({ allocation: allocations, asset: assets })
      .from(allocations)
      .innerJoin(assets, eq(assets.id, allocations.assetId))
      .where(
        and(
          eq(allocations.userId, user.id),
          inArray(allocations.status, ["pending", "accepted", "transferring", "transferred"]),
        ),
      )
      .orderBy(desc(allocations.createdAt)),
    latestPrices(),
    safeChain(() => lastroBalances(user.stellarAddress as string)),
  ]);

  const codes = balances.data ? [...balances.data.keys()] : [];
  const heldAssets = codes.length ? await db().select().from(assets).where(inArray(assets.code, codes)) : [];
  const positions = heldAssets
    .map((asset) => {
      const line = balances.data?.get(asset.code);
      const pu = currentPrice(asset, prices);
      return line ? { asset, balance: line.balance, authorized: line.authorized, pu: pu.price, value: positionValue(line.balance, pu.price) } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p !== null && parseDecimal(p.balance, 7) > 0n);
  const total = formatDecimal(
    positions.reduce((acc, p) => acc + parseDecimal(p.value, 2), 0n),
    2,
  );

  const pending = rows.filter((r) => r.allocation.status === "pending");
  const inFlight = rows.filter((r) => r.allocation.status === "accepted" || r.allocation.status === "transferring");
  const received = rows.filter((r) => r.allocation.status === "transferred");

  return (
    <>
      <PageHeader title={user.orgName ?? user.name} description="Os tokens da instituição na rede Stellar, ao último PU informado pela Lastro." />

      {user.kycStatus !== "approved" && (
        <div className="mb-4">
          <Notice tone={user.kycStatus === "rejected" ? "danger" : "warn"}>
            {user.kycStatus === "rejected"
              ? "O cadastro da instituição não foi aprovado. Fale com a Lastro para mais informações."
              : "O cadastro da instituição está em análise (KYB). Depois da aprovação, a Lastro pode enviar propostas e tokens."}
          </Notice>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Valor total" value={balances.data ? formatBRL(total) : "—"} hint="Quantidade × PU atual" />
        <Stat label="Ativos" value={balances.data ? positions.length : "—"} />
        <div className="rounded-xl border border-line bg-white px-5 py-4">
          <div className="text-xs font-medium text-muted">Carteira Stellar da instituição</div>
          <div className="mt-1">
            <Mono>{user.stellarAddress}</Mono>
          </div>
          <div className="mt-1 flex gap-3">
            <CopyButton value={user.stellarAddress} />
            <ExternalLink href={explorerAccountUrl(user.stellarAddress)}>Ver no explorer</ExternalLink>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mt-6">
          <Card title="Aguardando seu aceite" description="Operações fechadas com a Lastro. Ao aceitar, a carteira passa a confiar neste token (trustline) e a Lastro pode enviá-lo.">
            <ul className="divide-y divide-line">
              {pending.map(({ allocation, asset }) => (
                <li key={allocation.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
                  <div className="text-sm">
                    <div className="font-medium">
                      {formatQuantity(allocation.amount)} {asset.code} · {asset.name}
                    </div>
                    <div className="mt-0.5 text-muted">
                      {asset.issuerName}
                      {asset.remuneration ? ` · ${asset.remuneration}` : ""}
                      {asset.maturityDate ? ` · vence em ${formatDate(asset.maturityDate)}` : ""}
                    </div>
                    {asset.documentsUrl && (
                      <div className="mt-1">
                        <ExternalLink href={asset.documentsUrl}>Documentos do ativo</ExternalLink>
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-2">
                    {user.kycStatus === "approved" && user.walletCredentialId ? (
                      <AcceptAllocationButton
                        allocationId={allocation.id}
                        credentialId={user.walletCredentialId}
                        rpId={rpId}
                        walletAddress={user.stellarAddress as string}
                      />
                    ) : (
                      <Badge tone="warn">KYB em análise</Badge>
                    )}
                    <ActionButton action={declineAllocation.bind(null, allocation.id)} label="Recusar" confirm="Recusar?" variant="ghost" />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-6">
        <Card title="Ativos da instituição">
          {balances.error && <Notice tone="danger">{balances.error}</Notice>}
          {balances.data && positions.length === 0 && <EmptyState>A instituição ainda não tem tokens da Lastro.</EmptyState>}
          {positions.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Ativo</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">PU</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Vencimento</Th>
                  <Th>Pagamentos</Th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.asset.id}>
                    <Td>
                      <div className="font-medium">{p.asset.name}</div>
                      <div className="text-xs text-muted">
                        {p.asset.code}
                        {!p.authorized && " · congelado"}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{formatQuantity(p.balance)}</Td>
                    <Td className="text-right tabular-nums">{formatUnitPrice(p.pu)}</Td>
                    <Td className="text-right tabular-nums font-medium">{formatBRL(p.value)}</Td>
                    <Td className="tabular-nums">{formatDate(p.asset.maturityDate)}</Td>
                    <Td>
                      <Link href={`/historico/${p.asset.code}`} className="text-brand-strong hover:underline">
                        histórico público
                      </Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {(inFlight.length > 0 || received.length > 0) && (
        <div className="mt-6">
          <Card title="Transferências">
            <Table>
              <thead>
                <tr>
                  <Th>Ativo</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th>Status</Th>
                  <Th>Transação</Th>
                </tr>
              </thead>
              <tbody>
                {[...inFlight, ...received].map(({ allocation, asset }) => (
                  <tr key={allocation.id}>
                    <Td>{asset.code}</Td>
                    <Td className="text-right tabular-nums">{formatQuantity(allocation.amount)}</Td>
                    <Td>
                      <StatusBadge map={ALLOCATION_STATUS} value={allocation.status} />
                    </Td>
                    <Td>
                      {allocation.status === "transferred" && allocation.transferTxHash ? (
                        <ExternalLink href={explorerTxUrl(allocation.transferTxHash)}>ver</ExternalLink>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </>
  );
}
