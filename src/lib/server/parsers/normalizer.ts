import { parse as parseDate, isValid } from 'date-fns';
import type { BankParserProfile, NormalizedTransaction } from './types.js';

// ─── Optional column synonym lists ────────────────────────────────────────

export const CATEGORY_SYNONYMS = [
	'category', 'categoria', 'categoría', 'cat', 'tipo', 'type',
	'label', 'etiqueta', 'clasificación', 'clasificacion'
];

export const CITY_SYNONYMS = [
	'city', 'ciudad', 'ubicación', 'ubicacion', 'localización',
	'localizacion', 'geografía', 'geografia', 'location', 'place',
	'lugar', 'zona', 'region', 'región'
];

export const NOTES_SYNONYMS = [
	'notes', 'notas', 'nota', 'info adicional',
	'comments', 'comentarios', 'comentario',
	'observaciones', 'observacion', 'observación',
	'remark', 'remarks'
];

/** Returns the first header that matches any synonym (case- and accent-insensitive). */
export function detectOptionalColumn(headers: string[], synonyms: string[]): string | null {
	const norm = (s: string) =>
		s.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
	const normSynonyms = synonyms.map(norm);
	return headers.find((h) => normSynonyms.includes(norm(h))) ?? null;
}

// ─── Row normalizer ────────────────────────────────────────────────────────

export function normalizeRow(
	raw: Record<string, string>,
	profile: BankParserProfile,
	optionalColumns: {
		categoryColumn: string | null;
		cityColumn: string | null;
		notesColumn: string | null;
	} = { categoryColumn: null, cityColumn: null, notesColumn: null }
): NormalizedTransaction | null {
	const amount = profile.amountColumn
		? parseAmount(raw[profile.amountColumn])
		: parseAmount(raw[profile.creditColumn!] ?? '') - parseAmount(raw[profile.debitColumn!] ?? '');

	const accountingDate = parseDateField(raw[profile.dateColumn], profile.dateFormat);
	if (!accountingDate) return null; // unparseable date → skip row

	const valueDate = profile.valueDateColumn
		? parseDateField(raw[profile.valueDateColumn], profile.dateFormat)
		: null;

	const statusRaw = profile.statusColumn ? raw[profile.statusColumn]?.trim().toUpperCase() : null;
	const status: 'pending' | 'posted' =
		statusRaw && ['PENDIENTE', 'PENDING'].includes(statusRaw) ? 'pending' : 'posted';

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
		currency: profile.currencyColumn ? raw[profile.currencyColumn]?.trim() || 'EUR' : 'EUR',
		amountOriginal: localAmount ?? amount,
		currencyOriginal: profile.currencyColumn ? raw[profile.currencyColumn]?.trim() || 'EUR' : 'EUR',
		description: raw[profile.descriptionColumn]?.trim() ?? '',
		runningBalance,
		status,
		rawType,
		isTransferCandidate: rawType !== null && profile.transferTypes.includes(rawType),
		isFxCandidate: rawType !== null && profile.fxCandidateTypes.includes(rawType),
		category: optionalColumns.categoryColumn
			? (raw[optionalColumns.categoryColumn]?.trim() || null)
			: null,
		city: optionalColumns.cityColumn
			? (raw[optionalColumns.cityColumn]?.trim() || null)
			: null,
		notes: optionalColumns.notesColumn
			? (raw[optionalColumns.notesColumn]?.trim() || null)
			: null,
		sourceIndex: 0 // placeholder; always overwritten by the caller
	};
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
