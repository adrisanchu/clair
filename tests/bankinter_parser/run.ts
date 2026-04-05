#!/usr/bin/env tsx
/**
 * Bankinter ES parser smoke test.
 * Reads the XLSX export, parses all rows, and prints a summary table.
 *
 * Run: npx tsx tests/bankinter_parser/run.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const { parseXLSX, getProfile } = await import('../../src/lib/server/parsers/index.js');

const profile = getProfile('bankinter_es');
if (!profile) throw new Error('bankinter_es profile not found');

const buffer = readFileSync(join(dataDir, 'bankinter_Q1-2026.xlsx'));

const { rows, skippedCount, errors } = parseXLSX(buffer, profile);

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(' BANKINTER_Q1-2026.XLSX — parsed rows');
console.log('══════════════════════════════════════════════════════════════════════════════');
for (const r of rows) {
	const date = r.accountingDate.toISOString().split('T')[0];
	const amount = r.amount.toFixed(2).padStart(10);
	const balance = r.runningBalance != null ? r.runningBalance.toFixed(2).padStart(10) : '          ';
	const transfer = r.isTransferCandidate ? ' [transfer]' : '';
	const fx = r.isFxCandidate ? ' [fx]' : '';
	console.log(`  ${date}  ${amount}  bal: ${balance}  ${r.description}${transfer}${fx}`);
}

console.log(
	`\n  Total parsed: ${rows.length}  |  Skipped: ${skippedCount}  |  Errors: ${errors.length}`
);

if (errors.length > 0) {
	console.log('\n  Errors:');
	for (const e of errors) {
		console.log(`    ${e}`);
	}
}

console.log();
