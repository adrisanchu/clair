import Papa from 'papaparse'
import type { BankParserProfile, NormalizedTransaction } from './types.js'
import { normalizeRow } from './normalizer.js'
import {
	revolut_eu,
	postNormalize as revolut_eu_postNormalize,
	REVOLUT_EU_HEADER_FINGERPRINT
} from './profiles/revolut_eu.js'

// ─── Profile registry ──────────────────────────────────────────────────────

const PROFILES: Record<string, BankParserProfile> = {
	revolut_eu
}

export function getProfile(bankProfileId: string): BankParserProfile | null {
	return PROFILES[bankProfileId] ?? null
}

export function getAllProfiles(): BankParserProfile[] {
	return Object.values(PROFILES)
}

// ─── Auto-detection ────────────────────────────────────────────────────────

/**
 * Attempt to detect the bank profile from the CSV's first line.
 * Returns the profileId string or null if no match.
 */
export function detectProfile(csvText: string): string | null {
	const firstLine = csvText.split('\n')[0]?.trim() ?? ''
	if (firstLine === REVOLUT_EU_HEADER_FINGERPRINT) return 'revolut_eu'
	return null
}

// ─── Per-profile post-normalise hooks ─────────────────────────────────────

const POST_NORMALIZE: Partial<
	Record<string, (row: NormalizedTransaction, raw: Record<string, string>) => NormalizedTransaction>
> = {
	revolut_eu: revolut_eu_postNormalize
}

// ─── Parse ────────────────────────────────────────────────────────────────

export interface ParseResult {
	rows: NormalizedTransaction[]
	skippedCount: number
	errors: string[]
}

/**
 * Parse a CSV string using the given profile.
 * Returns normalised rows, count of skipped rows, and any parse errors.
 */
export function parseCSV(csvText: string, profile: BankParserProfile): ParseResult {
	// Strip leading metadata rows (e.g. bank header lines before the column header)
	let text = csvText
	if (profile.skipRows > 0) {
		const lines = csvText.split('\n')
		text = lines.slice(profile.skipRows).join('\n')
	}

	const result = Papa.parse<Record<string, string>>(text, {
		header: true,
		skipEmptyLines: true,
		delimiter: profile.delimiter,
		transformHeader: (h) => h.trim()
	})

	const rows: NormalizedTransaction[] = []
	const errors: string[] = []
	let skippedCount = 0
	const postNorm = POST_NORMALIZE[profile.bankProfileId]

	for (let i = 0; i < result.data.length; i++) {
		const raw = result.data[i]
		let normalized = normalizeRow(raw, profile)

		if (!normalized) {
			skippedCount++
			errors.push(`Row ${i + 1}: could not parse date "${raw[profile.dateColumn]}"`)
			continue
		}

		if (normalized.description === '') {
			skippedCount++
			errors.push(`Row ${i + 1}: empty description — skipped`)
			continue
		}

		if (postNorm) {
			normalized = postNorm(normalized, raw)
		}

		rows.push(normalized)
	}

	// PapaParse parse-level errors
	for (const err of result.errors) {
		errors.push(`Parse error row ${err.row ?? '?'}: ${err.message}`)
	}

	return { rows, skippedCount, errors }
}

/**
 * Convert a file (from SvelteKit formData) to a UTF-8 string.
 * TODO: use chardet + iconv-lite for ISO-8859-1 profiles (e.g. CaixaBank).
 */
export async function fileToText(file: File): Promise<string> {
	const buffer = Buffer.from(await file.arrayBuffer())
	return buffer.toString('utf8')
}
