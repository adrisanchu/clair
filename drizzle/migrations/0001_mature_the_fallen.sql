ALTER TABLE "core"."transactions" RENAME COLUMN "booking_date" TO "accounting_date";--> statement-breakpoint
DROP INDEX "core"."transactions_date_idx";--> statement-breakpoint
CREATE INDEX "transactions_accounting_date_idx" ON "core"."transactions" USING btree ("bank_account_id","accounting_date");