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
	// 'Cambio' (ES) / 'Exchange' (EN) mark a cross-currency exchange (e.g. EUR → SEK top-up).
	// Revolut localises the type column, so both must be recognised.
	fxCandidateTypes: ['Cambio', 'Exchange'],
	// Fallback when the type column is missing/localised differently: the description of an
	// exchange leg always names the target currency ("Conversión a VND", "Exchanged to VND",
	// "Cambio de divisas a VND"). Guards against unflagged real FX legs being ignored, which
	// would otherwise let the anchor matcher bind to an unrelated expense.
	fxCandidateDescriptionPattern: /conversi[oó]n a\b|exchanged to\b|cambio de divisas\b/i,
	additionalColumns: []
};

/**
 * Fingerprint to auto-detect a Revolut EU (Spanish) CSV from its header row.
 */
export const REVOLUT_EU_HEADER_FINGERPRINT =
	'Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo';
