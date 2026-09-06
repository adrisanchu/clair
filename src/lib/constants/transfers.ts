/**
 * Days before/after a transaction to consider when matching transfer / conversion
 * counterparts, both in the auto-candidate dropdown (`queryTransferCandidates`) and
 * the manual browse (`queryPairableTransactions`).
 *
 * Kept as a constant so it can later be made user-configurable from Settings.
 */
export const TRANSFER_MATCH_WINDOW_DAYS = 7;

/**
 * Days before/after a flagged foreign FX anchor to search for its EUR funding/receiving
 * leg during automatic conversion detection (`resolveForeignAnchor`).
 */
export const FX_ANCHOR_WINDOW_DAYS = 3;

/**
 * Rate-plausibility guard for automatic conversion detection. When earlier conversions
 * already exist for the same foreign currency, a new auto-match is only accepted if its
 * implied rate is within this fraction of the median known rate. Stops the anchor matcher
 * from binding a foreign exchange to an unrelated EUR row (a purchase, an ATM withdrawal),
 * which produces a wildly off rate. The first conversion in a currency has no baseline and
 * is accepted on the strength of the flagged-EUR-leg requirement alone.
 */
export const FX_RATE_TOLERANCE = 0.25;
