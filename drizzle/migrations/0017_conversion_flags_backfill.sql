-- Data-only backfill (no schema change). Two idempotent, safe UPDATEs.

-- 1. A conversion leg is not a same-currency transfer. Clear the overloaded transfer
--    flag/link on any settled conversion leg so the two facets are mutually exclusive
--    (reporting now excludes conversions via conversion_counterpart_id, not is_transfer).
UPDATE "core"."transactions"
SET "is_transfer" = false, "transfer_counterpart_id" = NULL
WHERE "conversion_counterpart_id" IS NOT NULL AND "is_transfer" = true;
--> statement-breakpoint
-- 2. Re-flag pre-detection rows whose description names a currency exchange so the
--    conversion detectors can see them (rows imported before is_fx_candidate existed).
--    Skips rows the user opted out of auto-detection.
UPDATE "core"."transactions"
SET "is_fx_candidate" = true
WHERE "is_fx_candidate" = false
  AND "fx_detection_excluded" = false
  AND "description" ~* 'conversi[oó]n a|exchanged to|cambio de divisas?';
