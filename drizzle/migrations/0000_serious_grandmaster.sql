CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('no_data', 'active');--> statement-breakpoint
CREATE TYPE "public"."share_status" AS ENUM('pending', 'accepted', 'declined', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."sync_source" AS ENUM('csv_upload', 'cron', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'posted', 'review');--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"workspace_id" text,
	"role" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "core"."account_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_account_id" text NOT NULL,
	"shared_by_id" text NOT NULL,
	"shared_with_id" text NOT NULL,
	"status" "share_status" DEFAULT 'pending' NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "core"."bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"display_name" text NOT NULL,
	"institution_name" text NOT NULL,
	"bank_profile_id" text NOT NULL,
	"iban_last4" text NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"current_balance" numeric(15, 4) DEFAULT '0' NOT NULL,
	"status" "account_status" DEFAULT 'no_data' NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."categories" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#6b7280' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."csv_column_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"column_key" text NOT NULL,
	"column_label" text NOT NULL,
	"sort_order" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."csv_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"filename" text NOT NULL,
	"bank_profile_id" text NOT NULL,
	"row_count" integer NOT NULL,
	"imported_count" integer NOT NULL,
	"duplicate_count" integer NOT NULL,
	"flagged_count" integer NOT NULL,
	"status_updates" integer DEFAULT 0 NOT NULL,
	"opening_balance" numeric(15, 4),
	"date_range_from" timestamp,
	"date_range_to" timestamp,
	"uploaded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."invites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "core"."transaction_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"user_id" text NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"bank_account_id" text NOT NULL,
	"csv_upload_id" text,
	"external_id" text,
	"booking_date" timestamp NOT NULL,
	"value_date" timestamp,
	"amount" numeric(15, 4) NOT NULL,
	"currency" text NOT NULL,
	"amount_eur" numeric(15, 4),
	"amount_original" numeric(15, 4),
	"currency_original" text,
	"description" text NOT NULL,
	"creditor_name" text,
	"debtor_name" text,
	"category" text,
	"category_confidence" numeric(4, 3),
	"category_override" text,
	"category_override_by_id" text,
	"notes" text,
	"city" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"is_transfer" boolean DEFAULT false NOT NULL,
	"transfer_counterpart_id" text,
	"transfer_linked_by_id" text,
	"transfer_linked_at" timestamp,
	"is_opening_balance" boolean DEFAULT false NOT NULL,
	"payer_user_id" text NOT NULL,
	"status" "transaction_status" DEFAULT 'posted' NOT NULL,
	"sync_source" "sync_source" DEFAULT 'csv_upload' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."account_shares" ADD CONSTRAINT "account_shares_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."bank_accounts" ADD CONSTRAINT "bank_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "core"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."categories" ADD CONSTRAINT "categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "core"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."csv_column_mappings" ADD CONSTRAINT "csv_column_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "core"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."csv_uploads" ADD CONSTRAINT "csv_uploads_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."invites" ADD CONSTRAINT "invites_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "core"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."transaction_overrides" ADD CONSTRAINT "transaction_overrides_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "core"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "core"."bank_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."transactions" ADD CONSTRAINT "transactions_csv_upload_id_csv_uploads_id_fk" FOREIGN KEY ("csv_upload_id") REFERENCES "core"."csv_uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tx_override_user_idx" ON "core"."transaction_overrides" USING btree ("transaction_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_dedup_idx" ON "core"."transactions" USING btree ("bank_account_id","external_id");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "core"."transactions" USING btree ("bank_account_id","booking_date");--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "core"."transactions" USING btree ("transfer_counterpart_id");