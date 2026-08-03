ALTER TABLE "core"."transactions" ADD COLUMN "category_ai" text;
--> statement-breakpoint
-- Backfill: AI-written rows are exactly those with a confidence score. Move the
-- AI guess out of the (now raw-only) `category` column into `category_ai` and
-- clear `category` for those rows. File-provided categories (confidence NULL)
-- stay in `category` as immutable raw. The effective value
-- (override ?? category ?? category_ai) is unchanged for every existing row.
UPDATE "core"."transactions"
SET "category_ai" = "category", "category" = NULL
WHERE "category_confidence" IS NOT NULL;
