#!/usr/bin/env tsx
/**
 * Transfer counterpart dry-run test.
 *
 * Parses two files (Bankinter XLSX + Revolut CSV) and verifies that transfer
 * candidates in each file have matching counterparts in the other file using
 * the same criteria the DB-backed detector uses:
 *   - Opposite sign
 *   - Same absolute amount
 *   - Booking date within ±3 days
 *
 * Run: npx tsx tests/transfer_counterpart/run.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { NormalizedTransaction } from '../../src/lib/server/parsers/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const { parseXLSX, parseCSV, getProfile } = await import('../../src/lib/server/parsers/index.js');

// ── Parse both files ──────────────────────────────────────────────────────────

const bankinterProfile = getProfile('bankinter_es');
if (!bankinterProfile) throw new Error('bankinter_es profile not found');
const bankinterBuffer = readFileSync(join(dataDir, 'bankinter_Q1-2026.xlsx'));
const { rows: bankinterRows } = parseXLSX(bankinterBuffer, bankinterProfile);

const revolutProfile = getProfile('revolut_eu');
if (!revolutProfile) throw new Error('revolut_eu profile not found');
const revolutCsvText = readFileSync(join(dataDir, 'revolut_2.csv'), 'utf-8');
const { rows: revolutRows } = parseCSV(revolutCsvText, revolutProfile);

// ── Matching helpers ──────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function daysDiff(a: Date, b: Date): number {
	return Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY;
}

function fmt(n: number): string {
	return (n >= 0 ? '+' : '') + n.toFixed(2);
}

function findCounterparts(
	source: NormalizedTransaction,
	pool: NormalizedTransaction[]
): NormalizedTransaction[] {
	return pool.filter(
		(c) =>
			Math.abs(c.amount) === Math.abs(source.amount) &&
			Math.sign(c.amount) !== Math.sign(source.amount) &&
			daysDiff(source.accountingDate, c.accountingDate) <= 3
	);
}

// ── Run matching ──────────────────────────────────────────────────────────────

const bankinterTransfers = bankinterRows.filter((r) => r.isTransferCandidate);
const revolutTransfers = revolutRows.filter((r) => r.isTransferCandidate);

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(' TRANSFER COUNTERPART DRY-RUN');
console.log('══════════════════════════════════════════════════════════════════════════════');
console.log(`  Bankinter transfer candidates : ${bankinterTransfers.length}`);
console.log(`  Revolut   transfer candidates : ${revolutTransfers.length}`);

// ── Section 1: Bankinter → Revolut ───────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────────────────────────');
console.log(' Bankinter transfer candidates  →  search in Revolut (all rows)');
console.log('──────────────────────────────────────────────────────────────────────────────');

let bankinterMatched = 0;
let bankinterUnmatched = 0;

for (const r of bankinterTransfers) {
	const date = r.accountingDate.toISOString().split('T')[0];
	const counterparts = findCounterparts(r, revolutRows);

	if (counterparts.length > 0) {
		bankinterMatched++;
		console.log(`  ✓  ${date}  ${fmt(r.amount).padStart(10)}  ${r.description}`);
		for (const cp of counterparts) {
			const cpDate = cp.accountingDate.toISOString().split('T')[0];
			const diff = daysDiff(r.accountingDate, cp.accountingDate);
			console.log(
				`       ↳  ${cpDate}  ${fmt(cp.amount).padStart(10)}  ${cp.description}${diff > 0 ? `  (${diff}d apart)` : ''}`
			);
		}
	} else {
		bankinterUnmatched++;
		console.log(`  ✗  ${date}  ${fmt(r.amount).padStart(10)}  ${r.description}`);
	}
}

// ── Section 2: Revolut → Bankinter ───────────────────────────────────────────

console.log('\n──────────────────────────────────────────────────────────────────────────────');
console.log(' Revolut transfer candidates  →  search in Bankinter (all rows)');
console.log('──────────────────────────────────────────────────────────────────────────────');

let revolutMatched = 0;
let revolutUnmatched = 0;

for (const r of revolutTransfers) {
	const date = r.accountingDate.toISOString().split('T')[0];
	const counterparts = findCounterparts(r, bankinterRows);

	if (counterparts.length > 0) {
		revolutMatched++;
		console.log(`  ✓  ${date}  ${fmt(r.amount).padStart(10)}  ${r.description}`);
		for (const cp of counterparts) {
			const cpDate = cp.accountingDate.toISOString().split('T')[0];
			const diff = daysDiff(r.accountingDate, cp.accountingDate);
			console.log(
				`       ↳  ${cpDate}  ${fmt(cp.amount).padStart(10)}  ${cp.description}${diff > 0 ? `  (${diff}d apart)` : ''}`
			);
		}
	} else {
		revolutUnmatched++;
		console.log(`  ✗  ${date}  ${fmt(r.amount).padStart(10)}  ${r.description}`);
	}
}

// ── Section 3: Revolut top-ups (Recargas) coverage check ────────────────────
// 'Recargas' (bank top-ups) are included in revolut_eu.transferTypes so they are
// flagged as isTransferCandidate and will be searched as sources when Revolut is uploaded.

const revolutRecargas = revolutRows.filter((r) => r.rawType === 'Recargas');

if (revolutRecargas.length > 0) {
	const allFlagged = revolutRecargas.every((r) => r.isTransferCandidate);
	console.log('\n──────────────────────────────────────────────────────────────────────────────');
	console.log(
		` Revolut "Recargas" (top-ups) — isTransferCandidate: ${allFlagged ? '✓ all flagged' : '✗ some NOT flagged'}`
	);
	console.log('──────────────────────────────────────────────────────────────────────────────');

	for (const r of revolutRecargas) {
		const date = r.accountingDate.toISOString().split('T')[0];
		const counterparts = findCounterparts(r, bankinterRows);
		const flagged = r.isTransferCandidate ? '✓' : '✗';

		if (counterparts.length > 0) {
			console.log(
				`  ${flagged}  ${date}  ${fmt(r.amount).padStart(10)}  ${r.description}  (has bankinter match)`
			);
			for (const cp of counterparts) {
				const cpDate = cp.accountingDate.toISOString().split('T')[0];
				const diff = daysDiff(r.accountingDate, cp.accountingDate);
				console.log(
					`       ↳  ${cpDate}  ${fmt(cp.amount).padStart(10)}  ${cp.description}${diff > 0 ? `  (${diff}d apart)` : ''}`
				);
			}
		} else {
			console.log(
				`  ${flagged}  ${date}  ${fmt(r.amount).padStart(10)}  ${r.description}  (no bankinter match)`
			);
		}
	}
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(' SUMMARY');
console.log('──────────────────────────────────────────────────────────────────────────────');
console.log(
	`  Bankinter → Revolut : ${bankinterMatched} matched / ${bankinterUnmatched} unmatched`
);
console.log(`  Revolut → Bankinter : ${revolutMatched} matched / ${revolutUnmatched} unmatched`);
if (revolutRecargas.length > 0) {
	const recargasWithMatch = revolutRecargas.filter(
		(r) => findCounterparts(r, bankinterRows).length > 0
	).length;
	console.log(
		`  Recargas (matches) : ${recargasWithMatch}/${revolutRecargas.length} have a bankinter counterpart`
	);
	const recargasFlagged = revolutRecargas.filter((r) => r.isTransferCandidate).length;
	console.log(
		`  Recargas flagged   : ${recargasFlagged}/${revolutRecargas.length} are isTransferCandidate`
	);
}
console.log();
