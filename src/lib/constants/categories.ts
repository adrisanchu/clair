/**
 * Category-related constants shared by the insights breakdown (server queries +
 * client transforms). Importable from both `$lib/server` and Svelte components.
 */

/**
 * Name of the canonical income category. The insights breakdown counts net spend
 * per category and excludes this one — income is not "spending" and would otherwise
 * dominate the donut with a large positive (inflow) slice.
 */
export const INCOME_CATEGORY = 'Income';

/** Bucket label for transactions whose effective category is null / unknown. */
export const UNCATEGORIZED_LABEL = 'Uncategorized';

/** How many of the top categories (by spend) the timeline pre-selects. */
export const TIMELINE_DEFAULT_SERIES = 5;
