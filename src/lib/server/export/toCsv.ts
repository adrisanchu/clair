import Papa from 'papaparse';
import type { ExportTxRow } from '$lib/server/db/queries.js';

/**
 * Column headers, in order, for the exported CSV.
 *
 * Every header (except `Account`) is a synonym the adaptive parser recognises
 * (see SEMANTIC_SYNONYMS in parsers/detector.ts), so a re-imported export is
 * mapped back to the right fields. `Account` is intentionally not a parser field:
 * it is human-readable context only and is ignored on re-import.
 *
 * `Id` carries the internal transaction id. It is optional on re-import: when the
 * user keeps it, the dedup engine matches on it exactly (even for identical bank
 * rows); when they delete it, the file still re-imports via the date+amount+
 * description baseline key.
 */
export const EXPORT_HEADERS = [
	'Id',
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
 * - Category → effective value: human override, else raw bank value, else AI guess,
 *   matching what the /transactions page shows.
 */
export function toCsv(rows: ExportTxRow[]): string {
	const records = rows.map((r) => ({
		Id: r.id,
		Date: toIsoDateUTC(r.accountingDate),
		Amount: String(r.amount),
		Description: r.description,
		Currency: r.currency,
		Account: r.accountName ?? '',
		Category: r.categoryOverride ?? r.category ?? r.categoryAI ?? '',
		Notes: r.notes ?? '',
		City: r.city ?? ''
	}));

	return Papa.unparse({ fields: [...EXPORT_HEADERS], data: records }, { newline: '\r\n' });
}
