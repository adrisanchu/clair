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
export const TAG_BATCH_SIZE = 50;
