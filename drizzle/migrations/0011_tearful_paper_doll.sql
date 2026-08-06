ALTER TYPE "public"."transaction_status" ADD VALUE 'reverted';--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD COLUMN "fee" numeric(15, 4) DEFAULT '0' NOT NULL;