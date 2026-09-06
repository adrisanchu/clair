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

		// The symmetric self-link is set on BOTH legs, pointing at each other.
		if (conv) {
			const legs = await db
				.select({ id: transactions.id, cc: transactions.conversionCounterpartId })
				.from(transactions)
				.where(inArray(transactions.id, [conv.fromTransactionId, conv.toTransactionId]));
			const from = legs.find((l) => l.id === conv.fromTransactionId);
			const to = legs.find((l) => l.id === conv.toTransactionId);
			assert(
				'conversionCounterpartId cross-links both legs',
				from?.cc === conv.toTransactionId && to?.cc === conv.fromTransactionId,
				`from.cc=${from?.cc} to.cc=${to?.cc}`
			);
		}

		// Idempotent: a second rescan creates nothing (anchor now resolved).
		const again = await rescanWorkspaceConversions(ws);
		assert('second rescan is a no-op (no duplicate conversion)', again.length === 0, `got ${again.length}`);
	}

	// ── 2. Cross-bank: EUR funding leg is UNFLAGGED → NOT auto-linked anymore ────
	// Confident-match policy: the EUR leg must itself be a flagged FX row. An unflagged
	// nearby EUR row (a wire, a purchase, an ATM withdrawal) is deliberately left for the
	// user to link manually — this is what stops the matcher inventing nonsense pairs.
	console.log('\n2. EUR funder unflagged → left for manual linking (no nonsense pair)');
	{
		const ws = await freshWorkspace('__fx_ws2__');
		const eurAcct = await createAccount(ws, 'EUR', 'Bankinter EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		// Same −200 EUR funder, but forced unflagged (as a non-Revolut bank would import it).
		await insertRows(eurAcct, [eurFunder], false);
		await insertRows(sekAcct, [sekAnchor]);

		const results = await rescanWorkspaceConversions(ws);
		const conv = results.find((r) => r.toAccountId === sekAcct);
		assert('no conversion auto-detected against an unflagged EUR leg', !conv, `got ${results.length}`);
		assert('anchor amountEur stays null (unresolved, for manual linking)', (await anchorAmountEur(sekAcct)) === null);
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

	// ── 5. One EUR funder must not back two foreign anchors (over-pairing guard) ─
	console.log('\n5. A single EUR funder is claimed once, never reused');
	{
		const ws = await freshWorkspace('__fx_ws5__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');

		// A second SEK anchor on the same day as the first — both fall inside the −200 EUR
		// funder's window, but only one may claim it.
		const sekAnchor2: NormalizedTransaction = {
			...sekAnchor,
			amount: 1000,
			amountOriginal: 1000,
			runningBalance: null,
			sourceIndex: 1
		};

		await insertRows(eurAcct, [eurFunder]); // single −200 EUR funder
		await insertRows(sekAcct, [sekAnchor, sekAnchor2]); // two SEK anchors

		const results = await rescanWorkspaceConversions(ws);
		assert('exactly one conversion created (funder used once)', results.length === 1, `got ${results.length}`);

		// Only ONE SEK anchor is an actual leg. (Both may carry a conversion_id — that column
		// marks the rate source via propagation, not leg membership; leg membership is the FK
		// in currency_conversions, which is what `isConversionLeg` checks in the UI.)
		const sekIds = new Set(
			(await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.bankAccountId, sekAcct))).map(
				(r) => r.id
			)
		);
		const convs = await db
			.select({ to: currencyConversions.toTransactionId })
			.from(currencyConversions)
			.where(eq(currencyConversions.workspaceId, ws));
		const sekLegs = convs.filter((c) => c.to && sekIds.has(c.to)).length;
		assert('exactly one SEK anchor is an actual conversion leg', sekLegs === 1, `legs ${sekLegs}`);
	}

	// ── 6. Rate-plausibility guard: a flagged EUR leg at an absurd rate is rejected ──
	// Once a baseline rate exists for the currency, a new match whose implied rate is wildly
	// off (a flagged EUR leg of the wrong amount) is refused and the anchor left unresolved.
	console.log('\n6. Off-rate flagged EUR leg is rejected once a baseline exists');
	{
		const ws = await freshWorkspace('__fx_ws6__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');

		const day2 = new Date('2026-05-01T10:00:00Z');
		// Second anchor (+2162.60 SEK) a month later, and a FLAGGED but tiny −5 EUR leg beside
		// it → implied rate 432.5, far outside FX_RATE_TOLERANCE of the ~10.813 baseline.
		const sekAnchorLate: NormalizedTransaction = {
			...sekAnchor,
			accountingDate: day2,
			valueDate: day2,
			runningBalance: null,
			sourceIndex: 2
		};
		const badFunder: NormalizedTransaction = {
			...eurFunder,
			amount: -5,
			amountOriginal: -5,
			accountingDate: day2,
			valueDate: day2,
			runningBalance: null,
			sourceIndex: 3
		};

		await insertRows(eurAcct, [eurFunder, badFunder]); // both flagged FX
		await insertRows(sekAcct, [sekAnchor, sekAnchorLate]);

		const results = await rescanWorkspaceConversions(ws);
		assert('only the plausible conversion is created', results.length === 1, `got ${results.length}`);
		assert('the created conversion is the baseline (≈10.813)', !!results[0] && approx(results[0].exchangeRate, 10.813, 0.001));
		const convCount = (
			await db.select({ id: currencyConversions.id }).from(currencyConversions).where(eq(currencyConversions.workspaceId, ws))
		).length;
		assert('off-rate leg left unlinked (1 conversion row total)', convCount === 1, `rows ${convCount}`);
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
