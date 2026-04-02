CREATE TYPE "public"."account_visibility" AS ENUM('private', 'stats_only', 'full');--> statement-breakpoint
DROP TABLE "core"."account_shares" CASCADE;--> statement-breakpoint
ALTER TABLE "core"."bank_accounts" ADD COLUMN "visibility" "account_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "my_portion" numeric(4, 3);--> statement-breakpoint
DROP TYPE "public"."share_status";