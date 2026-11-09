import { desc } from "drizzle-orm";
import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { assets } from "@/lib/db/schema";
import { formatBRL, formatDate, formatQuantity, formatUnitPrice } from "@/lib/format";
import { ASSET_STATUS, assetKindLabel } from "@/lib/labels";
import { currentPrice, latestPrices } from "@/lib/queries";

export const metadata = { title: "Ativos" };

export default async function AssetsPage() {
  const [rows, prices] = await Promise.all([db().select().from(assets).orderBy(desc(assets.createdAt)), latestPrices()]);
  return (
    <>
      <PageHeader
        title="Ativos"
        description="Cadastre o ativo, revise os dados e tokenize: o token é emitido pela chave da Lastro na rede Stellar."
        actions={<LinkButton href="/admin/ativos/novo">Novo ativo</LinkButton>}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState>Nenhum ativo cadastrado.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Código</Th>
                <Th>Ativo</Th>
                <Th>Tipo</Th>
                <Th className="text-right">Volume</Th>
                <Th className="text-right">Tokens</Th>
                <Th className="text-right">PU atual</Th>
                <Th>Vencimento</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((asset) => (
                <tr key={asset.id} className="hover:bg-canvas/60">
                  <Td className="font-mono text-xs font-semibold">
                    <Link href={`/admin/ativos/${asset.id}`} className="hover:underline">
                      {asset.code}
                    </Link>
                  </Td>
                  <Td>
                    <Link href={`/admin/ativos/${asset.id}`} className="font-medium hover:underline">
                      {asset.name}
                    </Link>
                    <div className="text-xs text-muted">{asset.issuerName}</div>
                  </Td>
                  <Td>{assetKindLabel(asset.kind)}</Td>
                  <Td className="text-right tabular-nums">{formatBRL(asset.totalVolume)}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(asset.tokenSupply)}</Td>
                  <Td className="text-right tabular-nums">{formatUnitPrice(currentPrice(asset, prices).price)}</Td>
                  <Td className="tabular-nums">{formatDate(asset.maturityDate)}</Td>
                  <Td>
                    <StatusBadge map={ASSET_STATUS} value={asset.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
