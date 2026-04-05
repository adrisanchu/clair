import type { BankParserProfile } from '../types.js';

export const bankinter_es: BankParserProfile = {
	fileType: 'xlsx',
	bankProfileId: 'bankinter_es',
	displayName: 'Bankinter (ES)',
	encoding: 'utf-8', // unused for XLSX
	delimiter: '', // unused for XLSX
	// Rows 0–7 are metadata/empty rows; row index 8 (Excel row 9) is the header row.
	skipRows: 8,
	dateColumn: 'Fecha contable',
	dateFormat: 'dd/MM/yyyy',
	valueDateColumn: 'Fecha valor',
	amountColumn: 'Importe',
	debitColumn: null,
	creditColumn: null,
	descriptionColumn: 'Descripción',
	currencyColumn: 'Divisa',
	localAmountColumn: null,
	balanceColumn: 'Saldo',
	statusColumn: null, // all exported rows are posted
	typeColumn: null, // Bankinter exports do not include an operation type column
	transferTypes: [],
	fxCandidateTypes: []
};

/**
 * Ordered column names from Excel row 9.
 * Used by detectXLSXProfile() for auto-detection.
 */
export const BANKINTER_ES_HEADER_FINGERPRINT = [
	'Fecha contable',
	'Fecha valor',
	'Descripción',
	'Importe',
	'Saldo',
	'Divisa'
];
