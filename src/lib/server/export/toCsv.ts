import Papa from 'papaparse';
import type { ExportTxRow } from '$lib/server/db/queries.js';

/**
 * Column headers, in order, for the exported CSV.
 *
 * Every header (except `Account`) is a synonym the adaptive parser recognises
 * (see SEMANTIC_SYNONYMS in parsers/detector.ts), so a re-imported export is
 * mapped back to the right fields. `Account` is intentionally not a parser field:
 * it is human-readable context only and is ignored on re-import.
 */
export const EXPORT_HEADERS = [
	'Date',
	'Amount',
	'Description',
	'Currency',
	'Account',
	'Category',
	'Notes',
	'City'
] as const;

/**
 * Format a Date as `yyyy-MM-dd` using its UTC parts.
 *
 * accountingDate is stored at UTC midnight; formatting via UTC (not local time)
 * keeps the exported date identical to the stored value regardless of the server's
 * timezone, which is what the dedup engine matches on re-import.
 */
function toIsoDateUTC(d: Date): string {
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(d.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

/**
 * Serialise export rows to a round-trip-safe CSV string.
 *
 * - Date → `yyyy-MM-dd` (UTC), a format the parser recognises and the dedup keys on.
 * - Amount → plain dot-decimal, no thousands separators (parseAmount-friendly).
 * - Category → effective value: user override takes precedence over the AI tag,
 *   matching what the /transactions page shows.
 */
export function toCsv(rows: ExportTxRow[]): string {
	const records = rows.map((r) => ({
		Date: toIsoDateUTC(r.accountingDate),
		Amount: String(r.amount),
		Description: r.description,
		Currency: r.currency,
		Account: r.accountName ?? '',
		Category: r.categoryOverride ?? r.category ?? '',
		Notes: r.notes ?? '',
		City: r.city ?? ''
	}));

	return Papa.unparse({ fields: [...EXPORT_HEADERS], data: records }, { newline: '\r\n' });
}
