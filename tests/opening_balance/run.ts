#!/usr/bin/env tsx
/**
 * Opening balance logic test.
 * Parses revolut_balance.csv and verifies that the three balance values
 * can be derived directly from the CSV's own "Saldo" (running balance) column,
 * without requiring any manual user input.
 *
 * Definitions:
 *   openingBalance = firstRow.runningBalance - firstRow.amount
 *                  = 107.31 - (-33.00) = 140.31
 *   closingBalance = lastRow.runningBalance
 *                  = 61.58
 *   periodBalance  = sum of all row amounts
 *                  = -78.73  (net outflow over the period)
 *
 * Run: npx tsx tests/opening_balance/run.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const { parseCSV, getProfile } = await import('../../src/lib/server/parsers/index.js');

const profile = getProfile('revolut_eu');
if (!profile) throw new Error('revolut_eu profile not found');

const csvText = readFileSync(join(dataDir, 'revolut_balance.csv'), 'utf-8');
const { rows, skippedCount, errors } = parseCSV(csvText, profile);

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' revolut_balance.csv — parsed rows');
console.log('══════════════════════════════════════════════════════════════');
for (const r of rows) {
	const date = r.accountingDate.toISOString().split('T')[0];
	const amt = String(r.amount.toFixed(2)).padStart(9);
	const bal = r.runningBalance !== null ? String(r.runningBalance.toFixed(2)).padStart(9) : '        —';
	console.log(`  ${date}  amount: ${amt}  balance: ${bal}  ${r.description}`);
}
console.log(`  (${skippedCount} rows skipped, ${errors.length} errors)`);

if (rows.length === 0) {
	console.error('\n  ERROR: no rows parsed — cannot compute balances');
	process.exit(1);
}

// ── Compute balances from parsed rows ────────────────────────────────────────

const firstRow = rows.reduce((a, b) => (a.accountingDate <= b.accountingDate ? a : b));
const lastRow = rows.reduce((a, b) => (a.accountingDate >= b.accountingDate ? a : b));

if (firstRow.runningBalance === null) {
	console.error('\n  ERROR: first row has no running balance — CSV may not include a balance column');
	process.exit(1);
}
if (lastRow.runningBalance === null) {
	console.error('\n  ERROR: last row has no running balance');
	process.exit(1);
}

/**
 * The amount that was available before the first transaction in this CSV.
 * Derived by removing the first transaction's effect from the post-transaction balance.
 */
const openingBalance = firstRow.runningBalance - firstRow.amount;

/**
 * The amount remaining after the last transaction — i.e. the current account balance.
 */
const closingBalance = lastRow.runningBalance;

/**
 * Net change over all transactions in this CSV.
 */
const periodBalance = rows.reduce((sum, r) => sum + r.amount, 0);

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' BALANCE SUMMARY');
console.log('══════════════════════════════════════════════════════════════');
console.log(`  Opening balance  (saldo inicial):   ${openingBalance.toFixed(2).padStart(9)}`);
console.log(`  Period balance   (variación):       ${periodBalance.toFixed(2).padStart(9)}`);
console.log(`  Closing balance  (saldo final):     ${closingBalance.toFixed(2).padStart(9)}`);
console.log(`  Reconciliation check (open+period): ${(openingBalance + periodBalance).toFixed(2).padStart(9)}  (should equal closing)`);

// ── Assertions ────────────────────────────────────────────────────────────────

const EXPECTED_OPENING = 140.31;
const EXPECTED_CLOSING = 61.58;
const EXPECTED_PERIOD = -78.73;

function approxEq(a: number, b: number): boolean {
	return Math.abs(a - b) < 0.005; // tolerance for floating-point rounding
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' ASSERTIONS');
console.log('══════════════════════════════════════════════════════════════');

let pass = true;

function check(label: string, actual: number, expected: number) {
	const ok = approxEq(actual, expected);
	if (!ok) pass = false;
	console.log(
		`  ${ok ? '✓' : '✗'} ${label.padEnd(20)}  expected: ${expected.toFixed(2).padStart(8)}  actual: ${actual.toFixed(2).padStart(8)}`
	);
}

check('openingBalance', openingBalance, EXPECTED_OPENING);
check('periodBalance', periodBalance, EXPECTED_PERIOD);
check('closingBalance', closingBalance, EXPECTED_CLOSING);

// Sanity: opening + period should equal closing
check('open + period = close', openingBalance + periodBalance, EXPECTED_CLOSING);

console.log('──────────────────────────────────────────────────────────────');
console.log(pass ? '\n ✓ PASS — all balance assertions met\n' : '\n ✗ FAIL — see rows marked above\n');

if (!pass) process.exit(1);
