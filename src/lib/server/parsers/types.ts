export interface BankParserProfile {
	fileType: 'csv' | 'xlsx';
	bankProfileId: string;
	displayName: string;
	encoding: string; // 'utf-8' | 'iso-8859-1'
	delimiter: string; // ',' | ';'
	skipRows: number; // metadata rows before the header row
	dateColumn: string; // accounting date / start date
	dateFormat: string; // date-fns format: 'yyyy-MM-dd HH:mm:ss' | 'dd/MM/yyyy' etc.
	valueDateColumn: string | null; // settlement/end date (empty for PENDING rows)
	amountColumn: string | null; // signed amount; null when debit/credit split
	debitColumn: string | null;
	creditColumn: string | null;
	descriptionColumn: string;
	currencyColumn: string | null;
	localAmountColumn: string | null; // original-currency amount (cross-currency txns)
	balanceColumn: string | null; // running balance (empty for PENDING rows)
	statusColumn: string | null; // e.g. 'COMPLETADO'/'PENDIENTE'
	typeColumn: string | null; // raw transaction type (e.g. Revolut 'Tipo')
	transferTypes: string[]; // typeColumn values that flag a row as a transfer candidate
	fxCandidateTypes: string[]; // typeColumn values that flag a row as a currency exchange candidate
	additionalColumns: string[]; // extra CSV columns consumed by postNormalize hooks (e.g. 'Comisión')
}

export interface NormalizedTransaction {
	accountingDate: Date;
	valueDate: Date | null; // null when transaction is pending
	amount: number;
	currency: string;
	amountOriginal: number;
	currencyOriginal: string;
	description: string;
	runningBalance: number | null; // null when transaction is pending
	status: 'pending' | 'posted';
	rawType: string | null; // original type string from CSV
	isTransferCandidate: boolean; // derived from rawType + profile.transferTypes
	isFxCandidate: boolean; // derived from rawType + profile.fxCandidateTypes
	category: string | null; // from CSV if user pre-filled a category column; null otherwise
	city: string | null; // from CSV if user pre-filled a city column; null otherwise
	notes: string | null; // from CSV if user pre-filled a notes column; null otherwise
	sourceIndex: number; // 0-based position in original file (after skipRows); used for ordering
}

export type DedupAction = 'insert' | 'update_status' | 'update_desc' | 'skip' | 'review';

export interface DedupResult {
	action: DedupAction;
	existingId?: string;
}

export interface UploadSummary {
	imported: number;
	statusUpdates: number;
	duplicates: number;
	flagged: number;
	unresolvedTransfers: import('./../../server/transfer-detector.js').TransferMatch[];
}
