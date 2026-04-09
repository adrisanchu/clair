import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { BankParserProfile, NormalizedTransaction } from './types.js';
import {
	normalizeRow,
	detectOptionalColumn,
	getUsedColumns,
	CATEGORY_SYNONYMS,
	CITY_SYNONYMS,
	NOTES_SYNONYMS
} from './normalizer.js';
import { preCategorize } from './pre-categorize.js';
import { detectAdaptiveProfile, detectEncoding } from './detector.js';
import {
	revolut_eu,
	postNormalize as revolut_eu_postNormalize,
	REVOLUT_EU_HEADER_FINGERPRINT
} from './profiles/revolut_eu.js';
import { bankinter_es, BANKINTER_ES_HEADER_FINGERPRINT } from './profiles/bankinter_es.js';

// ─── Profile registry ──────────────────────────────────────────────────────

const PROFILES: Record<string, BankParserProfile> = {
	revolut_eu,
	bankinter_es
};

export function getProfile(bankProfileId: string): BankParserProfile | null {
	return PROFILES[bankProfileId] ?? null;
}

export function getAllProfiles(): BankParserProfile[] {
	return Object.values(PROFILES);
}

// ─── Auto-detection ────────────────────────────────────────────────────────

/**
 * Attempt to detect the bank profile from the CSV's first line.
 * Tries exact match first, then fuzzy subset match (handles extra user-added columns).
 * Returns the profileId string or null if no match.
 */
export function detectProfile(csvText: string): string | null {
	const firstLine = csvText.split('\n')[0]?.trim() ?? '';
	// Fast path: exact match
	if (firstLine === REVOLUT_EU_HEADER_FINGERPRINT) return 'revolut_eu';
	// Fuzzy: all required fingerprint columns present (handles extra columns)
	const headers = firstLine.split(',').map((h) => h.trim());
	const required = REVOLUT_EU_HEADER_FINGERPRINT.split(',').map((h) => h.trim());
	if (required.every((col) => headers.includes(col))) return 'revolut_eu';
	return null;
}

/**
 * Attempt to detect the bank profile from an XLSX buffer.
 * Reads only the first 10 rows (cheap) and matches the header row against known fingerprints.
 * Returns the profileId string or null if no match.
 */
export function detectXLSXProfile(buffer: Buffer): string | null {
	try {
		const workbook = XLSX.read(buffer, { type: 'buffer', sheetRows: 10 });
		const sheet = workbook.Sheets[workbook.SheetNames[0]];
		const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
			header: 1,
			defval: '',
			raw: false
		}) as string[][];

		// Bankinter: header at row index 8 (Excel row 9)
		const bankinterHeader = rows[8];
		if (
			bankinterHeader &&
			BANKINTER_ES_HEADER_FINGERPRINT.every((col, i) => bankinterHeader[i]?.trim() === col)
		) {
			return 'bankinter_es';
		}
	} catch {
		// not a valid XLSX file
	}
	return null;
}

// ─── File direction detection ──────────────────────────────────────────────

/**
 * Detect whether the rows in a parsed file are in ascending or descending date order.
 * Compares the first row's date against the last row's date.
 * Returns 'unknown' when the file has fewer than 2 rows or all rows share the same date.
 */
export function detectFileDirection(
	rows: import('./types.js').NormalizedTransaction[]
): 'asc' | 'desc' | 'unknown' {
	if (rows.length < 2) return 'unknown';
	const first = rows[0].accountingDate;
	const last = rows[rows.length - 1].accountingDate;
	if (first < last) return 'asc';
	if (first > last) return 'desc';
	return 'unknown';
}

// ─── Per-profile post-normalise hooks ─────────────────────────────────────

const POST_NORMALIZE: Partial<
	Record<string, (row: NormalizedTransaction, raw: Record<string, string>) => NormalizedTransaction>
> = {
	revolut_eu: revolut_eu_postNormalize
};

// ─── Parse ────────────────────────────────────────────────────────────────

export interface ParseResult {
	rows: NormalizedTransaction[];
	skippedCount: number;
	errors: string[];
	columnMappings: Array<{ csvHeader: string; field: 'category' | 'city' | 'notes'; label: string }>;
	unusedColumns: string[];
	detectionMeta: import('./types.js').DetectionMeta | null; // null = strict profile succeeded
}

export type ColumnOverrides = {
	categoryColumn: string | null;
	cityColumn: string | null;
	notesColumn: string | null;
} | null;

const FIELD_LABELS: Record<'category' | 'city' | 'notes', string> = {
	category: 'Category',
	city: 'City',
	notes: 'Notes'
};

function buildOptionalColumns(
	headers: string[],
	overrides: ColumnOverrides
): { categoryColumn: string | null; cityColumn: string | null; notesColumn: string | null } {
	if (overrides) return overrides;
	return {
		categoryColumn: detectOptionalColumn(headers, CATEGORY_SYNONYMS),
		cityColumn: detectOptionalColumn(headers, CITY_SYNONYMS),
		notesColumn: detectOptionalColumn(headers, NOTES_SYNONYMS)
	};
}

function buildColumnMeta(
	headers: string[],
	profile: BankParserProfile,
	optionalColumns: { categoryColumn: string | null; cityColumn: string | null; notesColumn: string | null }
): { columnMappings: ParseResult['columnMappings']; unusedColumns: string[] } {
	const usedByProfile = getUsedColumns(profile);
	const optionalValues = Object.values(optionalColumns).filter(Boolean) as string[];

	const unusedColumns = headers.filter(
		(h) => !usedByProfile.includes(h) && !optionalValues.includes(h)
	);

	const columnMappings = (
		[
			['category', optionalColumns.categoryColumn],
			['city', optionalColumns.cityColumn],
			['notes', optionalColumns.notesColumn]
		] as [keyof typeof FIELD_LABELS, string | null][]
	)
		.filter(([, v]) => v !== null)
		.map(([field, csvHeader]) => ({ csvHeader: csvHeader!, field, label: FIELD_LABELS[field] }));

	return { columnMappings, unusedColumns };
}

// ─── Strict parsers (internal) ────────────────────────────────────────────

/**
 * Parse a CSV string using the given profile exactly as specified.
 * Internal — callers should use parseCSV() which includes adaptive fallback.
 */
function parseCSVStrict(
	csvText: string,
	profile: BankParserProfile,
	columnOverrides: ColumnOverrides = null
): ParseResult {
	// Strip leading metadata rows (e.g. bank header lines before the column header)
	let text = csvText;
	if (profile.skipRows > 0) {
		const lines = csvText.split('\n');
		text = lines.slice(profile.skipRows).join('\n');
	}

	const result = Papa.parse<Record<string, string>>(text, {
		header: true,
		skipEmptyLines: true,
		delimiter: profile.delimiter,
		transformHeader: (h) => h.trim()
	});

	const rows: NormalizedTransaction[] = [];
	const errors: string[] = [];
	let skippedCount = 0;
	const postNorm = POST_NORMALIZE[profile.bankProfileId];

	const csvHeaders = Object.keys(result.data[0] ?? {});
	const optionalColumns = buildOptionalColumns(csvHeaders, columnOverrides);
	const { columnMappings, unusedColumns } = buildColumnMeta(csvHeaders, profile, optionalColumns);

	for (let i = 0; i < result.data.length; i++) {
		const raw = result.data[i];
		let normalized = normalizeRow(raw, profile, optionalColumns);

		if (!normalized) {
			skippedCount++;
			errors.push(`Row ${i + 1}: could not parse date "${raw[profile.dateColumn]}"`);
			continue;
		}

		if (normalized.description === '') {
			skippedCount++;
			errors.push(`Row ${i + 1}: empty description — skipped`);
			continue;
		}

		if (postNorm) {
			normalized = postNorm(normalized, raw);
		}

		normalized = preCategorize(normalized);
		rows.push({ ...normalized, sourceIndex: i });
	}

	// PapaParse parse-level errors
	for (const err of result.errors) {
		errors.push(`Parse error row ${err.row ?? '?'}: ${err.message}`);
	}

	return { rows, skippedCount, errors, columnMappings, unusedColumns, detectionMeta: null };
}

/**
 * Parse an XLSX buffer using the given profile exactly as specified.
 * Internal — callers should use parseXLSX() which includes adaptive fallback.
 */
function parseXLSXStrict(
	buffer: Buffer,
	profile: BankParserProfile,
	columnOverrides: ColumnOverrides = null
): ParseResult {
	const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
	const sheet = workbook.Sheets[workbook.SheetNames[0]];

	// range: N → row index N becomes the header; rows N+1+ are data.
	// raw: false → all cells coerced to strings, matching PapaParse behaviour.
	// cellDates: false → dates remain as formatted strings (e.g. dd/MM/yyyy) for parseDateField().
	const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
		range: profile.skipRows,
		defval: '',
		raw: false
	});

	// Trim all header keys — SheetJS doesn't trim by default unlike PapaParse's transformHeader.
	const rowsData = rawRows.map((row) =>
		Object.fromEntries(Object.entries(row).map(([k, v]) => [k.trim(), v]))
	);

	const rows: NormalizedTransaction[] = [];
	const errors: string[] = [];
	let skippedCount = 0;
	const postNorm = POST_NORMALIZE[profile.bankProfileId];

	const xlsxHeaders = Object.keys(rowsData[0] ?? {});
	const optionalColumns = buildOptionalColumns(xlsxHeaders, columnOverrides);
	const { columnMappings, unusedColumns } = buildColumnMeta(xlsxHeaders, profile, optionalColumns);

	for (let i = 0; i < rowsData.length; i++) {
		const raw = rowsData[i];
		let normalized = normalizeRow(raw, profile, optionalColumns);

		if (!normalized) {
			skippedCount++;
			errors.push(`Row ${i + 1}: could not parse date "${raw[profile.dateColumn]}"`);
			continue;
		}

		if (normalized.description === '') {
			skippedCount++;
			errors.push(`Row ${i + 1}: empty description — skipped`);
			continue;
		}

		if (postNorm) {
			normalized = postNorm(normalized, raw);
		}

		normalized = preCategorize(normalized);
		rows.push({ ...normalized, sourceIndex: i });
	}

	return { rows, skippedCount, errors, columnMappings, unusedColumns, detectionMeta: null };
}

// ─── Public parsers (two-layer) ───────────────────────────────────────────

/**
 * Parse a CSV string with automatic adaptive fallback.
 * If the strict profile parse skips more than 50% of rows, re-runs with adaptive detection.
 */
export function parseCSV(
	csvText: string,
	profile: BankParserProfile,
	columnOverrides: ColumnOverrides = null,
	buffer?: Buffer
): ParseResult {
	const strict = parseCSVStrict(csvText, profile, columnOverrides);
	const total = strict.rows.length + strict.skippedCount;
	const skipRate = total > 0 ? strict.skippedCount / total : 0;
	if (skipRate <= 0.5) return strict;

	// Adaptive fallback
	const buf = buffer ?? Buffer.from(csvText, 'utf8');
	const { profile: adaptive, meta, csvText: reEncoded } = detectAdaptiveProfile(buf, 'csv');
	const result = parseCSVStrict(reEncoded, adaptive, null);
	return { ...result, detectionMeta: meta };
}

/**
 * Parse an XLSX buffer with automatic adaptive fallback.
 * If the strict profile parse skips more than 50% of rows, re-runs with adaptive detection.
 */
export function parseXLSX(
	buffer: Buffer,
	profile: BankParserProfile,
	columnOverrides: ColumnOverrides = null
): ParseResult {
	const strict = parseXLSXStrict(buffer, profile, columnOverrides);
	const total = strict.rows.length + strict.skippedCount;
	const skipRate = total > 0 ? strict.skippedCount / total : 0;
	if (skipRate <= 0.5) return strict;

	// Adaptive fallback
	const { profile: adaptive, meta } = detectAdaptiveProfile(buffer, 'xlsx');
	const result = parseXLSXStrict(buffer, adaptive, null);
	return { ...result, detectionMeta: meta };
}

// ─── File utilities ────────────────────────────────────────────────────────

/**
 * Convert a file to a UTF-8 string (for callers that don't need charset detection).
 * uploadAndParse() uses detectEncoding() from detector.ts for proper charset handling.
 */
export async function fileToText(file: File): Promise<string> {
	const buffer = Buffer.from(await file.arrayBuffer());
	return buffer.toString('utf8');
}

/**
 * Convert a file (from SvelteKit formData) to a raw Buffer.
 * Used for XLSX and other binary formats.
 */
export async function fileToBuffer(file: File): Promise<Buffer> {
	return Buffer.from(await file.arrayBuffer());
}

// ─── Upload entry point ────────────────────────────────────────────────────

/**
 * Single entry point for all file uploads.
 * Detects file type (csv / xlsx) → optionally detects bank profile → parses.
 * Falls back to adaptive detection if no profile matches or if the profile produces
 * too many skipped rows (>50%).
 *
 * Pass profileIdHint when the profile is already known (e.g. stored on the account record).
 * Pass columnOverrides to use user-confirmed column mappings instead of auto-detection.
 */
export async function uploadAndParse(
	file: File,
	profileIdHint?: string | null,
	columnOverrides?: ColumnOverrides
): Promise<{ profileId: string; result: ParseResult }> {
	const isXlsx =
		file.name.endsWith('.xlsx') ||
		file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

	const buffer = await fileToBuffer(file);

	if (isXlsx) {
		const profileId = profileIdHint || detectXLSXProfile(buffer);
		if (!profileId) {
			// No known profile — run adaptive detection directly
			const { profile: adaptive, meta } = detectAdaptiveProfile(buffer, 'xlsx');
			const result = parseXLSXStrict(buffer, adaptive, columnOverrides ?? null);
			return { profileId: 'adaptive', result: { ...result, detectionMeta: meta } };
		}
		const profile = getProfile(profileId);
		if (!profile) throw new Error(`Unknown bank profile: ${profileId}`);
		return { profileId, result: parseXLSX(buffer, profile, columnOverrides ?? null) };
	}

	// CSV path: detect charset from raw buffer before decoding
	const { value: encoding } = detectEncoding(buffer);
	const csvText = buffer.toString(encoding === 'iso-8859-1' ? 'latin1' : 'utf8');
	const profileId = profileIdHint || detectProfile(csvText);

	if (!profileId) {
		// No known profile — run adaptive detection directly
		const { profile: adaptive, meta, csvText: reEncoded } = detectAdaptiveProfile(buffer, 'csv');
		const result = parseCSVStrict(reEncoded, adaptive, columnOverrides ?? null);
		return { profileId: 'adaptive', result: { ...result, detectionMeta: meta } };
	}

	const profile = getProfile(profileId);
	if (!profile) throw new Error(`Unknown bank profile: ${profileId}`);
	return { profileId, result: parseCSV(csvText, profile, columnOverrides ?? null, buffer) };
}
