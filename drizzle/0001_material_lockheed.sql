ALTER TABLE "payments" ADD COLUMN "settled_on" date;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "settlement_ref" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "record" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "record_hash" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "registry_tx_hash" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "registry_tx_expires_at" timestamp with time zone;