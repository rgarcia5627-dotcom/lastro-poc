import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** "client" is the representative of an institutional investor (Lastro has no retail investors). */
export type Role = "admin" | "client";
export type OrgType =
  | "gestora"
  | "fundo"
  | "family_office"
  | "plataforma"
  | "banco"
  | "seguradora_previdencia"
  | "nao_residente";
export type KycStatus = "pending" | "approved" | "rejected";
export type AssetKind = "CR" | "CCB" | "CRI" | "CRA" | "DEBENTURE" | "PRECATORIO" | "OUTRO";
export type AssetStatus = "draft" | "tokenizing" | "tokenized";
/**
 * Structuring loop: Lastro proposes scenarios → the institution edits one and sends it back →
 * Lastro confirms with its client (the borrower) and closes.
 */
export type ProposalStatus =
  | "with_institution" // Lastro sent scenarios; the institution picks and edits one
  | "with_lastro" // the institution sent its version back
  | "closed" // confirmed with the borrower; terms written to the asset
  | "cancelled";
export type ScenarioAuthor = "lastro" | "institution";
export type Amortization = "bullet" | "sac" | "price";
export type AllocationStatus =
  | "pending" // waiting for the client to accept (create the trustline)
  | "accepted" // trustline exists, waiting for Lastro to transfer
  | "transferring" // transfer submitted, outcome not yet confirmed
  | "transferred"
  | "declined"
  | "cancelled";
export type PaymentKind = "juros" | "amortizacao" | "juros_amortizacao";
export type PaymentStatus =
  | "scheduled"
  | "snapshotted" // holder list closed from on-chain balances (record date); paying agent pays off-chain
  | "registering" // settlement informed; on-chain registry submitted, outcome not yet confirmed
  | "paid"; // paid off-chain and registered on Stellar
export type PendingTxKind = "create_wallet" | "trustline";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    /** KYB of the institution (the column keeps its original name). */
    kycStatus: text("kyc_status").$type<KycStatus>().notNull().default("pending"),
    orgName: text("org_name"),
    orgTaxId: text("org_tax_id"), // CNPJ, or the foreign registration of a non-resident
    orgType: text("org_type").$type<OrgType>(),
    /** When the representative declared the institution a professional investor. */
    professionalDeclaredAt: timestamp("professional_declared_at", { withTimezone: true }),
    stellarAddress: text("stellar_address"),
    /** The passkey whose PRF output derives this client's Stellar key. */
    walletCredentialId: text("wallet_credential_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_stellar_address_idx").on(t.stellarAddress),
  ],
);

export const credentials = pgTable(
  "credentials",
  {
    id: text("id").primaryKey(), // base64url credential id
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(), // base64url COSE public key
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: jsonb("transports").$type<string[]>().notNull().default([]),
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("credentials_user_idx").on(t.userId)],
);

export const adminInvites = pgTable("admin_invites", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(), // Stellar asset code, 1–12 alphanumeric
    name: text("name").notNull(),
    kind: text("kind").$type<AssetKind>().notNull(),
    issuerName: text("issuer_name").notNull(), // emissor / devedor
    description: text("description"),
    totalVolume: numeric("total_volume", { precision: 20, scale: 2 }).notNull(), // R$
    tokenSupply: numeric("token_supply", { precision: 20, scale: 7 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 20, scale: 8 }).notNull(), // PU inicial, R$
    remuneration: text("remuneration"),
    issueDate: date("issue_date"),
    maturityDate: date("maturity_date"),
    paymentFrequency: text("payment_frequency"),
    documentsUrl: text("documents_url"),
    status: text("status").$type<AssetStatus>().notNull().default("draft"),
    tokenizeTxHash: text("tokenize_tx_hash"),
    tokenizeTxExpiresAt: timestamp("tokenize_tx_expires_at", { withTimezone: true }),
    tokenizedAt: timestamp("tokenized_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("assets_code_idx").on(t.code)],
);

export const assetPrices = pgTable(
  "asset_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    price: numeric("price", { precision: 20, scale: 8 }).notNull(),
    refDate: date("ref_date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("asset_prices_asset_idx").on(t.assetId, t.refDate)],
);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").$type<ProposalStatus>().notNull().default("with_institution"),
    round: integer("round").notNull().default(1),
    agreedScenarioId: uuid("agreed_scenario_id"),
    /** Token quantity the institution takes: agreed ticket ÷ PU, fixed at closing. */
    committedQuantity: numeric("committed_quantity", { precision: 20, scale: 7 }),
    /** How Lastro confirmed the agreed scenario with its client (the borrower). */
    clientConfirmation: text("client_confirmation"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("proposals_asset_idx").on(t.assetId), index("proposals_user_idx").on(t.userId)],
);

/** One structure option. Every round adds scenarios; nothing is edited in place. */
export const proposalScenarios = pgTable(
  "proposal_scenarios",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    round: integer("round").notNull(),
    author: text("author").$type<ScenarioAuthor>().notNull(),
    label: text("label").notNull(),
    /** The scenario this one was edited from (institution versions and Lastro revisions). */
    basedOnId: uuid("based_on_id"),
    ticket: numeric("ticket", { precision: 20, scale: 2 }).notNull(), // R$
    remuneration: text("remuneration").notNull(),
    termMonths: integer("term_months").notNull(),
    graceMonths: integer("grace_months").notNull().default(0),
    amortization: text("amortization").$type<Amortization>().notNull(),
    /** Discount on face value, in % (the institution pays ticket × (1 − discount)). */
    discount: numeric("discount", { precision: 5, scale: 2 }).notNull().default("0"),
    /** Fee design, e.g. "estruturação 1,5% paga pelo cedente". */
    fees: text("fees"),
    /** Mezzanine / subordinated risk allocation, e.g. "subordinada de 20% retida pelo cedente". */
    subordination: text("subordination"),
    /** Embedded collateral (column kept as `guarantees`). */
    guarantees: text("guarantees"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("proposal_scenarios_proposal_idx").on(t.proposalId, t.round)],
);

export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amount: numeric("amount", { precision: 20, scale: 7 }).notNull(),
    /** The closed proposal this delivery comes from. */
    proposalId: uuid("proposal_id").references(() => proposals.id, { onDelete: "restrict" }),
    status: text("status").$type<AllocationStatus>().notNull().default("pending"),
    trustlineTxHash: text("trustline_tx_hash"),
    transferTxHash: text("transfer_tx_hash"),
    transferTxExpiresAt: timestamp("transfer_tx_expires_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    transferredAt: timestamp("transferred_at", { withTimezone: true }),
  },
  (t) => [
    index("allocations_user_idx").on(t.userId),
    index("allocations_asset_idx").on(t.assetId),
    // One live delivery per closed proposal (guards double clicks); a cancelled or declined one can be redone.
    uniqueIndex("allocations_proposal_live_idx")
      .on(t.proposalId)
      .where(sql`${t.status} not in ('cancelled', 'declined')`),
  ],
);

/**
 * Transactions built by the server for a client to sign with their passkey wallet.
 * The server only co-signs a signed envelope whose hash matches a row here, so the
 * client can never make the operator account sign anything else.
 */
export const pendingTxs = pgTable(
  "pending_txs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<PendingTxKind>().notNull(),
    refId: text("ref_id"),
    signer: text("signer").notNull(), // client G-address that must sign
    txHash: text("tx_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pending_txs_hash_idx").on(t.txHash)],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "restrict" }),
    dueDate: date("due_date").notNull(),
    kind: text("kind").$type<PaymentKind>().notNull(),
    amountPerToken: numeric("amount_per_token", { precision: 20, scale: 8 }).notNull(), // R$
    status: text("status").$type<PaymentStatus>().notNull().default("scheduled"),
    /** When the registry landed on Stellar. */
    paidAt: timestamp("paid_at", { withTimezone: true }),
    notes: text("notes"),
    /** Record date: when the holder list was closed from on-chain balances. */
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
    /** The off-chain settlement (BRL), as informed by Lastro when registering it. */
    settledOn: date("settled_on"),
    settlementRef: text("settlement_ref"),
    /** Canonical JSON of the payment record; its SHA-256 is registered on Stellar. */
    record: text("record"),
    recordHash: text("record_hash"),
    registryTxHash: text("registry_tx_hash"),
    registryTxExpiresAt: timestamp("registry_tx_expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("payments_asset_idx").on(t.assetId, t.dueDate)],
);

/** Per-holder amounts, from on-chain balances when the payment's holder list is closed. */
export const paymentItems = pgTable(
  "payment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    stellarAddress: text("stellar_address").notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 7 }).notNull(),
    amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  },
  (t) => [index("payment_items_payment_idx").on(t.paymentId), index("payment_items_user_idx").on(t.userId)],
);

export const activity = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    assetId: uuid("asset_id").references(() => assets.id),
    subjectUserId: uuid("subject_user_id").references(() => users.id),
    txHash: text("tx_hash"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_created_idx").on(t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type ScenarioRow = typeof proposalScenarios.$inferSelect;
export type AllocationRow = typeof allocations.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
