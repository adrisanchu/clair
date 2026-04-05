CREATE TYPE "public"."conversion_confidence" AS ENUM('auto', 'confirmed', 'manual');--> statement-breakpoint
CREATE TABLE "core"."currency_conversions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"from_account_id" text NOT NULL,
	"to_account_id" text NOT NULL,
	"from_amount" numeric(18, 4) NOT NULL,
	"to_amount" numeric(18, 4) NOT NULL,
	"exchange_rate" numeric(14, 6) NOT NULL,
	"effective_from" timestamp NOT NULL,
	"confidence" "conversion_confidence" DEFAULT 'auto' NOT NULL,
	"from_transaction_id" text,
	"to_transaction_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "is_fx_candidate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "conversion_id" text;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "exchange_rate" numeric(14, 6);--> statement-breakpoint
ALTER TABLE "core"."currency_conversions" ADD CONSTRAINT "currency_conversions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "core"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."currency_conversions" ADD CONSTRAINT "currency_conversions_from_account_id_bank_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."currency_conversions" ADD CONSTRAINT "currency_conversions_to_account_id_bank_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "currency_conversions_to_account_idx" ON "core"."currency_conversions" USING btree ("to_account_id","effective_from");--> statement-breakpoint
CREATE INDEX "transactions_conversion_idx" ON "core"."transactions" USING btree ("conversion_id");