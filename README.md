# Lastro

**Brazilian private credit, structured with institutions and issued as regulated Stellar assets, with a payment history anyone can verify.**

Lastro is an originator and structure architect, B2B only. Its buyers are institutions: asset managers, funds, family offices, investment platforms and foreign managers investing in Brazil as non-residents (4.373). It does not compete with investment platforms; it supplies them.

How a deal works in the app:
1. **Structuring.** Lastro registers the deal as a draft asset (CR, CCB, CRI, debenture, legal claim…) and proposes capital structure scenarios to an institution: ticket (face value), coupon, term, grace period, amortization, discount, fees, subordination and collateral.
2. **Negotiation.** The institution runs its own diligence, edits one scenario and sends it back. Lastro either confirms that the end client (the borrower) accepts it, and closes, or answers with a new round. Closing writes the agreed terms to the asset and fixes the institution's token quantity and subscription amount.
3. **Issuance and delivery.** Lastro tokenizes the asset as a Stellar classic asset. The institution's representative signs up with a passkey, and the same passkey derives the institution's Stellar wallet on-device. The institution accepts by opening a trustline; Lastro authorizes it and transfers from its treasury.
4. **Payments.** They are made off-chain in BRL. Lastro closes each payment's holder list from on-chain balances and registers the paid event on Stellar.
5. **Proof.** Every asset has a public history page where anyone can re-hash each payment record in the browser and check it against Horizon.

Properties:
- **No smart contracts.** Compliance uses Stellar's native issuer flags: `AUTH_REQUIRED`, `AUTH_REVOCABLE`, `AUTH_CLAWBACK_ENABLED`.
- **Professional investors only.** Sign-up requires the institution's data and a professional-investor declaration; KYB approval gates every proposal and delivery. There is no retail flow.
- **Institutions never need XLM.** Lastro sponsors account and trustline reserves (CAP-33) and pays every fee.
- **Lastro never holds keys.** Keys are derived from the passkey's WebAuthn PRF output in the browser and never stored.
- **Cash stays off-chain, every payment is on-chain and public.** The SHA-256 of each payment record (holder list, per-holder amounts, settlement reference) is written to the registry transaction's memo and to a `lastro:pay:<CODE>` data entry on the issuer account. The record itself is public at `/api/payments/<id>/record`; the public page is `/historico/<CODE>` (PT, or EN with `?lang=en`).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for flows, diagrams and the security model.

## Features

| Institution (`/app`) | Lastro admin (`/admin`) |
|---|---|
| Institutional sign-up with a passkey: institution, tax ID, type, professional-investor declaration | Invite-only admin access (passkey) |
| Stellar wallet created from the passkey (0 XLM) | KYB approval of institutions |
| Structuring proposals: pick a scenario, edit it, send it back, or decline | Register deals as draft assets; propose 1–3 scenarios per round; see the institution's edits highlighted; confirm with the client and close, or revise |
| Accept closed deals (trustline) or decline | Tokenize on Stellar; create the delivery from a closed proposal; send tokens once accepted |
| Holdings valued at the latest PU | PU history, payment schedule, holder list (CSV) for the paying agent, on-chain payment registry |
| Expected and received payments, each with its on-chain record | Holders on-chain, freeze / unfreeze, clawback, audit log, operator health |

**Public (`/historico/<CODE>`, no login):** terms, on-chain controls and outstanding supply, every registered payment with its record, registry transaction and an in-browser **Verify** check against Horizon.

## Quick start (testnet)

Requirements: Node ≥ 22, pnpm, PostgreSQL (or `docker compose up -d`).

```bash
pnpm install
cp .env.example .env.local          # set DATABASE_URL and SESSION_SECRET (openssl rand -base64 48)
pnpm stellar:setup                  # creates + funds issuer and operator on testnet, sets issuer flags, writes keys to .env.local
pnpm db:migrate
pnpm admin:invite you@lastro.com.br # prints a one-time admin signup link
pnpm dev                            # http://localhost:3000
```

Open the invite link to create the admin passkey. Institutions sign up at `/cadastro`.

Passkey wallets need a passkey provider with the **PRF** extension: iCloud Keychain (iOS 18 / macOS 15+), Google Password Manager (Chrome), Windows Hello on recent Windows 11, 1Password and most security keys.

## Tests

```bash
pnpm test            # unit tests (Vitest)
pnpm smoke:testnet   # every on-chain flow against Stellar testnet
pnpm test:e2e        # Playwright: admin, institution and an anonymous visitor in a real browser with a virtual PRF passkey, against testnet
```

The e2e suite uses a separate database (`E2E_DATABASE_URL`, default `postgres://$USER@localhost:5432/lastro_e2e`) which it truncates. Create and migrate it first:

```bash
createdb lastro_e2e && DATABASE_URL=postgres://$USER@localhost:5432/lastro_e2e pnpm db:migrate
```

## Project layout

```
src/app/(auth)       sign in, sign up, admin invite
src/app/app          institution portal
src/app/admin        back office
src/app/historico    public payment history (PT/EN) with in-browser verification
src/app/api          WebAuthn + wallet/trustline signing endpoints, public payment record, admin holder list
src/lib/stellar      transaction builders (pure), Horizon reads, submission + reconciliation
src/lib/actions      server actions (proposals, admin operations)
src/lib/proposals.ts       structuring loop: scenarios, changed fields, ticket → tokens
src/lib/payment-record.ts  canonical payment record + hash anchored on Stellar
src/lib/client       passkey wallet (browser)
scripts/             stellar:setup, admin:invite, smoke:testnet
tests/               unit + e2e
```

## Production notes

The POC keeps the issuer and operator secrets in environment variables. Before mainnet: issuer master key weight → 0 with multisig (Lastro + fiduciary agent), keys in a KMS/HSM, rate limiting on sign-up (each wallet consumes sponsored XLM reserves), an external security review, and monitoring of operator XLM. These are Tranche 1–2 deliverables in the SCF plan.

## License

[MIT](LICENSE)
