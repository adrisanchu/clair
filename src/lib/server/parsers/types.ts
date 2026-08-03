// ─── Adaptive detection types ──────────────────────────────────────────────

export type SemanticField =
	| 'date'
	| 'valueDate'
	| 'amount'
	| 'debit'
	| 'credit'
	| 'description'
	| 'currency'
	| 'localAmount'
	| 'balance'
	| 'status'
	| 'type'
	| 'category'
	| 'city'
	| 'notes';

export interface FieldDetection {
	value: string | null;
	confidence: number; // 0–1
	candidatesTried?: string[];
}

export interface DetectionMeta {
	usedAdaptive: boolean;
	detectedDelimiter: FieldDetection;
	detectedEncoding: FieldDetection;
	detectedSkipRows: FieldDetection;
	detectedDateFormat: FieldDetection;
	columnMappingDetails: Record<SemanticField, FieldDetection>;
	overallConfidence: number; // mean of field confidences
	warnings: string[];
}

// ─── Bank profile types ────────────────────────────────────────────────────

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

/**
 * A BankParserProfile assembled by the adaptive detector rather than declared statically.
 * Structurally identical — compatible with normalizeRow() without any conversion.
 */
export interface ResolvedProfile extends BankParserProfile {
	_isAdaptive: true;
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
	internalId: string | null; // Clair transaction id echoed back by an exported+re-imported file; null otherwise
	sourceIndex: number; // 0-based position in original file (after skipRows); used for ordering
}

export type DedupAction =
	| 'insert'
	| 'update_status'
	| 'update_desc'
	| 'update_enrichment'
	| 'skip'
	| 'review';

/**
 * Enrichment delta applied on a matched row when the re-imported file carries
 * edited Category / Notes / City values. Only non-empty incoming values that
 * differ from the stored value are present; an absent key means "leave unchanged".
 */
export interface EnrichmentDelta {
	categoryOverride?: string; // effective category changed → written as a human override
	notes?: string;
	city?: string;
}

export interface DedupResult {
	action: DedupAction;
	existingId?: string;
	// Present when a matched row also carries edited enrichment to apply. Attached to
	// any matching action (skip/update_status/update_desc) — the import loop applies it.
	enrichment?: EnrichmentDelta;
}

export interface UploadSummary {
	imported: number;
	statusUpdates: number;
	duplicates: number;
	flagged: number;
	unresolvedTransfers: import('./../../server/transfer-detector.js').TransferMatch[];
}
