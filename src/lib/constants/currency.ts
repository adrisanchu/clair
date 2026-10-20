/** Decimal places stored for EUR valuations (`transactions.amount_eur`, numeric(15,4)). */
export const EUR_AMOUNT_DECIMALS = 4;

/** Decimal places stored for exchange rates (`exchange_rate`, numeric(14,6)). */
export const FX_RATE_DECIMALS = 6;

/** Rows written per `UPDATE … FROM (VALUES …)` statement when re-valuing an account. */
export const FX_REVALUE_BATCH_SIZE = 500;

/**
 * Foreign-unit tolerance for the cost-basis pool: a shortfall or leftover below this is
 * float noise (e.g. a final conversion that drains the account exactly), not missing units.
 */
export const FX_POOL_EPSILON = 1e-6;
