#!/usr/bin/env tsx
/**
 * Export serialisation + round-trip tests.
 *
 * Verifies toCsv() produces a round-trip-safe CSV and that re-importing it
 * through the adaptive parser maps every column back to the right field.
 *
 * Run: npx tsx tests/export/run.ts
 */
export {}; // mark as a module so top-level await type-checks

const { toCsv, EXPORT_HEADERS } = await import('../../src/lib/server/export/toCsv.js');
const { uploadAndParse } = await import('../../src/lib/server/parsers/index.js');

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
	if (condition) {
		console.log(`  ✓  ${label}`);
		passed++;
	} else {
		console.log(`  ✗  ${label}${detail ? ` — ${detail}` : ''}`);
		failed++;
	}
}

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(' Export — serialisation & round-trip');
console.log('══════════════════════════════════════════════════════════════════════════\n');

// Sample rows mirroring the shape of queryTransactionsForExport() output.
const rows = [
	{
		id: 'tx-0001',
		accountingDate: new Date(Date.UTC(2024, 5, 24)), // 2024-06-24
		amount: -12.5,
		description: 'Café La Cabra',
		currency: 'EUR',
		accountName: 'Revolut EUR',
		category: null, // no raw bank value
		categoryAI: 'Groceries', // AI tag
		categoryOverride: 'Coffee', // user override → wins on export
		costGroup: 'Copenhagen trip', // cross-cutting cost bucket
		isTransfer: false,
		notes: 'CPH Day 1',
		city: 'Copenhagen'
	},
	{
		id: 'tx-0002',
		accountingDate: new Date(Date.UTC(2024, 5, 25)), // 2024-06-25
		amount: 1500,
		description: 'Salary, June',
		currency: 'EUR',
		accountName: 'Bankinter',
		category: null,
		categoryAI: null,
		categoryOverride: null,
		costGroup: null,
		isTransfer: false,
		notes: null,
		city: null
	},
	{
		// #43: a transfer row that carries a category — the category must stay in the
		// Category cell while the transfer facet lands in the separate Type column.
		id: 'tx-0003',
		accountingDate: new Date(Date.UTC(2024, 5, 26)), // 2024-06-26
		amount: -200,
		// Deliberately avoids "transfer"/"traspaso" wording so the round-trip assertion
		// isolates the Type column (the description-pattern detector must not confound it).
		description: 'Savings pot top-up',
		currency: 'EUR',
		accountName: 'Revolut EUR',
		category: 'Savings',
		categoryAI: null,
		categoryOverride: null,
		costGroup: null,
		isTransfer: true,
		notes: null,
		city: null
	}
];

// ── Test 1: header line ────────────────────────────────────────────────────
console.log('1. Serialisation');

const csv = toCsv(rows);
const lines = csv.trim().split('\r\n');

assert(
	'header line matches expected order',
	lines[0] === EXPORT_HEADERS.join(','),
	`got: ${lines[0]}`
);
assert(
	'one data row per input row',
	lines.length === rows.length + 1,
	`got: ${lines.length} lines`
);
assert('id column emitted first', lines[1].startsWith('tx-0001,'), `got: ${lines[1]}`);
assert('date formatted yyyy-MM-dd', lines[1].startsWith('tx-0001,2024-06-24,'), `got: ${lines[1]}`);
assert('amount is dot-decimal', lines[1].includes(',-12.5,'), `got: ${lines[1]}`);
assert('effective category uses user override', lines[1].includes(',Coffee,'), `got: ${lines[1]}`);
assert('Cost Group column present in header', EXPORT_HEADERS.includes('Cost Group'));
assert('Type column present in header', EXPORT_HEADERS.includes('Type'));
assert(
	'cost group emitted after category',
	lines[1].includes(',Coffee,Copenhagen trip,'),
	`got: ${lines[1]}`
);
assert(
	'non-transfer row has empty Type (category, cost group, then empty Type cell)',
	lines[1].includes(',Coffee,Copenhagen trip,,'),
	`got: ${lines[1]}`
);
assert(
	'null enrichment → empty cells (salary row ends with commas: cost group, type, notes, city)',
	/,,,,,$/.test(lines[2]),
	`got: ${lines[2]}`
);
// #43: transfer row keeps its real category AND is marked transfer via the Type column.
assert(
	'transfer row keeps its category (Category cell not blanked)',
	lines[3].includes(',Savings,'),
	`got: ${lines[3]}`
);
assert(
	'transfer row marked in Type column (Category, empty Cost Group, then Type=transfer)',
	lines[3].includes(',Savings,,transfer,'),
	`got: ${lines[3]}`
);

// ── Test 2: round-trip through the adaptive parser ─────────────────────────
console.log('\n2. Round-trip: re-import the exported CSV');

const file = new File([csv], 'clair-transactions-export.csv', { type: 'text/csv' });
const { profileId, result } = await uploadAndParse(file, null);

assert('detected as adaptive profile', profileId === 'adaptive', `got: ${profileId}`);
assert('usedAdaptive = true', result.detectionMeta?.usedAdaptive === true);
assert(
	'all rows parsed, none skipped',
	result.rows.length === rows.length && result.skippedCount === 0,
	`parsed ${result.rows.length}, skipped ${result.skippedCount}`
);

const r0 = result.rows[0];
assert(
	'row 0 date round-trips',
	r0?.accountingDate.toISOString().slice(0, 10) === '2024-06-24',
	`got: ${r0?.accountingDate.toISOString()}`
);
assert('row 0 amount round-trips', r0?.amount === -12.5, `got: ${r0?.amount}`);
assert(
	'row 0 description round-trips',
	r0?.description === 'Café La Cabra',
	`got: ${r0?.description}`
);
assert('row 0 currency round-trips', r0?.currency === 'EUR', `got: ${r0?.currency}`);
assert('row 0 category = override value', r0?.category === 'Coffee', `got: ${r0?.category}`);
assert(
	'row 0 cost group round-trips',
	r0?.costGroup === 'Copenhagen trip',
	`got: ${r0?.costGroup}`
);
assert('row 0 notes round-trips', r0?.notes === 'CPH Day 1', `got: ${r0?.notes}`);
assert('row 0 city round-trips', r0?.city === 'Copenhagen', `got: ${r0?.city}`);
assert('row 0 internal id round-trips', r0?.internalId === 'tx-0001', `got: ${r0?.internalId}`);
assert('row 1 internal id round-trips', result.rows[1]?.internalId === 'tx-0002', `got: ${result.rows[1]?.internalId}`);

// #43: the transfer row's category survives the round-trip, and the Type column is
// inert — the adaptive parser's empty transferTypes never flip isTransferCandidate.
const r2 = result.rows[2];
assert('transfer row category round-trips', r2?.category === 'Savings', `got: ${r2?.category}`);
assert('transfer row internal id round-trips', r2?.internalId === 'tx-0003', `got: ${r2?.internalId}`);
assert(
	'Type column is informational — does not flag a transfer candidate on re-import',
	r2?.isTransferCandidate === false,
	`got: ${r2?.isTransferCandidate}`
);

console.log(`\n  Parsed ${result.rows.length} rows, skipped ${result.skippedCount}`);
console.log(
	`  Column mappings: ${result.columnMappings.map((m) => `${m.csvHeader}→${m.field}`).join(', ')}`
);

// ── Summary ────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════════\n');

if (failed > 0) process.exit(1);
