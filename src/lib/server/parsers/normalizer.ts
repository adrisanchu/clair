import { parse as parseDate, isValid } from 'date-fns';
import type { BankParserProfile, NormalizedTransaction } from './types.js';
import { SEMANTIC_SYNONYMS, ID_SYNONYMS, detectDateFormat } from './detector.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

// ─── Optional column synonym lists (re-exported from detector for backward compat) ──

export const CATEGORY_SYNONYMS = SEMANTIC_SYNONYMS.category;
export const COST_GROUP_SYNONYMS = SEMANTIC_SYNONYMS.costGroup;
export const CITY_SYNONYMS = SEMANTIC_SYNONYMS.city;
export const NOTES_SYNONYMS = SEMANTIC_SYNONYMS.notes;
export { ID_SYNONYMS };

/** Shape of the optional (non-bank) columns detected from a file's headers. */
export interface OptionalColumns {
	categoryColumn: string | null;
	costGroupColumn: string | null;
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
		costGroupColumn: null,
		cityColumn: null,
		notesColumn: null,
		idColumn: null
	},
	// The format actually used by this file's date columns. Defaults to the profile's
	// declared format; callers pass a value resolved via resolveDateFormat() so a file
	// re-saved in a different (but internally consistent) date format still parses.
	dateFormat: string = profile.dateFormat
): NormalizedTransaction | null {
	const grossAmount = profile.amountColumn
		? parseAmount(raw[profile.amountColumn])
		: parseAmount(raw[profile.creditColumn!] ?? '') - parseAmount(raw[profile.debitColumn!] ?? '');

	// Fee/commission is always a cost, stored non-negative. Net effect on the balance is
	// gross − fee (uniform for income and expenses), so we fold it into `amount` at parse time.
	// Round to the stored precision (4 dp): `gross − fee` accumulates binary-float error
	// (e.g. -168.64 − 4.44 = -173.07999999999998). Left unrounded, this raw float no longer
	// equals the toFixed(4)-rounded value written to the DB, so dedup's `amount::numeric =`
	// check misses and a re-import of the same row is wrongly flagged as new.
	const fee = profile.feeColumn ? Math.abs(parseAmount(raw[profile.feeColumn] ?? '')) : 0;
	const amount = roundAmount(grossAmount - fee);

	const accountingDate = parseDateField(raw[profile.dateColumn], dateFormat);
	if (!accountingDate) return null; // unparseable date → skip row

	const valueDate = profile.valueDateColumn
		? parseDateField(raw[profile.valueDateColumn], dateFormat)
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
		costGroup: optionalColumns.costGroupColumn
			? raw[optionalColumns.costGroupColumn]?.trim() || null
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
export function classifyStatus(
	statusRaw: string | null | undefined
): 'pending' | 'posted' | 'reverted' {
	if (!statusRaw) return 'posted';
	if (PENDING_STATES.includes(statusRaw)) return 'pending';
	if (REVERTED_STATES.includes(statusRaw)) return 'reverted';
	return 'posted';
}

// Fixed reference so date-fns fills any field the format omits with a stable value
// instead of "now": a date-only format then yields 00:00, giving the UTC-midnight
// fallback for rows whose CSV carries no time.
const DATE_PARSE_REFERENCE = new Date(2000, 0, 1);

/** Normalize a profile/user format token to date-fns casing (DD→dd, YYYY→yyyy). */
function toDfnsFormat(format: string): string {
	return format.replace(/DD/g, 'dd').replace(/YYYY/g, 'yyyy');
}

/** Fraction of samples (0..1) that parse cleanly under `format`. */
function dateParseRate(samples: string[], format: string): number {
	if (samples.length === 0) return 0;
	const fmt = toDfnsFormat(format);
	let ok = 0;
	for (const s of samples) {
		try {
			if (isValid(parseDate(s.trim(), fmt, DATE_PARSE_REFERENCE))) ok++;
		} catch {
			/* ignore parse errors */
		}
	}
	return ok / samples.length;
}

/**
 * Resolve the date format a file actually uses for its date column.
 *
 * `preferred` is the profile's declared format — a hint, not a guarantee. A CSV re-saved
 * through Excel/LibreOffice often localizes dates (e.g. `yyyy-MM-dd HH:mm:ss` →
 * `dd/MM/yyyy HH:mm`) while every date column stays internally consistent. We keep the
 * preferred format when it still fits the samples — it's the bank's known-correct format
 * and sidesteps `dd/MM` vs `MM/dd` ambiguity on all-small-day files — and only detect the
 * real format when the file was clearly saved differently. Detection must clear a
 * confidence bar; otherwise we stay with the preferred format.
 */
export function resolveDateFormat(samples: Array<string | undefined>, preferred: string): string {
	const valid = samples
		.map((s) => s?.trim())
		.filter((s): s is string => Boolean(s))
		.slice(0, 30);
	if (valid.length === 0) return preferred;
	if (dateParseRate(valid, preferred) >= 0.7) return preferred;
	const detected = detectDateFormat(valid);
	return detected.confidence >= 0.7 && detected.value ? detected.value : preferred;
}

function parseDateField(raw: string | undefined, format: string): Date | null {
	if (!raw?.trim()) return null;
	const parsed = parseDate(raw.trim(), toDfnsFormat(format), DATE_PARSE_REFERENCE);
	if (!isValid(parsed)) return null;
	// Reinterpret the parsed wall-clock (date-fns builds a local Date) as UTC: keeps the
	// calendar day stable across server timezones and preserves the hour/minute/second the
	// CSV provided — formats without a time component parse to 00:00:00 (UTC-midnight).
	// Seconds are kept so two genuinely-distinct same-minute rows (same amount + label) stay
	// apart in dedup's exact-instant match; a re-export whose seconds shifted still dedupes
	// via dedup's same-calendar-day fallback (see dedup.ts), so this never causes duplicates.
	return new Date(
		Date.UTC(
			parsed.getFullYear(),
			parsed.getMonth(),
			parsed.getDate(),
			parsed.getHours(),
			parsed.getMinutes(),
			parsed.getSeconds()
		)
	);
}

/**
 * Round a computed monetary amount to the stored precision (4 dp), clearing the binary-float
 * error left by fee-folding so the in-memory value matches the toFixed(4) value written to the
 * DB (and thus dedup's amount comparison). `Number(n.toFixed(4))` yields a double whose short
 * repr is clean (e.g. -173.07999999999998 → -173.08).
 */
export function roundAmount(n: number): number {
	return Number(n.toFixed(4));
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
