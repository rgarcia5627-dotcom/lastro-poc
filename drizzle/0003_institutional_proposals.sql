CREATE TABLE "proposal_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"author" text NOT NULL,
	"label" text NOT NULL,
	"based_on_id" uuid,
	"ticket" numeric(20, 2) NOT NULL,
	"remuneration" text NOT NULL,
	"term_months" integer NOT NULL,
	"grace_months" integer DEFAULT 0 NOT NULL,
	"amortization" text NOT NULL,
	"guarantees" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'with_institution' NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"agreed_scenario_id" uuid,
	"committed_quantity" numeric(20, 7),
	"client_confirmation" text,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocations" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_name" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_tax_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "org_type" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "professional_declared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal_scenarios" ADD CONSTRAINT "proposal_scenarios_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_scenarios_proposal_idx" ON "proposal_scenarios" USING btree ("proposal_id","round");--> statement-breakpoint
CREATE INDEX "proposals_asset_idx" ON "proposals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "proposals_user_idx" ON "proposals" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocations_proposal_live_idx" ON "allocations" USING btree ("proposal_id") WHERE "allocations"."status" not in ('cancelled', 'declined');