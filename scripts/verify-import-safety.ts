/**
 * Regression checks for two import-safety guarantees. Pure (no DB / no network),
 * so it runs anywhere with just tsx:
 *
 *   npx tsx scripts/verify-import-safety.ts   (or: npm test)
 *
 * 1. Revolut mobile export — the phone CSV ships double-encoded UTF-8 (`ó` → `Ã³`).
 *    repairMojibake must fix it so the standard `revolut_eu` profile still maps
 *    description / fee / value-date, and clean files must pass through untouched.
 * 2. Re-upload enrichment — an empty incoming notes/category/city cell must NEVER
 *    overwrite an existing value (computeEnrichmentDelta), so a round-trip re-import
 *    can't wipe user edits.
 *
 * Exit code 0 = all pass, 1 = at least one failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { uploadAndParse } from '../src/lib/server/parsers/index.ts';
import { repairMojibake } from '../src/lib/server/parsers/detector.ts';
import { computeEnrichmentDelta, type EnrichableExisting } from '../src/lib/server/enrichment.ts';
import type { NormalizedTransaction } from '../src/lib/server/parsers/types.ts';

let failures = 0;
function check(name: string, cond: boolean, detail = '') {
	if (cond) {
		console.log(`  ✓ ${name}`);
	} else {
		failures++;
		console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
	}
}

function fileFrom(relPath: string): File {
	const buf = fs.readFileSync(path.resolve(relPath));
	// Minimal File shim — uploadAndParse only reads name, type, and arrayBuffer().
	return {
		name: path.basename(relPath),
		type: 'text/csv',
		arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
	} as unknown as File;
}

// ─── Feature 1: mojibake repair + Revolut phone parse ────────────────────────

async function verifyRevolutPhone() {
	console.log('\nFeature 1 — Revolut mobile (double-encoded UTF-8) repair');

	// repairMojibake unit behaviour
	check(
		'repairs a mojibake header',
		repairMojibake('DescripciÃ³n,ComisiÃ³n') === 'Descripción,Comisión'
	);
	check(
		'leaves clean accented text untouched',
		repairMojibake('Descripción,Conversión a VND') === 'Descripción,Conversión a VND'
	);
	check(
		'leaves plain ASCII untouched',
		repairMojibake('Tipo,Producto,Importe') === 'Tipo,Producto,Importe'
	);

	// Full parse of the phone export with the standard profile hint.
	const { result } = await uploadAndParse(
		fileFrom('tests/data/revolut_from_phone.csv'),
		'revolut_eu'
	);
	const { rows, skippedCount } = result;

	check('parses rows', rows.length > 0, `got ${rows.length}`);
	check('skips nothing', skippedCount === 0, `skipped ${skippedCount}`);
	check(
		'every row has a description',
		rows.every((r) => r.description.trim() !== '')
	);
	check(
		'maps a known description verbatim',
		rows.some((r) => r.description.includes('MARTIN PEREZ CHUECOS SANCHEZ')),
		'description column did not map'
	);
	check(
		'maps value-date (Fecha de finalización)',
		rows.some((r) => r.valueDate !== null)
	);

	// No regression: a clean (correctly-encoded) Revolut file keeps its accents.
	const clean = await uploadAndParse(fileFrom('tests/data/revolut_VND.csv'), 'revolut_eu');
	check('clean file still parses', clean.result.rows.length > 0);
	check(
		'clean file preserves accented description',
		clean.result.rows.some((r) => r.description.includes('Conversión'))
	);
}

// ─── Feature 2: empty cells never clobber existing enrichment ────────────────

function row(partial: Partial<NormalizedTransaction>): NormalizedTransaction {
	return partial as NormalizedTransaction;
}

const existingRich: EnrichableExisting = {
	category: 'Groceries',
	categoryAI: null,
	categoryOverride: 'Food',
	costGroup: 'Household',
	notes: 'split with Ana',
	city: 'Barcelona'
};

function verifyNoClobber() {
	console.log('\nFeature 2 — empty re-import cells never overwrite existing enrichment');

	check(
		'empty-string cells produce no delta',
		computeEnrichmentDelta(
			existingRich,
			row({ category: '', costGroup: '', notes: '', city: '' })
		) === undefined
	);
	check(
		'whitespace-only cells produce no delta',
		computeEnrichmentDelta(existingRich, row({ notes: '   ', city: '\t' })) === undefined
	);
	check(
		'absent cells produce no delta',
		computeEnrichmentDelta(existingRich, row({})) === undefined
	);

	const changed = computeEnrichmentDelta(existingRich, row({ notes: 'updated note' }));
	check('a new non-empty note is applied', changed?.notes === 'updated note');
	check(
		'applying a note does not touch category/city',
		changed?.categoryOverride === undefined && changed?.city === undefined
	);

	check(
		'category equal to effective override produces no delta',
		computeEnrichmentDelta(existingRich, row({ category: 'Food' })) === undefined
	);

	const catChange = computeEnrichmentDelta(existingRich, row({ category: 'Dining' }));
	check(
		'a genuinely changed category writes categoryOverride',
		catChange?.categoryOverride === 'Dining'
	);

	// Existing empty, incoming empty → still nothing.
	const emptyExisting: EnrichableExisting = {
		category: null,
		categoryAI: null,
		categoryOverride: null,
		costGroup: null,
		notes: null,
		city: null
	};
	check(
		'empty existing + empty incoming → no delta',
		computeEnrichmentDelta(emptyExisting, row({ notes: '', category: '' })) === undefined
	);
}

async function main() {
	await verifyRevolutPhone();
	verifyNoClobber();

	console.log('');
	if (failures > 0) {
		console.error(`✗ ${failures} check(s) failed`);
		process.exit(1);
	}
	console.log('✓ all import-safety checks passed');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
