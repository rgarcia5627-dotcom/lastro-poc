import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import postgres from "postgres";
import { E2E_BASE_URL, E2E_DATABASE_URL } from "../../playwright.config";

/** Fresh database + a one-time admin invite for the run. */
export default async function globalSetup() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // optional
    }
  }
  if (!process.env.LASTRO_ISSUER_SECRET || !process.env.LASTRO_OPERATOR_SECRET) {
    throw new Error("Testnet keys missing: run `pnpm stellar:setup` first.");
  }
  if (process.env.STELLAR_NETWORK === "public") throw new Error("E2E tests only run on testnet.");

  process.env.DATABASE_URL = E2E_DATABASE_URL;
  process.env.APP_ORIGIN = E2E_BASE_URL;

  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  await sql.unsafe(
    "TRUNCATE activity, payment_items, payments, pending_txs, allocations, proposal_scenarios, proposals, asset_prices, assets, admin_invites, credentials, users CASCADE",
  );
  // Same scheme as src/lib/invites.ts (sha256 of the token is stored, never the token).
  const token = randomBytes(24).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await sql`insert into admin_invites (token_hash, email, expires_at) values (${tokenHash}, 'ana@lastro.test', now() + interval '1 hour')`;
  await sql.end();
  process.env.E2E_ADMIN_INVITE = token;

  mkdirSync(process.env.E2E_SCREENSHOTS ?? "scf-submission/screenshots", { recursive: true });
}
