/**
 * Creates (testnet) and configures Lastro's two Stellar accounts:
 *   issuer   – sets AUTH_REQUIRED | AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED
 *   operator – treasury, fee payer and reserve sponsor
 *
 *   pnpm stellar:setup            # testnet: generates keys if missing, funds via friendbot, writes .env.local
 *   STELLAR_NETWORK=public pnpm stellar:setup   # mainnet: only checks/sets issuer flags on existing, funded keys
 */
import "./_env";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import { horizon, stellarNetwork } from "../src/lib/stellar/config";
import { AccountNotFoundError, loadAccount } from "../src/lib/stellar/horizon";
import { submitTx } from "../src/lib/stellar/submit";
import { buildIssuerSetupTx } from "../src/lib/stellar/tx";

const network = process.env.STELLAR_NETWORK === "public" ? "public" : "testnet";
process.env.STELLAR_NETWORK = network;

async function friendbot(address: string) {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${encodeURIComponent(address)}`);
  if (!res.ok && res.status !== 400) throw new Error(`friendbot falhou (${res.status})`);
}

async function ensureFunded(label: string, kp: Keypair) {
  try {
    await loadAccount(kp.publicKey());
    console.log(`✓ ${label} existe: ${kp.publicKey()}`);
  } catch (err) {
    if (!(err instanceof AccountNotFoundError)) throw err;
    if (network === "public") throw new Error(`${label} ${kp.publicKey()} não existe na mainnet. Financie a conta e rode de novo.`);
    console.log(`… financiando ${label} via friendbot`);
    await friendbot(kp.publicKey());
    await loadAccount(kp.publicKey());
    console.log(`✓ ${label} criada: ${kp.publicKey()}`);
  }
}

function keyFromEnv(name: string): { kp: Keypair; generated: boolean } {
  const secret = process.env[name];
  if (secret) return { kp: Keypair.fromSecret(secret), generated: false };
  if (network === "public") throw new Error(`${name} é obrigatória na mainnet (nunca gere chaves de produção por script).`);
  return { kp: Keypair.random(), generated: true };
}

async function main() {
  // Minimal env so the shared modules can run before .env.local is complete.
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.SESSION_SECRET ??= "x".repeat(32);
  process.env.APP_ORIGIN ??= "http://localhost:3000";
  process.env.WEBAUTHN_RP_ID ??= "localhost";

  console.log(`Rede: ${network} (${stellarNetwork().horizonUrl})`);
  const issuer = keyFromEnv("LASTRO_ISSUER_SECRET");
  const operator = keyFromEnv("LASTRO_OPERATOR_SECRET");

  await ensureFunded("emissora", issuer.kp);
  await ensureFunded("operadora", operator.kp);

  const account = await loadAccount(issuer.kp.publicKey());
  const flags = account.flags;
  if (flags.auth_required && flags.auth_revocable && flags.auth_clawback_enabled) {
    console.log("✓ flags da emissora já configuradas");
  } else {
    const tx = buildIssuerSetupTx({ source: account, networkPassphrase: stellarNetwork().passphrase });
    tx.sign(issuer.kp);
    const outcome = await submitTx(tx);
    if (outcome.status !== "success") throw new Error(`setOptions falhou: ${outcome.message}`);
    console.log(`✓ flags configuradas (tx ${outcome.hash})`);
  }

  const lines: string[] = [];
  if (issuer.generated) lines.push(`LASTRO_ISSUER_SECRET=${issuer.kp.secret()}`);
  if (operator.generated) lines.push(`LASTRO_OPERATOR_SECRET=${operator.kp.secret()}`);
  if (lines.length) {
    const file = ".env.local";
    const current = existsSync(file) ? readFileSync(file, "utf8") : "";
    const fresh = lines.filter((l) => !current.includes(l.split("=")[0] + "="));
    if (fresh.length) {
      appendFileSync(file, `${current && !current.endsWith("\n") ? "\n" : ""}# Stellar ${network} — gerado por pnpm stellar:setup\n${fresh.join("\n")}\n`);
      console.log(`✓ chaves gravadas em ${file}`);
    } else {
      console.log("! .env.local já define as chaves; nada gravado. Novas chaves geradas (não salvas):");
      for (const l of lines) console.log(`  ${l}`);
    }
  }

  const native = (await horizon().loadAccount(operator.kp.publicKey())).balances.find((b) => b.asset_type === "native");
  console.log(`\nEmissora:  ${issuer.kp.publicKey()}\nOperadora: ${operator.kp.publicKey()} (${native?.balance ?? "?"} XLM)`);
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exit(1);
});
