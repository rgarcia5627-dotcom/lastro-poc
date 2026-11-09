import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/shell";
import { Badge, Card, cx, EmptyState, ExternalLink, Mono, Notice, Stat, Table, Td, Th } from "@/components/ui";
import { VerifyRecord } from "@/components/verify-record";
import { db } from "@/lib/db";
import { type AssetRow, assets, type PaymentKind, paymentItems, payments, proposalScenarios, proposals } from "@/lib/db/schema";
import { formatDecimal, toStroops } from "@/lib/decimal";
import { env } from "@/lib/env";
import { formatDate, shortAddress } from "@/lib/format";
import { structureSummary } from "@/lib/proposals";
import { currentPrice, latestPrices, safeChain } from "@/lib/queries";
import { explorerAccountUrl, explorerAssetUrl, explorerTxUrl, issuerKeypair, lastroAsset, operatorKeypair, stellarNetwork } from "@/lib/stellar/config";
import { lastroHealth, listHolders } from "@/lib/stellar/horizon";
import { paymentDataKey } from "@/lib/stellar/tx";

/*
 * Public, verifiable payment history of one asset: no login. It is the page a manager abroad
 * uses to diligence remotely, and the one each RWA.xyz listing links to. Every number that
 * matters can be checked against Stellar from the visitor's own browser.
 */

export const dynamic = "force-dynamic";

const T = {
  pt: {
    title: "Histórico público",
    lede: "Pagamentos deste ativo, cada um com o seu registro gravado na rede Stellar. Qualquer pessoa pode conferir: o SHA-256 do registro é igual ao memo da transação.",
    terms: "Características",
    kind: "Tipo",
    issuer: "Emissor",
    remuneration: "Remuneração",
    structure: "Estrutura",
    subordination: "Subordinação",
    collateral: "Colateral",
    maturity: "Vencimento",
    pu: "PU",
    onchain: "Na Stellar",
    token: "Token",
    issuerAccount: "Conta emissora",
    controls: "Controles do protocolo",
    controlsOk: "autorização obrigatória, revogável, clawback",
    controlsMissing: "flags de autorização ausentes",
    tokenized: "Tokenização",
    outstanding: "Em circulação",
    holders: "Carteiras autorizadas",
    paid: "Pagamentos registrados",
    paidHint: "Pagos em reais, fora da blockchain, pelo agente pagador. O registro lista cada carteira e o valor que recebeu.",
    date: "Data",
    type: "Tipo",
    perToken: "Por token",
    total: "Total",
    settled: "Liquidação",
    record: "Registro",
    check: "Conferir",
    none: "Nenhum pagamento registrado ainda.",
    upcoming: "Próximos eventos",
    upcomingNone: "Nenhum evento previsto.",
    howto: "Como conferir por conta própria",
    howtoText: "Baixe o registro, calcule o SHA-256 e compare com o memo da transação na Horizon. Os dois comandos devem imprimir o mesmo hash.",
    footer: "Dados da rede lidos da Horizon a cada visita. Página informativa; não é oferta de investimento. A Lastro atende apenas investidores profissionais.",
    kinds: { juros: "Juros", amortizacao: "Amortização", juros_amortizacao: "Juros + amortização" } as Record<PaymentKind, string>,
    status: { scheduled: "Previsto", snapshotted: "Lista fechada", registering: "Registrando", paid: "Pago" } as Record<string, string>,
    verify: {
      verify: "Verificar",
      running: "Verificando…",
      memo: "memo da transação",
      dataEntry: "data entry da emissora",
      matches: "confere",
      differs: "não confere",
      failed: "Não foi possível consultar a rede agora.",
      computed: "SHA-256 calculado no seu navegador:",
    },
  },
  en: {
    title: "Public history",
    lede: "This asset's payments, each with its record anchored on the Stellar network. Anyone can check it: the SHA-256 of the record equals the transaction memo.",
    terms: "Terms",
    kind: "Type",
    issuer: "Issuer",
    remuneration: "Coupon",
    structure: "Structure",
    subordination: "Subordination",
    collateral: "Collateral",
    maturity: "Maturity",
    pu: "Unit price",
    onchain: "On Stellar",
    token: "Token",
    issuerAccount: "Issuer account",
    controls: "Protocol controls",
    controlsOk: "authorization required, revocable, clawback",
    controlsMissing: "authorization flags missing",
    tokenized: "Tokenization",
    outstanding: "Outstanding",
    holders: "Authorized wallets",
    paid: "Registered payments",
    paidHint: "Paid in BRL, off-chain, by the paying agent. The record lists every wallet and the amount it received.",
    date: "Date",
    type: "Type",
    perToken: "Per token",
    total: "Total",
    settled: "Settlement",
    record: "Record",
    check: "Check",
    none: "No payment registered yet.",
    upcoming: "Upcoming events",
    upcomingNone: "No upcoming event.",
    howto: "Check it yourself",
    howtoText: "Download the record, hash it with SHA-256 and compare it with the transaction memo on Horizon. Both commands must print the same hash.",
    footer: "Network data read from Horizon on every visit. Information only; not an offer to invest. Lastro serves professional investors only.",
    kinds: { juros: "Interest", amortizacao: "Principal", juros_amortizacao: "Interest + principal" } as Record<PaymentKind, string>,
    status: { scheduled: "Scheduled", snapshotted: "Record date set", registering: "Registering", paid: "Paid" } as Record<string, string>,
    verify: {
      verify: "Verify",
      running: "Verifying…",
      memo: "transaction memo",
      dataEntry: "issuer data entry",
      matches: "matches",
      differs: "does not match",
      failed: "Could not reach the network right now.",
      computed: "SHA-256 computed in your browser:",
    },
  },
};
type Lang = keyof typeof T;

const KIND_EN: Record<string, string> = { CR: "CR — Receivables certificate", CCB: "CCB — Bank credit note", CRI: "CRI — Real-estate receivables", CRA: "CRA — Agribusiness receivables", DEBENTURE: "Debenture", PRECATORIO: "Court-ordered receivable", OUTRO: "Other" };

function money(lang: Lang, value: string | null, digits = 2) {
  if (value === null) return "—";
  return new Intl.NumberFormat(lang === "en" ? "en-US" : "pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: digits }).format(Number(value));
}
const qty = (lang: Lang, value: string) => new Intl.NumberFormat(lang === "en" ? "en-US" : "pt-BR", { maximumFractionDigits: 7 }).format(Number(value));
const day = (lang: Lang, value: string | null) => (lang === "en" ? (value ?? "—") : formatDate(value));

async function findAsset(code: string): Promise<AssetRow | null> {
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) return null;
  const [asset] = await db().select().from(assets).where(eq(assets.code, code.toUpperCase())).limit(1);
  return asset && asset.status === "tokenized" ? asset : null;
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }): Promise<Metadata> {
  const { code } = await params;
  return { title: `${code.toUpperCase()} · histórico público` };
}

export default async function PublicHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { code } = await params;
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "pt";
  const t = T[lang];
  const asset = await findAsset(code);
  if (!asset) notFound();

  const [paymentList, totals, prices, agreed] = await Promise.all([
    db().select().from(payments).where(eq(payments.assetId, asset.id)).orderBy(desc(payments.dueDate)),
    db()
      .select({ paymentId: paymentItems.paymentId, total: sql<string>`sum(${paymentItems.amount})` })
      .from(paymentItems)
      .innerJoin(payments, eq(payments.id, paymentItems.paymentId))
      .where(and(eq(payments.assetId, asset.id), eq(payments.status, "paid")))
      .groupBy(paymentItems.paymentId),
    latestPrices(),
    // The structure agreed with the institutions (one per series), to describe it in the page's language.
    db()
      .select({ s: proposalScenarios })
      .from(proposals)
      .innerJoin(proposalScenarios, eq(proposalScenarios.id, proposals.agreedScenarioId))
      .where(and(eq(proposals.assetId, asset.id), eq(proposals.status, "closed")))
      .limit(1),
  ]);
  const upcoming = await db()
    .select()
    .from(payments)
    .where(and(eq(payments.assetId, asset.id), inArray(payments.status, ["scheduled", "snapshotted", "registering"])))
    .orderBy(asc(payments.dueDate));
  const totalBy = new Map(totals.map((r) => [r.paymentId, r.total]));
  const paid = paymentList.filter((p) => p.status === "paid" && p.registryTxHash && p.recordHash);
  // The issuer's data entry holds the latest registered record; older ones are proven by their memo.
  const latestPaidId = [...paid].sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0]?.id;
  const pu = currentPrice(asset, prices);

  const issuer = issuerKeypair().publicKey();
  const chain = await safeChain(async () => {
    const [holders, health] = await Promise.all([listHolders(lastroAsset(asset.code)), lastroHealth()]);
    const operator = operatorKeypair().publicKey();
    const out = holders.filter((h) => h.address !== operator && toStroops(h.balance) > 0n);
    return {
      flagsOk: health.issuer.flagsOk,
      outstanding: formatDecimal(out.reduce((acc, h) => acc + toStroops(h.balance), 0n), 7),
      authorized: out.filter((h) => h.authorized).length,
    };
  });

  const horizonUrl = stellarNetwork().horizonUrl;
  const origin = env().APP_ORIGIN.replace(/\/$/, "");
  const example = paid[0];
  const terms: [string, string][] = [
    [t.kind, lang === "en" ? (KIND_EN[asset.kind] ?? asset.kind) : asset.kind],
    [t.issuer, asset.issuerName],
    [t.remuneration, asset.remuneration ?? "—"],
    [t.structure, agreed[0] ? structureSummary(agreed[0].s, lang) : (asset.paymentFrequency ?? "—")],
    ...(agreed[0]?.s.subordination ? [[t.subordination, agreed[0].s.subordination] as [string, string]] : []),
    ...(agreed[0]?.s.guarantees ? [[t.collateral, agreed[0].s.guarantees] as [string, string]] : []),
    [t.maturity, day(lang, asset.maturityDate)],
    [t.pu, `${money(lang, pu.price, 8)} (${day(lang, pu.refDate)})`],
  ];

  return (
    <div className="min-h-dvh">
      <header className="bg-ink">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <Wordmark dark href={`/historico/${asset.code}${lang === "en" ? "?lang=en" : ""}`} />
            <span className="rounded bg-brand/20 px-1.5 py-0.5 text-[11px] font-medium text-brand">{t.title}</span>
          </div>
          <nav className="ml-auto flex gap-1 text-sm" aria-label="Idioma / Language">
            {(["pt", "en"] as const).map((l) => (
              <Link
                key={l}
                href={l === "en" ? `/historico/${asset.code}?lang=en` : `/historico/${asset.code}`}
                aria-current={l === lang ? "page" : undefined}
                className={cx("rounded-md px-2.5 py-1", l === lang ? "bg-white/10 text-white" : "text-white/65 hover:text-white")}
              >
                {l.toUpperCase()}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {asset.name}
            <Badge tone="brand">{asset.code}</Badge>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t.lede}</p>
        </div>

        {chain.error && <Notice tone="danger">{chain.error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label={t.outstanding} value={chain.data ? qty(lang, chain.data.outstanding) : "—"} hint={asset.code} />
          <Stat label={t.holders} value={chain.data ? chain.data.authorized : "—"} />
          <Stat label={t.paid} value={paid.length} hint={upcoming[0] ? `${t.upcoming}: ${day(lang, upcoming[0].dueDate)}` : undefined} />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title={t.terms}>
            <dl className="space-y-3 text-sm">
              {terms.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <dt className="text-muted">{label}</dt>
                  <dd className="text-right font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title={t.onchain}>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t.token}</dt>
                <dd className="text-right">
                  <ExternalLink href={explorerAssetUrl(asset.code)}>{asset.code}</ExternalLink>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t.issuerAccount}</dt>
                <dd className="text-right">
                  <ExternalLink href={explorerAccountUrl(issuer)}>
                    <Mono>{shortAddress(issuer)}</Mono>
                  </ExternalLink>
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{t.controls}</dt>
                <dd className="text-right font-medium">
                  {chain.data ? (chain.data.flagsOk ? `✓ ${t.controlsOk}` : t.controlsMissing) : "—"}
                </dd>
              </div>
              {asset.tokenizeTxHash && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted">{t.tokenized}</dt>
                  <dd className="text-right">
                    <ExternalLink href={explorerTxUrl(asset.tokenizeTxHash)}>
                      <Mono>{shortAddress(asset.tokenizeTxHash)}</Mono>
                    </ExternalLink>
                  </dd>
                </div>
              )}
            </dl>
          </Card>
        </div>

        <div className="mt-6">
          <Card title={t.paid} description={t.paidHint}>
            {paid.length === 0 ? (
              <EmptyState>{t.none}</EmptyState>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>{t.date}</Th>
                    <Th>{t.type}</Th>
                    <Th className="text-right">{t.perToken}</Th>
                    <Th className="text-right">{t.total}</Th>
                    <Th>{t.settled}</Th>
                    <Th>{t.record}</Th>
                    <Th>{t.check}</Th>
                  </tr>
                </thead>
                <tbody>
                  {paid.map((p) => (
                    <tr key={p.id}>
                      <Td className="tabular-nums whitespace-nowrap">{day(lang, p.dueDate)}</Td>
                      <Td>{t.kinds[p.kind]}</Td>
                      <Td className="text-right tabular-nums">{money(lang, p.amountPerToken, 8)}</Td>
                      <Td className="text-right tabular-nums">{money(lang, totalBy.get(p.id) ?? null)}</Td>
                      <Td>
                        <div className="tabular-nums">{day(lang, p.settledOn)}</div>
                        <div className="text-xs text-muted">{p.settlementRef}</div>
                      </Td>
                      <Td>
                        <span className="flex flex-col gap-0.5 whitespace-nowrap">
                          <ExternalLink href={explorerTxUrl(p.registryTxHash as string)}>
                            tx <Mono>{shortAddress(p.registryTxHash)}</Mono>
                          </ExternalLink>
                          <ExternalLink href={`/api/payments/${p.id}/record`}>JSON</ExternalLink>
                          <span className="text-xs text-muted">
                            sha256 <Mono>{shortAddress(p.recordHash)}</Mono>
                          </span>
                        </span>
                      </Td>
                      <Td className="min-w-56">
                        <VerifyRecord
                          recordUrl={`/api/payments/${p.id}/record`}
                          txHash={p.registryTxHash as string}
                          horizonUrl={horizonUrl}
                          issuer={issuer}
                          dataKey={paymentDataKey(asset.code)}
                          checkDataEntry={p.id === latestPaidId}
                          labels={t.verify}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title={t.upcoming}>
            {upcoming.length === 0 ? (
              <EmptyState>{t.upcomingNone}</EmptyState>
            ) : (
              <Table wide={false}>
                <thead>
                  <tr>
                    <Th>{t.date}</Th>
                    <Th>{t.type}</Th>
                    <Th className="text-right">{t.perToken}</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((p) => (
                    <tr key={p.id}>
                      <Td className="tabular-nums">{day(lang, p.dueDate)}</Td>
                      <Td>{t.kinds[p.kind]}</Td>
                      <Td className="text-right tabular-nums">{money(lang, p.amountPerToken, 8)}</Td>
                      <Td>{t.status[p.status]}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card title={t.howto} description={t.howtoText}>
            {example?.registryTxHash ? (
              <pre className="overflow-x-auto rounded-lg bg-ink p-3 text-xs leading-relaxed text-white/90">
                {`curl -s ${origin}/api/payments/${example.id}/record \\\n  | shasum -a 256\n\ncurl -s ${horizonUrl}/transactions/${example.registryTxHash} \\\n  | jq -r .memo | base64 -d | xxd -p -c 32`}
              </pre>
            ) : (
              <EmptyState>{t.none}</EmptyState>
            )}
          </Card>
        </div>

        <p className="mt-8 text-xs text-muted">{t.footer}</p>
      </main>
    </div>
  );
}
