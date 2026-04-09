import { parse as dateFnsParse, isValid, getYear } from 'date-fns';
import * as XLSX from 'xlsx';
import type {
	BankParserProfile,
	DetectionMeta,
	FieldDetection,
	ResolvedProfile,
	SemanticField
} from './types.js';

// ─── Synonym lists for semantic field mapping ──────────────────────────────

export const SEMANTIC_SYNONYMS: Record<SemanticField, string[]> = {
	date: [
		'date',
		'fecha',
		'fecha contable',
		'fecha de inicio',
		'start date',
		'transaction date',
		'booking date',
		'fecha operación',
		'fecha operacion',
		'fecha de operacion',
		'accounting date',
		'datum',
		'trade date',
		'data'
	],
	valueDate: [
		'value date',
		'fecha valor',
		'fecha de valor',
		'fecha de finalización',
		'fecha de finalizacion',
		'settlement date',
		'end date',
		'fecha fin',
		'valuta',
		'disponible'
	],
	amount: [
		'amount',
		'importe',
		'monto',
		'cantidad',
		'value',
		'betrag',
		'montant',
		'bedrag',
		'importo',
		'net amount',
		'importe neto'
	],
	debit: [
		'debit',
		'cargo',
		'cargos',
		'débito',
		'debito',
		'salida',
		'gasto',
		'withdrawal',
		'out',
		'ausgabe'
	],
	credit: [
		'credit',
		'abono',
		'abonos',
		'crédito',
		'credito',
		'entrada',
		'ingreso',
		'deposit',
		'in',
		'eingang'
	],
	description: [
		'description',
		'descripción',
		'descripcion',
		'concepto',
		'detalle',
		'detail',
		'details',
		'memo',
		'narrative',
		'reference',
		'referencia',
		'bezeichnung',
		'omschrijving',
		'libellé',
		'libelle',
		'beneficiary',
		'beneficiario',
		'comercio',
		'merchant'
	],
	currency: ['currency', 'divisa', 'moneda', 'devise', 'währung', 'valuta', 'cur', 'ccy'],
	localAmount: [
		'local amount',
		'importe local',
		'foreign amount',
		'original amount',
		'importe original',
		'amount in original currency'
	],
	balance: [
		'balance',
		'saldo',
		'solde',
		'kontostand',
		'running balance',
		'saldo contable',
		'balance disponible',
		'available balance'
	],
	status: ['status', 'estado', 'state', 'statut', 'zustand'],
	type: [
		'type',
		'tipo',
		'art',
		'transaction type',
		'tipo de operacion',
		'tipo de operación',
		'operacion'
	],
	category: [
		'category',
		'categoria',
		'categoría',
		'cat',
		'label',
		'etiqueta',
		'clasificación',
		'clasificacion'
	],
	city: [
		'city',
		'ciudad',
		'ubicación',
		'ubicacion',
		'localización',
		'localizacion',
		'location',
		'place',
		'lugar',
		'zona'
	],
	notes: [
		'notes',
		'notas',
		'nota',
		'info adicional',
		'comments',
		'comentarios',
		'comentario',
		'observaciones',
		'observacion',
		'observación',
		'remark',
		'remarks',
		'info'
	]
};

// Priority order for field assignment (earlier = higher priority when two fields compete).
const FIELD_PRIORITY: SemanticField[] = [
	'date',
	'description',
	'amount',
	'balance',
	'currency',
	'valueDate',
	'debit',
	'credit',
	'status',
	'type',
	'localAmount',
	'category',
	'city',
	'notes'
];

// ─── Candidate date formats ────────────────────────────────────────────────

export const CANDIDATE_DATE_FORMATS = [
	'yyyy-MM-dd HH:mm:ss',
	"yyyy-MM-dd'T'HH:mm:ss",
	"yyyy-MM-dd'T'HH:mm:ssxxx",
	'yyyy-MM-dd HH:mm',
	'yyyy-MM-dd',
	'dd/MM/yyyy HH:mm:ss',
	'dd/MM/yyyy HH:mm',
	'dd/MM/yyyy',
	'd/M/yyyy',
	'dd-MM-yyyy',
	'd-M-yyyy',
	'dd.MM.yyyy',
	'd.M.yyyy',
	'MM/dd/yyyy',
	'M/d/yyyy',
	'dd-MMM-yyyy',
	'dd MMM yyyy',
	'MMM dd, yyyy',
	'yyyyMMdd'
] as const;

// Fixed reference date avoids "current date used as fallback" problem in date-fns.
const DATE_PARSE_REFERENCE = new Date(2000, 0, 1);

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Normalize a string for accent-insensitive, case-insensitive comparison. */
function norm(s: string): string {
	return s
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '');
}

// ─── detectEncoding ────────────────────────────────────────────────────────

/**
 * Heuristic charset detection from a raw buffer.
 * Checks whether the buffer is valid UTF-8 by looking for U+FFFD replacement chars.
 */
export function detectEncoding(buffer: Buffer): FieldDetection {
	const utf8 = buffer.toString('utf8');
	const replacements = (utf8.match(/\uFFFD/g) ?? []).length;
	if (replacements === 0) {
		return { value: 'utf-8', confidence: 1.0 };
	}
	return { value: 'iso-8859-1', confidence: 0.75 };
}

// ─── detectDelimiter ───────────────────────────────────────────────────────

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'] as const;
type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/**
 * Detect the CSV delimiter by scoring candidates on column-count consistency
 * across sample lines.
 */
export function detectDelimiter(text: string, sampleLines = 10): FieldDetection {
	const lines = text
		.split('\n')
		.map((l) => l.replace(/\r$/, ''))
		.filter((l) => l.trim().length > 0)
		.slice(0, sampleLines);

	if (lines.length === 0) return { value: ',', confidence: 0.3 };

	const scores: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0, '|': 0 };

	for (const d of CANDIDATE_DELIMITERS) {
		const counts = lines.map((l) => l.split(d).length);
		const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
		if (mean <= 1) {
			scores[d] = 0;
			continue;
		}
		const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
		const stddev = Math.sqrt(variance);
		// Score = mean column count × consistency factor (1 - CV)
		scores[d] = mean * (1 - stddev / mean);
	}

	const sorted = (Object.keys(scores) as Delimiter[]).sort((a, b) => scores[b] - scores[a]);
	const winner = sorted[0];
	const second = sorted[1];

	if (scores[winner] === 0) {
		return { value: ',', confidence: 0.3 };
	}

	const confidence = scores[winner] / (scores[winner] + scores[second] + 1e-9);
	return { value: winner, confidence: Math.min(confidence, 1.0) };
}

// ─── detectSkipRows ────────────────────────────────────────────────────────

/**
 * Scan lines to find the header row by checking if a line's cells match
 * at least 3 required semantic fields (date, description, amount).
 */
export function detectSkipRows(lines: string[], delimiter: string, maxScan = 20): FieldDetection {
	const required: SemanticField[] = ['date', 'description', 'amount'];
	const scanLines = lines.slice(0, maxScan);

	for (let i = 0; i < scanLines.length; i++) {
		const cells = scanLines[i].split(delimiter).map((c) => c.trim());
		const mapping = detectSemanticMapping(cells);
		const foundRequired = required.filter((f) => mapping[f].value !== null);
		if (foundRequired.length >= 2) {
			// Found at least 2 of 3 required fields — treat this as the header row
			const confidence = i === 0 ? 0.9 : 0.7;
			return { value: String(i), confidence };
		}
	}

	// No header found — assume row 0 and warn
	return { value: '0', confidence: 0.3 };
}

// ─── detectSemanticMapping ─────────────────────────────────────────────────

/**
 * Map CSV headers to semantic fields using synonym matching.
 * Fields are assigned in FIELD_PRIORITY order; each header is claimed exclusively.
 */
export function detectSemanticMapping(headers: string[]): Record<SemanticField, FieldDetection> {
	const claimed = new Set<string>();
	const result = {} as Record<SemanticField, FieldDetection>;

	for (const field of FIELD_PRIORITY) {
		const synonyms = SEMANTIC_SYNONYMS[field].map(norm);
		let bestHeader: string | null = null;
		let bestScore = 0;

		for (const header of headers) {
			if (claimed.has(header)) continue;
			const normH = norm(header);

			let score = 0;
			if (synonyms.includes(normH)) {
				score = 1.0; // exact match
			} else if (synonyms.some((s) => normH.includes(s) || s.includes(normH))) {
				score = 0.6; // substring match
			}

			if (score > bestScore) {
				bestScore = score;
				bestHeader = header;
			}
		}

		if (bestScore > 0 && bestHeader !== null) {
			claimed.add(bestHeader);
			result[field] = { value: bestHeader, confidence: bestScore };
		} else {
			result[field] = { value: null, confidence: 0 };
		}
	}

	return result;
}

// ─── detectDateFormat ──────────────────────────────────────────────────────

/**
 * Detect date format by trying all CANDIDATE_DATE_FORMATS against sample values.
 * Picks the format with the highest success rate, breaking ties by format specificity.
 */
export function detectDateFormat(samples: string[]): FieldDetection {
	// Filter: must be ≥6 chars and not purely alphabetic
	const valid = samples
		.map((s) => s.trim())
		.filter((s) => s.length >= 6 && !/^[a-zA-Z\s]+$/.test(s))
		.slice(0, 20);

	if (valid.length === 0) {
		return { value: CANDIDATE_DATE_FORMATS[0], confidence: 0.1, candidatesTried: [] };
	}

	const tried: string[] = [];
	const rates: Array<{ format: string; rate: number }> = [];

	for (const format of CANDIDATE_DATE_FORMATS) {
		tried.push(format);
		let successes = 0;
		for (const s of valid) {
			try {
				const parsed = dateFnsParse(s, format, DATE_PARSE_REFERENCE);
				if (isValid(parsed)) {
					const year = getYear(parsed);
					if (year >= 1970 && year <= 2100) {
						successes++;
					}
				}
			} catch {
				// ignore parse errors
			}
		}
		rates.push({ format, rate: successes / valid.length });
	}

	// Sort by rate DESC, then format.length DESC (longer = more specific = fewer false positives)
	rates.sort((a, b) => b.rate - a.rate || b.format.length - a.format.length);

	const winner = rates[0];
	const second = rates[1];
	const warnings: string[] = [];

	// Warn if two formats are nearly tied (ambiguous)
	if (second && Math.abs(winner.rate - second.rate) < 0.05 && winner.rate > 0) {
		warnings.push(
			`Date format ambiguous: '${winner.format}' and '${second.format}' both matched ${(winner.rate * 100).toFixed(0)}%`
		);
	}

	let confidence: number;
	if (winner.rate >= 0.95) confidence = 1.0;
	else if (winner.rate >= 0.7) confidence = 0.7;
	else if (winner.rate >= 0.5) confidence = 0.5;
	else confidence = 0.2;

	return {
		value: winner.format,
		confidence,
		candidatesTried: tried
	};
}

// ─── detectAdaptiveProfile ─────────────────────────────────────────────────

/**
 * Top-level adaptive detection. Assembles a ResolvedProfile from a raw buffer
 * by running all detection algorithms in sequence.
 *
 * For CSV: charset → decode → delimiter → skipRows → header parsing →
 *          semantic mapping → date format detection → assemble profile
 *
 * For XLSX: use XLSX lib to read rows as strings → skipRows detection →
 *           semantic mapping → date format detection → assemble profile
 */
export function detectAdaptiveProfile(
	buffer: Buffer,
	fileType: 'csv' | 'xlsx'
): { profile: ResolvedProfile; meta: DetectionMeta; csvText: string } {
	const warnings: string[] = [];

	if (fileType === 'xlsx') {
		return detectAdaptiveXLSX(buffer, warnings);
	}

	// ── CSV path ──────────────────────────────────────────────────────────

	// 1. Charset
	const encodingDet = detectEncoding(buffer);
	const encoding = encodingDet.value === 'iso-8859-1' ? 'iso-8859-1' : 'utf-8';
	const csvText = buffer.toString(encoding === 'iso-8859-1' ? 'latin1' : 'utf8');

	// 2. Delimiter
	const delimiterDet = detectDelimiter(csvText);
	const delimiter = delimiterDet.value ?? ',';

	// 3. Lines & skipRows
	const lines = csvText
		.split('\n')
		.map((l) => l.replace(/\r$/, ''))
		.filter((l) => l.trim().length > 0);

	const skipRowsDet = detectSkipRows(lines, delimiter);
	const skipRows = parseInt(skipRowsDet.value ?? '0', 10);

	// 4. Parse header row
	const headerLine = lines[skipRows] ?? '';
	const headers = headerLine.split(delimiter).map((h) => h.trim());

	// 5. Semantic mapping
	const columnMappingDetails = detectSemanticMapping(headers);

	// 6. Extract date column samples for format detection
	const dateColumn = columnMappingDetails.date.value;
	let dateFormatDet: FieldDetection;

	if (dateColumn) {
		const dataLines = lines.slice(skipRows + 1, skipRows + 22);
		const dateSamples = dataLines
			.map((l) => {
				const parts = l.split(delimiter);
				const idx = headers.indexOf(dateColumn);
				return idx >= 0 ? (parts[idx] ?? '').trim() : '';
			})
			.filter(Boolean);
		dateFormatDet = detectDateFormat(dateSamples);
		if (dateFormatDet.candidatesTried?.length) {
			// Pull out any ambiguity warnings already set inside detectDateFormat
			// (they are in the FieldDetection's candidatesTried — we can't pass them out directly,
			// so we re-derive them here with the same check)
			const rates = CANDIDATE_DATE_FORMATS.map((f) => {
				let ok = 0;
				for (const s of dateSamples.slice(0, 20)) {
					try {
						const p = dateFnsParse(s, f, DATE_PARSE_REFERENCE);
						if (isValid(p) && getYear(p) >= 1970 && getYear(p) <= 2100) ok++;
					} catch {
						/* ignore */
					}
				}
				return { format: f, rate: ok / (dateSamples.length || 1) };
			}).sort((a, b) => b.rate - a.rate || b.format.length - a.format.length);
			if (rates[1] && Math.abs(rates[0].rate - rates[1].rate) < 0.05 && rates[0].rate > 0) {
				warnings.push(
					`Date format ambiguous: '${rates[0].format}' and '${rates[1].format}' both matched ${(rates[0].rate * 100).toFixed(0)}%`
				);
			}
		}
	} else {
		warnings.push('Could not detect date column — falling back to first candidate format');
		dateFormatDet = { value: CANDIDATE_DATE_FORMATS[0], confidence: 0.1 };
	}

	// 7. Assemble profile
	const profile = buildResolvedProfile(
		fileType,
		encoding,
		delimiter,
		skipRows,
		columnMappingDetails,
		dateFormatDet.value ?? CANDIDATE_DATE_FORMATS[0]
	);

	// 8. Compute overall confidence
	const fieldConfidences = [
		encodingDet.confidence,
		delimiterDet.confidence,
		skipRowsDet.confidence,
		dateFormatDet.confidence,
		columnMappingDetails.date.confidence,
		columnMappingDetails.description.confidence,
		columnMappingDetails.amount.confidence
	];
	const overallConfidence = fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length;

	if (overallConfidence < 0.7) {
		warnings.push(
			`Low detection confidence (${(overallConfidence * 100).toFixed(0)}%) — please review column mappings`
		);
	}

	const meta: DetectionMeta = {
		usedAdaptive: true,
		detectedDelimiter: delimiterDet,
		detectedEncoding: encodingDet,
		detectedSkipRows: skipRowsDet,
		detectedDateFormat: dateFormatDet,
		columnMappingDetails,
		overallConfidence,
		warnings
	};

	return { profile, meta, csvText };
}

// ─── XLSX adaptive detection ───────────────────────────────────────────────

function detectAdaptiveXLSX(
	buffer: Buffer,
	warnings: string[]
): { profile: ResolvedProfile; meta: DetectionMeta; csvText: string } {
	const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
	const sheet = workbook.Sheets[workbook.SheetNames[0]];

	// Read all rows as strings for detection
	const rawRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
		header: 1,
		defval: '',
		raw: false
	}) as string[][];

	const lines = rawRows.map((row) => row.join('\t'));
	const skipRowsDet = detectSkipRows(lines, '\t');
	const skipRows = parseInt(skipRowsDet.value ?? '0', 10);

	const headerRow = rawRows[skipRows] ?? [];
	const headers = headerRow.map((h) => String(h).trim());
	const columnMappingDetails = detectSemanticMapping(headers);

	// Date format from samples
	const dateColumn = columnMappingDetails.date.value;
	let dateFormatDet: FieldDetection;

	if (dateColumn) {
		const dateIdx = headers.indexOf(dateColumn);
		const dateSamples = rawRows
			.slice(skipRows + 1, skipRows + 22)
			.map((row) => String(row[dateIdx] ?? '').trim())
			.filter(Boolean);
		dateFormatDet = detectDateFormat(dateSamples);
	} else {
		warnings.push('Could not detect date column in XLSX');
		dateFormatDet = { value: CANDIDATE_DATE_FORMATS[0], confidence: 0.1 };
	}

	const encodingDet: FieldDetection = { value: 'utf-8', confidence: 1.0 };
	const delimiterDet: FieldDetection = { value: '\t', confidence: 1.0 };

	const profile = buildResolvedProfile(
		'xlsx',
		'utf-8',
		'\t',
		skipRows,
		columnMappingDetails,
		dateFormatDet.value ?? CANDIDATE_DATE_FORMATS[0]
	);

	const fieldConfidences = [
		skipRowsDet.confidence,
		dateFormatDet.confidence,
		columnMappingDetails.date.confidence,
		columnMappingDetails.description.confidence,
		columnMappingDetails.amount.confidence
	];
	const overallConfidence = fieldConfidences.reduce((a, b) => a + b, 0) / fieldConfidences.length;

	if (overallConfidence < 0.7) {
		warnings.push(`Low XLSX detection confidence (${(overallConfidence * 100).toFixed(0)}%)`);
	}

	const meta: DetectionMeta = {
		usedAdaptive: true,
		detectedDelimiter: delimiterDet,
		detectedEncoding: encodingDet,
		detectedSkipRows: skipRowsDet,
		detectedDateFormat: dateFormatDet,
		columnMappingDetails,
		overallConfidence,
		warnings
	};

	return { profile, meta, csvText: '' };
}

// ─── buildResolvedProfile ──────────────────────────────────────────────────

function buildResolvedProfile(
	fileType: 'csv' | 'xlsx',
	encoding: string,
	delimiter: string,
	skipRows: number,
	mapping: Record<SemanticField, FieldDetection>,
	dateFormat: string
): ResolvedProfile {
	const m = (f: SemanticField) => mapping[f].value;

	// Determine amount configuration: prefer single signed column; fall back to debit/credit split
	const amountColumn = m('amount');
	const debitColumn = amountColumn ? null : m('debit');
	const creditColumn = amountColumn ? null : m('credit');

	return {
		_isAdaptive: true,
		fileType,
		bankProfileId: 'adaptive',
		displayName: 'Auto-detected',
		encoding,
		delimiter,
		skipRows,
		dateColumn: m('date') ?? '',
		dateFormat,
		valueDateColumn: m('valueDate'),
		amountColumn,
		debitColumn,
		creditColumn,
		descriptionColumn: m('description') ?? '',
		currencyColumn: m('currency'),
		localAmountColumn: m('localAmount'),
		balanceColumn: m('balance'),
		statusColumn: m('status'),
		typeColumn: m('type'),
		transferTypes: [],
		fxCandidateTypes: [],
		additionalColumns: []
	};
}
