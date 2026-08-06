import { parse as parseDate, isValid } from 'date-fns';
import type { BankParserProfile, NormalizedTransaction } from './types.js';
import { SEMANTIC_SYNONYMS, ID_SYNONYMS } from './detector.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

// ─── Optional column synonym lists (re-exported from detector for backward compat) ──

export const CATEGORY_SYNONYMS = SEMANTIC_SYNONYMS.category;
export const CITY_SYNONYMS = SEMANTIC_SYNONYMS.city;
export const NOTES_SYNONYMS = SEMANTIC_SYNONYMS.notes;
export { ID_SYNONYMS };

/** Shape of the optional (non-bank) columns detected from a file's headers. */
export interface OptionalColumns {
	categoryColumn: string | null;
	cityColumn: string | null;
	notesColumn: string | null;
	idColumn: string | null;
}

/** Returns the first header that matches any synonym (case- and accent-insensitive). */
export function detectOptionalColumn(headers: string[], synonyms: string[]): string | null {
	const norm = (s: string) =>
		s
			.trim()
			.toLowerCase()
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '');
	const normSynonyms = synonyms.map(norm);
	return headers.find((h) => normSynonyms.includes(norm(h))) ?? null;
}

/** Returns all CSV header names that the profile actively consumes. */
export function getUsedColumns(profile: BankParserProfile): string[] {
	return [
		profile.dateColumn,
		profile.valueDateColumn,
		profile.amountColumn,
		profile.debitColumn,
		profile.creditColumn,
		profile.descriptionColumn,
		profile.currencyColumn,
		profile.localAmountColumn,
		profile.balanceColumn,
		profile.feeColumn,
		profile.statusColumn,
		profile.typeColumn,
		...profile.additionalColumns
	].filter((c): c is string => c !== null);
}

// ─── Row normalizer ────────────────────────────────────────────────────────

export function normalizeRow(
	raw: Record<string, string>,
	profile: BankParserProfile,
	optionalColumns: OptionalColumns = {
		categoryColumn: null,
		cityColumn: null,
		notesColumn: null,
		idColumn: null
	}
): NormalizedTransaction | null {
	const grossAmount = profile.amountColumn
		? parseAmount(raw[profile.amountColumn])
		: parseAmount(raw[profile.creditColumn!] ?? '') - parseAmount(raw[profile.debitColumn!] ?? '');

	// Fee/commission is always a cost, stored non-negative. Net effect on the balance is
	// gross − fee (uniform for income and expenses), so we fold it into `amount` at parse time.
	const fee = profile.feeColumn ? Math.abs(parseAmount(raw[profile.feeColumn] ?? '')) : 0;
	const amount = grossAmount - fee;

	const accountingDate = parseDateField(raw[profile.dateColumn], profile.dateFormat);
	if (!accountingDate) return null; // unparseable date → skip row

	const valueDate = profile.valueDateColumn
		? parseDateField(raw[profile.valueDateColumn], profile.dateFormat)
		: null;

	const status = classifyStatus(
		profile.statusColumn ? raw[profile.statusColumn]?.trim().toUpperCase() : null
	);

	const rawType = profile.typeColumn ? (raw[profile.typeColumn]?.trim() ?? null) : null;

	const runningBalanceRaw = profile.balanceColumn ? raw[profile.balanceColumn]?.trim() : null;
	const runningBalance = runningBalanceRaw ? parseAmount(runningBalanceRaw) : null;

	const localAmount = profile.localAmountColumn
		? parseAmount(raw[profile.localAmountColumn] ?? '')
		: null;

	return {
		accountingDate,
		valueDate,
		amount,
		fee,
		currency: profile.currencyColumn
			? raw[profile.currencyColumn]?.trim() || PRIMARY_CURRENCY
			: PRIMARY_CURRENCY,
		amountOriginal: localAmount ?? amount,
		currencyOriginal: profile.currencyColumn
			? raw[profile.currencyColumn]?.trim() || PRIMARY_CURRENCY
			: PRIMARY_CURRENCY,
		description: raw[profile.descriptionColumn]?.trim() ?? '',
		runningBalance,
		status,
		rawType,
		isTransferCandidate: rawType !== null && profile.transferTypes.includes(rawType),
		isFxCandidate: rawType !== null && profile.fxCandidateTypes.includes(rawType),
		category: optionalColumns.categoryColumn
			? raw[optionalColumns.categoryColumn]?.trim() || null
			: null,
		city: optionalColumns.cityColumn ? raw[optionalColumns.cityColumn]?.trim() || null : null,
		notes: optionalColumns.notesColumn ? raw[optionalColumns.notesColumn]?.trim() || null : null,
		internalId: optionalColumns.idColumn ? raw[optionalColumns.idColumn]?.trim() || null : null,
		sourceIndex: 0 // placeholder; always overwritten by the caller
	};
}

// Bank status vocabularies, normalised to UPPERCASE. `reverted` is an umbrella for any
// transaction whose money was returned / never settled (returned, cancelled, declined, failed).
const PENDING_STATES = ['PENDIENTE', 'PENDING'];
const REVERTED_STATES = [
	'DEVUELTO',
	'REVERTED',
	'RETURNED',
	'CANCELLED',
	'CANCELED',
	'CANCELADO',
	'RECHAZADO',
	'DECLINED',
	'FAILED'
];

/** Map a raw (upper-cased) bank status string to Clair's status. Unknown → posted. */
export function classifyStatus(statusRaw: string | null | undefined): 'pending' | 'posted' | 'reverted' {
	if (!statusRaw) return 'posted';
	if (PENDING_STATES.includes(statusRaw)) return 'pending';
	if (REVERTED_STATES.includes(statusRaw)) return 'reverted';
	return 'posted';
}

function parseDateField(raw: string | undefined, format: string): Date | null {
	if (!raw?.trim()) return null;
	// date-fns format uses lowercase dd/yyyy
	const dfnsFormat = format.replace(/DD/g, 'dd').replace(/YYYY/g, 'yyyy');
	const parsed = parseDate(raw.trim(), dfnsFormat, new Date());
	if (!isValid(parsed)) return null;
	// Normalize to UTC midnight so dedup eq comparisons are stable across uploads
	return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

export function parseAmount(raw: string): number {
	if (!raw?.trim()) return 0;
	const cleaned = raw.trim().replace(/\s/g, '');
	// Detect comma-decimal format: "1.234,56" or "-33,00"
	const hasCommaDecimal = /\d,\d{1,2}$/.test(cleaned);
	const normalised = hasCommaDecimal
		? cleaned.replace(/\./g, '').replace(',', '.')
		: cleaned.replace(/,/g, '');
	return parseFloat(normalised) || 0;
}
