import type { NormalizedTransaction } from './types.js';

/**
 * Lightweight heuristic pre-categorisation pass.
 *
 * For bank profiles that lack a `typeColumn` (e.g. bankinter_es), description-based
 * pattern matching fills the role that the type column plays in profiles like revolut_eu.
 *
 * Only modifies `isTransferCandidate`; never overwrites a value already set to `true`
 * by the type column. Returns a new object — never mutates the input.
 */

const TRANSFER_PATTERNS: RegExp[] = [
	/\bTRANS/i, // TRANSF, TRANSF., TRANSFERENCIA, TRANSFERENCIA EMITIDA/RECIBIDA …
	/\bTRASPASO\b/i // Spanish term for inter-account savings transfer
];

export function preCategorize(row: NormalizedTransaction): NormalizedTransaction {
	if (row.isTransferCandidate) return row; // already flagged via typeColumn — passthrough

	const isTransfer = TRANSFER_PATTERNS.some((re) => re.test(row.description));
	if (!isTransfer) return row;

	return { ...row, isTransferCandidate: true };
}
