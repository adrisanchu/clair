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
