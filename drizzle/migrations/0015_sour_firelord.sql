ALTER TABLE "core"."transactions" ADD COLUMN "conversion_counterpart_id" text;
--> statement-breakpoint
-- Backfill both legs of every existing conversion from the authoritative link table.
UPDATE "core"."transactions" t
SET "conversion_counterpart_id" = c."to_transaction_id"
FROM "core"."currency_conversions" c
WHERE t."id" = c."from_transaction_id" AND c."to_transaction_id" IS NOT NULL;
--> statement-breakpoint
UPDATE "core"."transactions" t
SET "conversion_counterpart_id" = c."from_transaction_id"
FROM "core"."currency_conversions" c
WHERE t."id" = c."to_transaction_id" AND c."from_transaction_id" IS NOT NULL;