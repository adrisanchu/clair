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

/**
 * Description wording that identifies a currency-exchange leg, as a Postgres POSIX
 * regex (used with `~*` in the conversion detectors). This is the query-time twin of
 * each parser's `fxCandidateDescriptionPattern` — it lets detection recognise a
 * conversion from its description even when `isFxCandidate` was never set at parse
 * time (rows imported before the flag existed, or from a profile without a type
 * column). Keep in sync with the profile regexes (which additionally use JS `\b`
 * boundaries that POSIX `~*` does not need here).
 */
export const FX_DESCRIPTION_SQL_PATTERN = 'conversi[oó]n a|exchanged to|cambio de divisas?';

/**
 * Description wording that identifies a cash withdrawal from a bank account (ATM /
 * over-the-counter). These rows are flagged as transfer candidates at import time so
 * they surface for pairing with a matching deposit in a manual cash account (issue #68).
 * Applied on top of each profile's `transferTypes`, so it works even for banks that
 * export no type column (e.g. Bankinter). Case- and accent-insensitive at the call site.
 */
export const ATM_WITHDRAWAL_PATTERN =
	/extracto en cajero|retirada de efectivo|disposici[oó]n de efectivo|reintegro cajero|cash withdrawal|atm withdrawal/i;
