ALTER TABLE "core"."currency_conversions" DROP CONSTRAINT "currency_conversions_from_account_id_bank_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."currency_conversions" DROP CONSTRAINT "currency_conversions_to_account_id_bank_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."currency_conversions" ADD CONSTRAINT "currency_conversions_from_account_id_bank_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."currency_conversions" ADD CONSTRAINT "currency_conversions_to_account_id_bank_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;