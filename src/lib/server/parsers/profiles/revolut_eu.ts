import type { BankParserProfile, NormalizedTransaction } from '../types.js';
import { parseAmount } from '../normalizer.js';

export const revolut_eu: BankParserProfile = {
	bankProfileId: 'revolut_eu',
	displayName: 'Revolut (EU)',
	encoding: 'utf-8',
	delimiter: ',',
	skipRows: 0,
	// Columns use Spanish locale names as exported from the Revolut app
	dateColumn: 'Fecha de inicio',
	dateFormat: 'yyyy-MM-dd HH:mm:ss',
	valueDateColumn: 'Fecha de finalización',
	amountColumn: 'Importe',
	debitColumn: null,
	creditColumn: null,
	descriptionColumn: 'Descripción',
	currencyColumn: 'Divisa',
	localAmountColumn: null, // Revolut only exports the EUR-equivalent amount
	balanceColumn: 'Saldo',
	statusColumn: 'State',
	typeColumn: 'Tipo',
	// Only 'Transferir' rows are inter-account transfer candidates.
	// 'Cambio' (currency exchange) is intentionally excluded from same-currency transfer matching.
	transferTypes: ['Transferir'],
	// 'Cambio' marks a cross-currency exchange (e.g. EUR → SEK top-up).
	fxCandidateTypes: ['Cambio']
};

/**
 * Revolut-specific post-normalisation adjustments:
 * - Adds fee (Comisión) to amount if non-zero
 * - Leaves everything else as-is from the generic normalizer
 */
export function postNormalize(
	row: NormalizedTransaction,
	raw: Record<string, string>
): NormalizedTransaction {
	const fee = parseAmount(raw['Comisión'] ?? '');
	if (fee !== 0) {
		// Fee is already signed (negative) in Revolut exports; add it to amount
		return { ...row, amount: row.amount + fee };
	}
	return row;
}

/**
 * Fingerprint to auto-detect a Revolut EU (Spanish) CSV from its header row.
 */
export const REVOLUT_EU_HEADER_FINGERPRINT =
	'Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo';
