import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { BankParserProfile, NormalizedTransaction } from './types.js';
import {
	normalizeRow,
	detectOptionalColumn,
	CATEGORY_SYNONYMS,
	CITY_SYNONYMS,
	NOTES_SYNONYMS
} from './normalizer.js';
import { preCategorize } from './pre-categorize.js';
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
 * Returns the profileId string or null if no match.
 */
export function detectProfile(csvText: string): string | null {
	const firstLine = csvText.split('\n')[0]?.trim() ?? '';
	if (firstLine === REVOLUT_EU_HEADER_FINGERPRINT) return 'revolut_eu';
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
}

/**
 * Parse a CSV string using the given profile.
 * Returns normalised rows, count of skipped rows, and any parse errors.
 */
export function parseCSV(csvText: string, profile: BankParserProfile): ParseResult {
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
	const optionalColumns = {
		categoryColumn: detectOptionalColumn(csvHeaders, CATEGORY_SYNONYMS),
		cityColumn: detectOptionalColumn(csvHeaders, CITY_SYNONYMS),
		notesColumn: detectOptionalColumn(csvHeaders, NOTES_SYNONYMS)
	};

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

	return { rows, skippedCount, errors };
}

/**
 * Parse an XLSX buffer using the given profile.
 * Uses profile.skipRows as the 0-indexed row that becomes the header row.
 * Returns normalised rows, count of skipped rows, and any parse errors.
 */
export function parseXLSX(buffer: Buffer, profile: BankParserProfile): ParseResult {
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
	const optionalColumns = {
		categoryColumn: detectOptionalColumn(xlsxHeaders, CATEGORY_SYNONYMS),
		cityColumn: detectOptionalColumn(xlsxHeaders, CITY_SYNONYMS),
		notesColumn: detectOptionalColumn(xlsxHeaders, NOTES_SYNONYMS)
	};

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

	return { rows, skippedCount, errors };
}

// ─── File utilities ────────────────────────────────────────────────────────

/**
 * Convert a file (from SvelteKit formData) to a UTF-8 string.
 * TODO: use chardet + iconv-lite for ISO-8859-1 profiles (e.g. CaixaBank).
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
 * Pass profileIdHint when the profile is already known (e.g. stored on the account record).
 */
export async function uploadAndParse(
	file: File,
	profileIdHint?: string | null
): Promise<{ profileId: string; result: ParseResult }> {
	const isXlsx =
		file.name.endsWith('.xlsx') ||
		file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

	if (isXlsx) {
		const buffer = await fileToBuffer(file);
		const profileId = profileIdHint || detectXLSXProfile(buffer);
		if (!profileId) throw new Error('Could not detect bank profile from XLSX');
		const profile = getProfile(profileId);
		if (!profile) throw new Error(`Unknown bank profile: ${profileId}`);
		return { profileId, result: parseXLSX(buffer, profile) };
	}

	// Default: treat as CSV
	const csvText = await fileToText(file);
	const profileId = profileIdHint || detectProfile(csvText);
	if (!profileId) throw new Error('Could not detect bank profile from CSV');
	const profile = getProfile(profileId);
	if (!profile) throw new Error(`Unknown bank profile: ${profileId}`);
	return { profileId, result: parseCSV(csvText, profile) };
}
