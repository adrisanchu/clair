CREATE TYPE "public"."account_type" AS ENUM('bank', 'cash');--> statement-breakpoint
ALTER TABLE "core"."bank_accounts" ALTER COLUMN "bank_profile_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."bank_accounts" ALTER COLUMN "iban_last4" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."bank_accounts" ADD COLUMN "account_type" "account_type" DEFAULT 'bank' NOT NULL;