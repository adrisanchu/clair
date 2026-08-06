import type { BankParserProfile } from '../types.js';

export const revolut_eu: BankParserProfile = {
	fileType: 'csv',
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
	// Fee/commission, positive in the row's currency; the normalizer folds it in as gross − fee.
	feeColumn: 'Comisión',
	statusColumn: 'State',
	typeColumn: 'Tipo',
	// 'Transferir' = outgoing/incoming peer transfers.
	// 'Recargas' = bank top-ups (e.g. funding Revolut from a personal bank account) — also
	// treated as transfer candidates so the counterpart in the source bank gets auto-linked.
	transferTypes: ['Transferir', 'Recargas'],
	// 'Cambio' marks a cross-currency exchange (e.g. EUR → SEK top-up).
	fxCandidateTypes: ['Cambio'],
	additionalColumns: []
};

/**
 * Fingerprint to auto-detect a Revolut EU (Spanish) CSV from its header row.
 */
export const REVOLUT_EU_HEADER_FINGERPRINT =
	'Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo';
