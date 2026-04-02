ALTER TABLE "core"."csv_uploads" DROP CONSTRAINT "csv_uploads_bank_account_id_bank_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."transaction_overrides" DROP CONSTRAINT "transaction_overrides_transaction_id_transactions_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."transactions" DROP CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."transactions" DROP CONSTRAINT "transactions_csv_upload_id_csv_uploads_id_fk";
--> statement-breakpoint
ALTER TABLE "core"."csv_uploads" ADD CONSTRAINT "csv_uploads_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."transaction_overrides" ADD CONSTRAINT "transaction_overrides_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "core"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD CONSTRAINT "transactions_csv_upload_id_csv_uploads_id_fk" FOREIGN KEY ("csv_upload_id") REFERENCES "core"."csv_uploads"("id") ON DELETE set null ON UPDATE no action;