ALTER TABLE "proposal_scenarios" ADD COLUMN "discount" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_scenarios" ADD COLUMN "fees" text;--> statement-breakpoint
ALTER TABLE "proposal_scenarios" ADD COLUMN "subordination" text;