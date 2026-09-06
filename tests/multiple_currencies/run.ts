#!/usr/bin/env tsx
/**
 * Cross-currency conversion detection integration test (#30).
 *
 * Exercises the REAL `rescanWorkspaceConversions` against Postgres, using the SEK/EUR
 * Revolut fixtures. Each scenario builds its own throw-away workspace + accounts, runs
 * the detector, asserts, and everything is cleaned up on exit.
 *
 * The natural pair in the fixtures:
 *   - SEK anchor : +2162.60 SEK "Conversión a SEK" (Cambio, flagged) 2026-03-27  ← revolut_SEK.csv
 *   - EUR funder : −200.00 EUR "Conversión a SEK" (Cambio, flagged) 2026-03-27  ← revolut_2.csv
 *   → rate 2162.60 / 200 = 10.813
 *
 * Run (against the isolated test DB — never dev):
 *   docker compose -f compose.test.yaml up -d
 *   TSX_TSCONFIG_PATH=tests/_shims/tsconfig.tsx.json \
 *     DATABASE_URL="postgres://root:mysecretpassword@localhost:5433/local" \
 *     npx tsx tests/multiple_currencies/run.ts
 *
 * The TSX_TSCONFIG_PATH shim aliases SvelteKit's `$env/dynamic/private` so the real
 * db-coupled detector loads under tsx (see tests/_shims/).
 */

try {
	(process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env');
} catch {
	/* env may already be set */
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL not set — run from project root with .env present');
	process.exit(1);
}

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, inArray } from 'drizzle-orm';
import { getProfile, parseCSV } from '../../src/lib/server/parsers/index.js';
import { rescanWorkspaceConversions } from '../../src/lib/server/currency-converter.js';
import type { NormalizedTransaction } from '../../src/lib/server/parsers/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function assert(label: string, cond: boolean, detail?: string) {
	if (cond) {
		console.log(`  ✓  ${label}`);
		passed++;
	} else {
		console.log(`  ✗  ${label}${detail ? ` — ${detail}` : ''}`);
		failed++;
	}
}
const approx = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

const client = postgres(DATABASE_URL);
const schema = await import('../../src/lib/server/db/schema.js');
const { workspaces, bankAccounts, transactions, currencyConversions } = schema;
const db = drizzle(client, { schema });

const OWNER = '__fx_test_owner__';

// ── Parse the fixtures once ────────────────────────────────────────────────
const profile = getProfile('revolut_eu');
if (!profile) throw new Error('revolut_eu profile not found');

const sekRows = parseCSV(
	readFileSync(join(__dirname, 'data', 'revolut_SEK.csv'), 'utf-8'),
	profile
).rows;
const eurRows = parseCSV(
	readFileSync(join(__dirname, '..', 'transfer_counterpart', 'data', 'revolut_2.csv'), 'utf-8'),
	profile
).rows;

const sekAnchor = sekRows.find((r) => r.description === 'Conversión a SEK' && r.amount > 0);
const eurFunder = eurRows.find((r) => r.description === 'Conversión a SEK' && r.amount < 0);
// Foreign→EUR direction: a SEK outbound leg ("Conversión a EUR", −112.30 SEK).
const sekOutbound = sekRows.find((r) => r.description === 'Conversión a EUR' && r.amount < 0);

// ── Helpers ─────────────────────────────────────────────────────────────────
const createdWorkspaces: string[] = [];

async function freshWorkspace(name: string): Promise<string> {
	const [w] = await db
		.insert(workspaces)
		.values({ name, ownerId: OWNER })
		.returning({ id: workspaces.id });
	createdWorkspaces.push(w.id);
	return w.id;
}

async function createAccount(workspaceId: string, currency: string, name: string): Promise<string> {
	const [a] = await db
		.insert(bankAccounts)
		.values({
			ownerUserId: OWNER,
			workspaceId,
			displayName: name,
			institutionName: 'Test',
			bankProfileId: 'revolut_eu',
			ibanLast4: '0000',
			currency
		})
		.returning({ id: bankAccounts.id });
	return a.id;
}

async function insertRows(
	accountId: string,
	rows: NormalizedTransaction[],
	forceFx?: boolean
): Promise<void> {
	if (rows.length === 0) return;
	await db.insert(transactions).values(
		rows.map((r) => ({
			bankAccountId: accountId,
			accountingDate: r.accountingDate,
			valueDate: r.valueDate,
			amount: r.amount.toFixed(4),
			fee: r.fee.toFixed(4),
			currency: r.currency,
			description: r.description,
			isTransfer: r.isTransferCandidate,
			isFxCandidate: forceFx === undefined ? r.isFxCandidate : forceFx,
			status: r.status,
			payerUserId: OWNER,
			originalOrder: r.sourceIndex
		}))
	);
}

async function anchorAmountEur(accountId: string): Promise<number | null> {
	const [row] = await db
		.select({ amountEur: transactions.amountEur })
		.from(transactions)
		.where(
			and(eq(transactions.bankAccountId, accountId), eq(transactions.description, 'Conversión a SEK'))
		)
		.limit(1);
	return row?.amountEur != null ? parseFloat(row.amountEur as unknown as string) : null;
}

console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(' #30 — cross-currency conversion detection (rescanWorkspaceConversions)');
console.log('══════════════════════════════════════════════════════════════════════════\n');

try {
	// ── 0. Fixture sanity ──────────────────────────────────────────────────────
	console.log('0. Fixtures');
	assert('SEK anchor parsed (+2162.60, flagged)', !!sekAnchor && sekAnchor.isFxCandidate, `${sekAnchor?.amount}`);
	assert('EUR funder parsed (−200, flagged)', !!eurFunder && eurFunder.isFxCandidate, `${eurFunder?.amount}`);
	if (!sekAnchor || !eurFunder) throw new Error('fixtures missing the Cambio pair');

	// ── 1. Intra-Revolut: both legs flagged ────────────────────────────────────
	console.log('\n1. Both legs flagged (EUR ↔ SEK, same workspace)');
	{
		const ws = await freshWorkspace('__fx_ws1__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		await insertRows(eurAcct, eurRows);
		await insertRows(sekAcct, sekRows);

		const results = await rescanWorkspaceConversions(ws);
		const conv = results.find((r) => r.toAccountId === sekAcct);

		assert('one conversion detected for the SEK anchor', !!conv);
		assert('funds from the EUR account', conv?.fromAccountId === eurAcct);
		assert('toAmount = 2162.60 SEK', !!conv && approx(conv.toAmount, 2162.6));
		assert('fromAmount = 200 EUR', !!conv && approx(conv.fromAmount, 200));
		assert('exchangeRate ≈ 10.813', !!conv && approx(conv.exchangeRate, 10.813, 0.001));
		assert('propagated amountEur on anchor ≈ 200', approx((await anchorAmountEur(sekAcct)) ?? -1, 200, 0.05));

		// Idempotent: a second rescan creates nothing (anchor now resolved).
		const again = await rescanWorkspaceConversions(ws);
		assert('second rescan is a no-op (no duplicate conversion)', again.length === 0, `got ${again.length}`);
	}

	// ── 2. Cross-bank: EUR funding leg is UNFLAGGED (the #30 headline) ──────────
	console.log('\n2. EUR funder unflagged (cross-bank funding still links)');
	{
		const ws = await freshWorkspace('__fx_ws2__');
		const eurAcct = await createAccount(ws, 'EUR', 'Bankinter EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		// Same −200 EUR funder, but forced unflagged (as a non-Revolut bank would import it).
		await insertRows(eurAcct, [eurFunder], false);
		await insertRows(sekAcct, [sekAnchor]);

		const results = await rescanWorkspaceConversions(ws);
		const conv = results.find((r) => r.toAccountId === sekAcct);
		assert('conversion still detected with an unflagged EUR leg', !!conv);
		assert('exchangeRate ≈ 10.813', !!conv && approx(conv.exchangeRate, 10.813, 0.001));
	}

	// ── 3. No funder → anchor stays unresolved (no over-pairing) ───────────────
	console.log('\n3. No EUR funder present → nothing is invented');
	{
		const ws = await freshWorkspace('__fx_ws3__');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		await insertRows(sekAcct, [sekAnchor]);

		const results = await rescanWorkspaceConversions(ws);
		assert('no conversion created', results.length === 0, `got ${results.length}`);
		assert('anchor amountEur stays null (unresolved)', (await anchorAmountEur(sekAcct)) === null);
	}

	// ── 4. Foreign→EUR: outbound foreign anchor links to a EUR inbound leg ──────
	console.log('\n4. Foreign outbound ("Conversión a EUR") links to its EUR receiver');
	{
		if (!sekOutbound) throw new Error('fixture missing the −SEK "Conversión a EUR" leg');
		const ws = await freshWorkspace('__fx_ws4__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');

		// Synthetic EUR inbound receiver (+10.39 EUR) on the same day as the SEK outbound —
		// the leg the reverse conversion pays out to. Off exact timestamp, so only the
		// (now sign-aware) rescan can link it.
		const eurReceiver: NormalizedTransaction = {
			accountingDate: sekOutbound.accountingDate,
			valueDate: sekOutbound.valueDate,
			amount: 10.39,
			fee: 0,
			currency: 'EUR',
			amountOriginal: 10.39,
			currencyOriginal: 'EUR',
			description: 'Conversión a EUR',
			runningBalance: null,
			status: 'posted',
			rawType: 'Cambio',
			isTransferCandidate: false,
			isFxCandidate: true,
			category: null,
			costGroup: null,
			city: null,
			notes: null,
			internalId: null,
			sourceIndex: 0
		};

		await insertRows(sekAcct, [sekOutbound]);
		await insertRows(eurAcct, [eurReceiver]);

		const results = await rescanWorkspaceConversions(ws);
		const conv = results.find((r) => r.toAccountId === sekAcct);
		assert('conversion detected for the outbound SEK anchor', !!conv);
		assert('EUR is the normalised from-account', conv?.fromAccountId === eurAcct);
		assert('toAmount = 112.30 SEK (abs)', !!conv && approx(conv.toAmount, 112.3));
		assert('fromAmount = 10.39 EUR (abs)', !!conv && approx(conv.fromAmount, 10.39));
		assert('exchangeRate ≈ 10.81', !!conv && approx(conv.exchangeRate, 10.81, 0.02));
	}
} finally {
	// ── Cleanup ─────────────────────────────────────────────────────────────────
	for (const wsId of createdWorkspaces) {
		const accts = await db
			.select({ id: bankAccounts.id })
			.from(bankAccounts)
			.where(eq(bankAccounts.workspaceId, wsId));
		const acctIds = accts.map((a) => a.id);
		if (acctIds.length) {
			await db.delete(transactions).where(inArray(transactions.bankAccountId, acctIds));
			await db.delete(currencyConversions).where(eq(currencyConversions.workspaceId, wsId));
			await db.delete(bankAccounts).where(eq(bankAccounts.workspaceId, wsId));
		}
		await db.delete(workspaces).where(eq(workspaces.id, wsId));
	}
	console.log('\nCleaned up test data.');
	await client.end();
}

console.log(`\n Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
