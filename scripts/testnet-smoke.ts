/**
 * End-to-end check of every on-chain flow against Stellar testnet, using the same
 * builders the app uses. The "client" is a random keypair standing in for a
 * passkey-derived wallet. Requires `pnpm stellar:setup` first.
 *
 *   pnpm smoke:testnet
 */
import "./_env";
import { Asset, Keypair } from "@stellar/stellar-sdk";
import { buildPaymentRecord, paymentRecordHash, serializePaymentRecord } from "../src/lib/payment-record";
import { computePaymentItems } from "../src/lib/payments";
import { explorerTxUrl, horizon, issuerKeypair, operatorKeypair, stellarNetwork } from "../src/lib/stellar/config";
import { findTrustline, lastroHealth, listHolders, loadAccount } from "../src/lib/stellar/horizon";
import { submitTx } from "../src/lib/stellar/submit";
import {
  buildClawbackTx,
  buildCreateWalletTx,
  buildPaymentRecordTx,
  buildSetAuthorizationTx,
  buildTokenizeTx,
  buildTransferTx,
  buildTrustlineTx,
  paymentDataKey,
} from "../src/lib/stellar/tx";

process.env.DATABASE_URL ??= "postgres://unused";
process.env.SESSION_SECRET ??= "x".repeat(32);
process.env.APP_ORIGIN ??= "http://localhost:3000";
process.env.WEBAUTHN_RP_ID ??= "localhost";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`asserção falhou: ${message}`);
}

async function step(name: string, run: () => Promise<string | undefined>) {
  process.stdout.write(`• ${name} … `);
  const hash = await run();
  console.log(hash ? `ok  ${explorerTxUrl(hash)}` : "ok");
}

async function send(tx: Parameters<typeof submitTx>[0]) {
  const outcome = await submitTx(tx);
  if (outcome.status !== "success") throw new Error(outcome.message);
  return outcome.hash;
}

async function main() {
  if (stellarNetwork().name !== "testnet") throw new Error("O smoke test só roda na testnet.");
  const network = stellarNetwork().passphrase;
  const issuer = issuerKeypair();
  const operator = operatorKeypair();
  const client = Keypair.random();
  const code = `SMK${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const asset = new Asset(code, issuer.publicKey());

  const health = await lastroHealth();
  assert(health.issuer.flagsOk, "flags da emissora (rode pnpm stellar:setup)");
  console.log(`Token de teste: ${code}  ·  cliente: ${client.publicKey()}\n`);

  await step(`tokenizar 1000 ${code} na tesouraria`, async () => {
    const tx = buildTokenizeTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      asset,
      amount: "1000",
      operatorHasTrustline: false,
    });
    tx.sign(operator, issuer);
    return send(tx);
  });

  await step("criar carteira do cliente (0 XLM, reservas patrocinadas)", async () => {
    const tx = buildCreateWalletTx({ source: await loadAccount(operator.publicKey()), networkPassphrase: network, client: client.publicKey() });
    tx.sign(client, operator);
    return send(tx);
  });

  await step("cliente aceita (trustline patrocinada)", async () => {
    const tx = buildTrustlineTx({ source: await loadAccount(operator.publicKey()), networkPassphrase: network, client: client.publicKey(), asset });
    tx.sign(client, operator);
    return send(tx);
  });

  await step("antes de autorizar, a transferência sem autorização falha", async () => {
    const tx = buildTransferTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      client: client.publicKey(),
      asset,
      amount: "1",
      authorize: false,
    });
    tx.sign(operator);
    const outcome = await submitTx(tx);
    assert(outcome.status === "failed", "deveria falhar sem autorização");
    return undefined;
  });

  await step("autorizar + transferir 100", async () => {
    const tx = buildTransferTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      client: client.publicKey(),
      asset,
      amount: "100",
      authorize: true,
    });
    tx.sign(operator, issuer);
    return send(tx);
  });

  await step("detentores refletem os saldos", async () => {
    const holders = await listHolders(asset);
    const c = holders.find((h) => h.address === client.publicKey());
    const t = holders.find((h) => h.address === operator.publicKey());
    assert(c?.balance === "100.0000000" && c.authorized && c.clawbackEnabled, `cliente: ${JSON.stringify(c)}`);
    assert(t?.balance === "900.0000000", `tesouraria: ${JSON.stringify(t)}`);
    const account = await loadAccount(client.publicKey());
    const native = account.balances.find((b) => b.asset_type === "native");
    assert(native?.balance === "0.0000000", "cliente segue com 0 XLM");
    return undefined;
  });

  await step("registrar on-chain um pagamento feito off-chain (memo + data entry da emissora)", async () => {
    const holders = await listHolders(asset);
    const items = computePaymentItems(holders, "12.3456", [operator.publicKey(), issuer.publicKey()]);
    assert(items.length === 1 && items[0]?.amount === "1234.56", `itens: ${JSON.stringify(items)}`);
    const record = buildPaymentRecord({
      network: stellarNetwork().name,
      asset: { code, issuer: issuer.publicKey() },
      payment: { id: crypto.randomUUID(), kind: "juros", dueDate: "2026-12-04", amountPerToken: "12.3456" },
      settlement: { date: "2026-12-04", reference: "TED 000123 (smoke)" },
      takenAt: new Date(),
      items,
    });
    const recordHash = paymentRecordHash(serializePaymentRecord(record));
    const tx = buildPaymentRecordTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      assetCode: code,
      recordHash,
    });
    tx.sign(operator, issuer);
    const hash = await send(tx);
    const onChain = await horizon().transactions().transaction(hash).call();
    assert(onChain.memo_type === "hash" && Buffer.from(onChain.memo ?? "", "base64").equals(recordHash), "memo = hash do registro");
    const data = (await loadAccount(issuer.publicKey())).data_attr[paymentDataKey(code)];
    assert(data && Buffer.from(data, "base64").equals(recordHash), "data entry da emissora = hash do registro");
    return hash;
  });

  await step("congelar detentor", async () => {
    const tx = buildSetAuthorizationTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      holder: client.publicKey(),
      asset,
      authorized: false,
    });
    tx.sign(operator, issuer);
    const hash = await send(tx);
    const line = findTrustline(await loadAccount(client.publicKey()), asset);
    assert(line && !line.is_authorized, "trustline deveria estar desautorizada");
    return hash;
  });

  await step("clawback de 10 (queimados)", async () => {
    const tx = buildClawbackTx({
      source: await loadAccount(operator.publicKey()),
      networkPassphrase: network,
      issuer: issuer.publicKey(),
      holder: client.publicKey(),
      asset,
      amount: "10",
    });
    tx.sign(operator, issuer);
    const hash = await send(tx);
    const line = findTrustline(await loadAccount(client.publicKey()), asset);
    assert(line?.balance === "90.0000000", `saldo após clawback: ${line?.balance}`);
    return hash;
  });

  console.log("\n✓ Todos os fluxos on-chain funcionaram na testnet.");
}

main().catch((err) => {
  console.error(`\n✗ ${(err as Error).message}`);
  process.exit(1);
});
