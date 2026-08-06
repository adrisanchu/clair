#!/usr/bin/env tsx
/**
 * Revolut fees + status parser test.
 *
 * Asserts that:
 *  - fees (Comisión) are extracted into `fee` (non-negative) and folded into `amount` as gross − fee,
 *  - Revolut states map correctly (COMPLETADO→posted, PENDIENTE→pending, DEVUELTO→reverted),
 *  - summing only the POSTED net amounts reconciles to the file's final Saldo (35622),
 *    i.e. the reverted and pending rows are excluded from the balance.
 *
 * Run: npx tsx tests/fees/run.ts
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const { parseCSV, getProfile } = await import('../../src/lib/server/parsers/index.js');

const profile = getProfile('revolut_eu');
if (!profile) throw new Error('revolut_eu profile not found');

const csvText = readFileSync(join(dataDir, 'revolut-fake-fees-and-returned.csv'), 'utf8');
const { rows, skippedCount, errors } = parseCSV(csvText, profile);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
	const ok = actual === expected;
	if (!ok) failures++;
	console.log(`  ${ok ? '✓' : '✗'} ${label}: got ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

const byDesc = (desc: string, amount: number) =>
	rows.find((r) => r.description === desc && Math.round(r.amount) === amount);

console.log('\n══════════════════════════════════════════════════════════════════════════════');
console.log(' REVOLUT FEES + STATUS');
console.log('══════════════════════════════════════════════════════════════════════════════');

console.log(`\n  Parsed ${rows.length} rows | skipped ${skippedCount} | errors ${errors.length}`);

// ── Fee extraction (stored positive, folded into net amount) ────────────────
console.log('\n Fee extraction (net = gross − fee):');
const sushi = byDesc('MMO Sushi', -2157);
check('MMO Sushi net amount', sushi?.amount, -2157);
check('MMO Sushi fee', sushi?.fee, 21);

const baili = byDesc('Bai Li Food 1688', -964);
check('Bai Li net amount', baili?.amount, -964);
check('Bai Li fee', baili?.fee, 10);

const conv = byDesc('Conversión a JPY', 45740);
check('Zero-fee row fee is 0', conv?.fee, 0);

// ── Status mapping ───────────────────────────────────────────────────────────
console.log('\n Status mapping:');
check('COMPLETADO → posted', byDesc('Bootleggers', -2975)?.status, 'posted');
check('PENDIENTE → pending', byDesc('Uber', -100)?.status, 'pending');
check('DEVUELTO → reverted', byDesc('Bolt', -479)?.status, 'reverted');

// ── Balance reconciliation (posted-only) ─────────────────────────────────────
console.log('\n Reconciliation (posted-only net sum == final Saldo):');
const postedSum = rows.filter((r) => r.status === 'posted').reduce((s, r) => s + r.amount, 0);
check('Σ posted net amounts', Math.round(postedSum), 35622);

const allSum = rows.reduce((s, r) => s + r.amount, 0);
console.log(`  (all-status sum would be ${Math.round(allSum)} — includes excluded reverted/pending)`);

console.log('\n──────────────────────────────────────────────────────────────────────────────');
if (failures > 0) {
	console.log(` ${failures} assertion(s) FAILED ✗`);
	process.exit(1);
}
console.log(' All assertions passed ✓\n');
