import { parse as parseDate, isValid } from 'date-fns'
import type { BankParserProfile, NormalizedTransaction } from './types.js'

export function normalizeRow(
	raw: Record<string, string>,
	profile: BankParserProfile
): NormalizedTransaction | null {
	const amount = profile.amountColumn
		? parseAmount(raw[profile.amountColumn])
		: parseAmount(raw[profile.creditColumn!] ?? '') -
			parseAmount(raw[profile.debitColumn!] ?? '')

	const accountingDate = parseDateField(raw[profile.dateColumn], profile.dateFormat)
	if (!accountingDate) return null // unparseable date → skip row

	const valueDate = profile.valueDateColumn
		? parseDateField(raw[profile.valueDateColumn], profile.dateFormat)
		: null

	const statusRaw = profile.statusColumn
		? raw[profile.statusColumn]?.trim().toUpperCase()
		: null
	const status: 'pending' | 'posted' =
		statusRaw && ['PENDIENTE', 'PENDING'].includes(statusRaw) ? 'pending' : 'posted'

	const rawType = profile.typeColumn ? (raw[profile.typeColumn]?.trim() ?? null) : null

	const runningBalanceRaw =
		profile.balanceColumn ? raw[profile.balanceColumn]?.trim() : null
	const runningBalance =
		runningBalanceRaw ? parseAmount(runningBalanceRaw) : null

	const localAmount = profile.localAmountColumn
		? parseAmount(raw[profile.localAmountColumn] ?? '')
		: null

	return {
		accountingDate,
		valueDate,
		amount,
		currency: profile.currencyColumn ? (raw[profile.currencyColumn]?.trim() || 'EUR') : 'EUR',
		amountOriginal: localAmount ?? amount,
		currencyOriginal: profile.currencyColumn
			? (raw[profile.currencyColumn]?.trim() || 'EUR')
			: 'EUR',
		description: raw[profile.descriptionColumn]?.trim() ?? '',
		runningBalance,
		status,
		rawType,
		isTransferCandidate: rawType !== null && profile.transferTypes.includes(rawType)
	}
}

function parseDateField(raw: string | undefined, format: string): Date | null {
	if (!raw?.trim()) return null
	// date-fns format uses lowercase dd/yyyy
	const dfnsFormat = format.replace(/DD/g, 'dd').replace(/YYYY/g, 'yyyy')
	const parsed = parseDate(raw.trim(), dfnsFormat, new Date())
	if (!isValid(parsed)) return null
	// Normalize to UTC midnight so dedup eq comparisons are stable across uploads
	return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))
}

export function parseAmount(raw: string): number {
	if (!raw?.trim()) return 0
	const cleaned = raw.trim().replace(/\s/g, '')
	// Detect comma-decimal format: "1.234,56" or "-33,00"
	const hasCommaDecimal = /\d,\d{1,2}$/.test(cleaned)
	const normalised = hasCommaDecimal
		? cleaned.replace(/\./g, '').replace(',', '.')
		: cleaned.replace(/,/g, '')
	return parseFloat(normalised) || 0
}
