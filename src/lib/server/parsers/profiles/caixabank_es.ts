import type { BankParserProfile } from '../types.js';

export const caixabank_es: BankParserProfile = {
	// CaixaBank exports a legacy binary .xls (OLE2/BIFF). SheetJS reads it through the same
	// code path as .xlsx, so fileType stays 'xlsx'.
	fileType: 'xlsx',
	bankProfileId: 'caixabank_es',
	displayName: 'CaixaBank (ES)',
	encoding: 'utf-8', // unused for XLSX
	delimiter: '', // unused for XLSX
	// Row 0 = title with IBAN, row 1 = "Importes expresados en euros";
	// row index 2 (Excel row 3) is the header row.
	skipRows: 2,
	dateColumn: 'Fecha',
	dateFormat: 'dd/MM/yyyy',
	valueDateColumn: 'Fecha valor',
	// Signed amount, US-formatted (e.g. "-1,056.32"); parseAmount() strips the comma thousands.
	amountColumn: 'Importe',
	debitColumn: null,
	creditColumn: null,
	// ~17-char truncated label. The richer `Más datos` context is folded into `notes` by the
	// caixabank_es POST_NORMALIZE hook in index.ts (dropping the "Fecha de operación:" noise).
	descriptionColumn: 'Movimiento',
	currencyColumn: null, // all rows EUR; no currency column
	localAmountColumn: null,
	balanceColumn: 'Saldo',
	feeColumn: null, // fees are baked into the amount / appear as separate rows
	statusColumn: null, // all exported rows are posted
	typeColumn: null, // CaixaBank exports have no operation-type column
	transferTypes: [],
	fxCandidateTypes: [],
	// Consumed by the POST_NORMALIZE hook (→ notes); declared so it isn't reported "unused".
	additionalColumns: ['Más datos']
};

/**
 * Ordered column names from Excel row 3 (row index 2).
 * Used by detectXLSXProfile() for auto-detection.
 */
export const CAIXABANK_ES_HEADER_FINGERPRINT = [
	'Fecha',
	'Fecha valor',
	'Movimiento',
	'Más datos',
	'Importe',
	'Saldo'
];
