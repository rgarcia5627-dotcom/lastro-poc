CREATE TABLE "activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"asset_id" uuid,
	"subject_user_id" uuid,
	"tx_hash" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_invites" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(20, 7) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trustline_tx_hash" text,
	"transfer_tx_hash" text,
	"transfer_tx_expires_at" timestamp with time zone,
	"last_error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"transferred_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "asset_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"price" numeric(20, 8) NOT NULL,
	"ref_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"issuer_name" text NOT NULL,
	"description" text,
	"total_volume" numeric(20, 2) NOT NULL,
	"token_supply" numeric(20, 7) NOT NULL,
	"unit_price" numeric(20, 8) NOT NULL,
	"remuneration" text,
	"issue_date" date,
	"maturity_date" date,
	"payment_frequency" text,
	"documents_url" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"tokenize_tx_hash" text,
	"tokenize_tx_expires_at" timestamp with time zone,
	"tokenized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"min_investment" numeric(20, 2),
	"offered_volume" numeric(20, 2) NOT NULL,
	"starts_at" date,
	"ends_at" date,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"user_id" uuid,
	"stellar_address" text NOT NULL,
	"quantity" numeric(20, 7) NOT NULL,
	"amount" numeric(20, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"due_date" date NOT NULL,
	"kind" text NOT NULL,
	"amount_per_token" numeric(20, 8) NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"paid_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_txs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text,
	"signer" text NOT NULL,
	"tx_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"kyc_status" text DEFAULT 'pending' NOT NULL,
	"stellar_address" text,
	"wallet_credential_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_prices" ADD CONSTRAINT "asset_prices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_items" ADD CONSTRAINT "payment_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_txs" ADD CONSTRAINT "pending_txs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_created_idx" ON "activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "allocations_user_idx" ON "allocations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "allocations_asset_idx" ON "allocations" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "asset_prices_asset_idx" ON "asset_prices" USING btree ("asset_id","ref_date");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_code_idx" ON "assets" USING btree ("code");--> statement-breakpoint
CREATE INDEX "credentials_user_idx" ON "credentials" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "offers_asset_idx" ON "offers" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "payment_items_payment_idx" ON "payment_items" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_items_user_idx" ON "payment_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payments_asset_idx" ON "payments" USING btree ("asset_id","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "pending_txs_hash_idx" ON "pending_txs" USING btree ("tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_stellar_address_idx" ON "users" USING btree ("stellar_address");