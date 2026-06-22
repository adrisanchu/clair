// ─── Confidence thresholds ────────────────────────────────────────────────────
// Used by both server-side tagging logic and client-side UI.
// ≥ HIGH  → write category directly
// ≥ LOW   → write but flag as low-confidence
// < LOW   → skip (leave uncategorised)
export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_LOW = 0.6;

// ─── Model ───────────────────────────────────────────────────────────────────
export const AI_MODEL = 'claude-haiku-4-5-20251001';

// ─── Batching ────────────────────────────────────────────────────────────────
// TAG_BATCH_SIZE controls how many transactions per AI call.
// TAG_MAX_TOKENS covers the output for a full batch: with numeric IDs (not UUIDs)
// each item costs ~10 tokens, so 50 items ≈ 500 tokens — 2048 gives safe headroom.
export const TAG_BATCH_SIZE = 50;
export const TAG_MAX_TOKENS = 2048;
