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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getProfile, parseCSV } from '../../src/lib/server/parsers/index.js';
import {
	computeCostBasis,
	propagateRateToAccount,
	rescanWorkspaceConversions
} from '../../src/lib/server/currency-converter.js';
import { queryCategoryBreakdown } from '../../src/lib/server/db/queries.js';
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

	// ── 2. Cross-bank: EUR leg is unflagged AND non-descriptive → NOT auto-linked ──
	// Confident-match policy: the EUR leg must LOOK like an FX row — flagged at parse time
	// or recognisable from its description. An unflagged EUR row whose description is an
	// ordinary purchase/withdrawal (not a conversion) is deliberately left for the user to
	// link manually — this is what stops the matcher inventing nonsense pairs.
	console.log('\n2. EUR leg unflagged + non-descriptive → left for manual linking (no nonsense pair)');
	{
		const ws = await freshWorkspace('__fx_ws2__');
		const eurAcct = await createAccount(ws, 'EUR', 'Bankinter EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		// A −200 EUR row on the same day, but an ordinary card purchase: unflagged AND its
		// description names no conversion, so neither FX signal (flag nor description) fires.
		const eurPurchase: NormalizedTransaction = {
			...eurFunder,
			description: 'Hkd Cua Hang Benmart',
			runningBalance: null,
			sourceIndex: 0
		};
		await insertRows(eurAcct, [eurPurchase], false);
		await insertRows(sekAcct, [sekAnchor]);

		const results = await rescanWorkspaceConversions(ws);
		const conv = results.find((r) => r.toAccountId === sekAcct);
		assert('no conversion auto-detected against an unflagged, non-FX EUR leg', !conv, `got ${results.length}`);
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

	// ── 7. Description-only signal: unflagged legs that NAME a conversion still pair ──
	// Rows imported before the isFxCandidate flag existed (or from a bank without a type
	// column) carry the flag as false, but their description reads "Conversión a SEK".
	// Live description matching in the detectors re-enables their pairing.
	console.log('\n7. Unflagged but descriptive legs auto-pair via the description signal');
	{
		const ws = await freshWorkspace('__fx_ws7__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		// BOTH legs forced unflagged; only their "Conversión a SEK" descriptions identify them.
		await insertRows(eurAcct, [eurFunder], false);
		await insertRows(sekAcct, [sekAnchor], false);

		const results = await rescanWorkspaceConversions(ws);
		const conv = results.find((r) => r.toAccountId === sekAcct);
		assert('conversion detected from description alone (both legs unflagged)', !!conv, `got ${results.length}`);
		assert('funds from the EUR account', conv?.fromAccountId === eurAcct);
		assert('exchangeRate ≈ 10.813', !!conv && approx(conv.exchangeRate, 10.813, 0.001));
	}

	// ── 8. Linking a conversion clears any stale transfer flag on both legs (A2) ──
	console.log('\n8. Conversion & transfer are mutually exclusive (link clears is_transfer)');
	{
		const ws = await freshWorkspace('__fx_ws8__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		// Insert both flagged FX legs but ALSO pre-marked as transfers (the overloaded state
		// this fix cleans up). isTransferCandidate → insertRows writes isTransfer = true.
		await insertRows(eurAcct, [{ ...eurFunder, isTransferCandidate: true, runningBalance: null }]);
		await insertRows(sekAcct, [{ ...sekAnchor, isTransferCandidate: true, runningBalance: null }]);

		const results = await rescanWorkspaceConversions(ws);
		assert('conversion detected for the pre-flagged-as-transfer legs', results.length === 1, `got ${results.length}`);

		const legs = await db
			.select({ isTransfer: transactions.isTransfer, tc: transactions.transferCounterpartId })
			.from(transactions)
			.where(inArray(transactions.bankAccountId, [eurAcct, sekAcct]));
		assert(
			'is_transfer cleared on both legs after linking',
			legs.length === 2 && legs.every((l) => l.isTransfer === false && l.tc === null),
			legs.map((l) => `${l.isTransfer}`).join(',')
		);
	}

	// ── 9. Reporting excludes conversion legs (A1) — even with is_transfer = false ──
	// A settled conversion leg is a movement, not income/spend. queryCategoryBreakdown must
	// drop it via conversionCounterpartId, independent of the transfer flag.
	console.log('\n9. Conversion legs are excluded from insights aggregation');
	{
		const ws = await freshWorkspace('__fx_ws9__');
		const eurAcct = await createAccount(ws, 'EUR', 'Revolut EUR');
		const sekAcct = await createAccount(ws, 'SEK', 'Revolut SEK');
		await insertRows(eurAcct, [eurFunder]); // flagged; will link (is_transfer = false)
		await insertRows(sekAcct, [sekAnchor]);

		await rescanWorkspaceConversions(ws);
		const breakdown = await queryCategoryBreakdown([eurAcct, sekAcct]);
		assert(
			'both conversion legs excluded from the category breakdown',
			breakdown.length === 0,
			`buckets: ${JSON.stringify(breakdown)}`
		);
	}
	// ── 10. Moving weighted-average cost basis (#66) — pure ─────────────────────
	// computeCostBasis is the pure core of propagateRateToAccount: rows + top-ups in, values out.
	console.log('\n10. Weighted-average cost basis (computeCostBasis, #66)');
	{
		let seq = 0;
		const base = Date.UTC(2026, 0, 1);
		// `at` is a UTC wall-clock 'YYYY-MM-DDTHH:mm'; createdAt increases with call order.
		const row = (id: string, amount: number, at: string, status = 'posted') => ({
			id,
			amount: amount.toFixed(4),
			status,
			accountingDate: new Date(`${at}Z`),
			createdAt: new Date(base + seq++ * 1000),
			originalOrder: null,
			csvUploadId: null
		});
		const topUps = (entries: [string, number][]) =>
			new Map(entries.map(([id, eurCost]) => [id, { conversionId: `conv-${id}`, eurCost }]));
		const eurOf = (vals: ReturnType<typeof computeCostBasis>, id: string) =>
			vals.find((v) => v.id === id)?.amountEur ?? null;

		// Example 1 — two top-ups, expense after both (the blend, avg 30.325).
		const ex1 = computeCostBasis(
			[row('t1', 1520, '2026-01-01T10:00'), row('t2', 906, '2026-01-02T10:00'), row('e', -1000, '2026-01-03T10:00')],
			topUps([['t1', 50], ['t2', 30]]),
			[]
		);
		assert('Ex1: blended expense −1000 → −32.98 €', approx(eurOf(ex1, 'e') ?? 0, -32.98), `${eurOf(ex1, 'e')}`);
		assert('Ex1: top-up valued at its real cost (50 €)', eurOf(ex1, 't1') === 50);

		// Example 2 — expense between the two top-ups (order matters).
		const ex2 = computeCostBasis(
			[
				row('t1', 1520, '2026-01-01T10:00'),
				row('e1', -1000, '2026-01-02T10:00'),
				row('t2', 906, '2026-01-03T10:00'),
				row('e2', -500, '2026-01-04T10:00')
			],
			topUps([['t1', 50], ['t2', 30]]),
			[]
		);
		assert('Ex2: interleaved expense −1000 → −32.89 € (first top-up only)', approx(eurOf(ex2, 'e1') ?? 0, -32.89), `${eurOf(ex2, 'e1')}`);
		assert('Ex2: post-blend expense −500 → −16.52 €', approx(eurOf(ex2, 'e2') ?? 0, -16.52), `${eurOf(ex2, 'e2')}`);
		const sum2 = ex2.reduce((s, v) => s + (v.amountEur ?? 0), 0);
		assert('Ex2: Σ amountEur equals the remaining pool cost (30.59 €)', approx(sum2, 30.59), `${sum2}`);

		// Empty pool: an expense before any top-up has no cost basis.
		const empty = computeCostBasis(
			[row('e', -10, '2026-01-01T10:00'), row('t', 100, '2026-01-02T10:00')],
			topUps([['t', 10]]),
			[]
		);
		assert('empty pool → expense unresolved (null)', eurOf(empty, 'e') === null);
		assert('later top-up still valued', eurOf(empty, 't') === 10);

		// Short pool: −150 against 100 costed units → unresolved without a fallback…
		const short = computeCostBasis(
			[row('t', 100, '2026-01-01T10:00'), row('e', -150, '2026-01-02T10:00')],
			topUps([['t', 10]]),
			[]
		);
		assert('short pool, no fallback → unresolved, never a partial value', eurOf(short, 'e') === null);
		// …and covered part at average + shortfall at the manual fallback rate when one exists.
		const shortFb = computeCostBasis(
			[row('t', 100, '2026-01-01T10:00'), row('e', -150, '2026-01-02T10:00')],
			topUps([['t', 10]]),
			[{ conversionId: 'manual', effectiveFrom: '2026-01-01', rate: 10 }]
		);
		assert('short pool + fallback 10/€ → −(10 + 5) = −15 €', approx(eurOf(shortFb, 'e') ?? 0, -15), `${eurOf(shortFb, 'e')}`);

		// Same day: time of day decides; without a time, entry order (createdAt) does.
		const timed = computeCostBasis(
			[row('e', -10, '2026-01-01T09:00'), row('t', 100, '2026-01-01T10:00'), row('e2', -10, '2026-01-01T11:00')],
			topUps([['t', 10]]),
			[]
		);
		assert('09:00 expense before the 10:00 top-up → unresolved', eurOf(timed, 'e') === null);
		assert('11:00 expense after the top-up → valued (−1 €)', approx(eurOf(timed, 'e2') ?? 0, -1));
		const untimed = computeCostBasis(
			[row('t', 100, '2026-01-01T00:00'), row('e', -10, '2026-01-01T00:00')],
			topUps([['t', 10]]),
			[]
		);
		assert('no time: entered after the top-up → valued', approx(eurOf(untimed, 'e') ?? 0, -1));

		// Pending rows are valued for display but never move the pool.
		const pending = computeCostBasis(
			[row('t', 100, '2026-01-01T10:00'), row('p', -100, '2026-01-02T10:00', 'pending'), row('e', -100, '2026-01-03T10:00')],
			topUps([['t', 10]]),
			[]
		);
		assert('pending row does not drain the pool', approx(eurOf(pending, 'e') ?? 0, -10), `${eurOf(pending, 'e')}`);

		// Outbound conversion leg (foreign → EUR) leaves at the average cost like an expense.
		const outbound = computeCostBasis(
			[row('t', 100, '2026-01-01T10:00'), row('o', -50, '2026-01-02T10:00')],
			topUps([['t', 10], ['o', 6]]),
			[]
		);
		assert('outbound conversion leg leaves at average cost (−5 €)', approx(eurOf(outbound, 'o') ?? 0, -5));

		// Draining the account exactly (float noise in the pool) is not a shortfall.
		const drain = computeCostBasis(
			[row('t', 2162.6, '2026-01-01T10:00'), row('e', -2050.3, '2026-01-02T10:00'), row('o', -112.3, '2026-01-03T10:00')],
			topUps([['t', 200], ['o', 10.26]]),
			[]
		);
		assert('exact drain: final leg valued, not unresolved', eurOf(drain, 'o') !== null, `${eurOf(drain, 'o')}`);
		const drainSum = drain.reduce((s, v) => s + (v.amountEur ?? 0), 0);
		assert('exact drain: Σ amountEur ≈ 0 for a zero balance', approx(drainSum, 0), `${drainSum}`);
	}

	// ── 11. propagateRateToAccount on a cash account — intermediate top-up (#66) ──
	// A top-up recorded later but dated between existing expenses must re-value only the
	// expenses after it; re-running is idempotent.
	console.log('\n11. Cash account: inserting an intermediate top-up re-values later rows');
	{
		const ws = await freshWorkspace('__fx_ws11__');
		const eurAcct = await createAccount(ws, 'EUR', 'EUR');
		const penAcct = await createAccount(ws, 'PEN', 'Cash PEN');

		const addRow = async (accountId: string, amount: number, day: string, currency: string) => {
			const [r] = await db
				.insert(transactions)
				.values({
					bankAccountId: accountId,
					accountingDate: new Date(`${day}T00:00:00Z`),
					amount: amount.toFixed(4),
					currency,
					description: `row ${amount}`,
					payerUserId: OWNER,
					status: 'posted',
					syncSource: 'manual'
				})
				.returning({ id: transactions.id });
			return r.id;
		};
		const addTopUp = async (pen: number, eur: number, day: string) => {
			const eurId = await addRow(eurAcct, -eur, day, 'EUR');
			const penId = await addRow(penAcct, pen, day, 'PEN');
			await db.insert(currencyConversions).values({
				workspaceId: ws,
				fromAccountId: eurAcct,
				toAccountId: penAcct,
				fromAmount: eur.toFixed(4),
				toAmount: pen.toFixed(4),
				exchangeRate: (pen / eur).toFixed(6),
				effectiveFrom: new Date(`${day}T00:00:00Z`),
				confidence: 'manual',
				fromTransactionId: eurId,
				toTransactionId: penId
			});
		};
		const valueOf = async (id: string) => {
			const [r] = await db
				.select({ amountEur: transactions.amountEur })
				.from(transactions)
				.where(eq(transactions.id, id));
			return r.amountEur != null ? parseFloat(r.amountEur as unknown as string) : null;
		};

		await addTopUp(400, 100, '2026-09-28'); // 4 PEN/€
		const early = await addRow(penAcct, -40, '2026-09-29', 'PEN');
		const late = await addRow(penAcct, -40, '2026-10-02', 'PEN');
		await propagateRateToAccount(penAcct);
		assert('before: early expense −40 PEN → −10 €', approx((await valueOf(early)) ?? 0, -10));
		assert('before: late expense −40 PEN → −10 €', approx((await valueOf(late)) ?? 0, -10));

		// A cheaper top-up (8 PEN/€) dated 30/09, entered after the expenses.
		await addTopUp(400, 50, '2026-09-30');
		await propagateRateToAccount(penAcct);
		// Pool after early: 360 PEN / 90 €; + 400/50 → 760 PEN / 140 € → avg 0.18421 €/PEN.
		assert('after: early expense unchanged (−10 €)', approx((await valueOf(early)) ?? 0, -10));
		assert('after: late expense re-valued at the blend (−7.37 €)', approx((await valueOf(late)) ?? 0, -7.37), `${await valueOf(late)}`);

		const snapshot = async () =>
			(
				await db
					.select({ id: transactions.id, e: transactions.amountEur, r: transactions.exchangeRate })
					.from(transactions)
					.where(eq(transactions.bankAccountId, penAcct))
			)
				.map((x) => `${x.id}:${x.e}:${x.r}`)
				.sort()
				.join('|');
		const first = await snapshot();
		await propagateRateToAccount(penAcct);
		assert('propagateRateToAccount is idempotent', first === (await snapshot()));

		const [{ total }] = await db
			.select({ total: sql<string>`SUM(${transactions.amountEur})` })
			.from(transactions)
			.where(eq(transactions.bankAccountId, penAcct));
		// 100 + 50 − 10 − 7.37 = 132.63 € for the 720 PEN left.
		assert('Σ amountEur = remaining cost basis (132.63 €)', approx(parseFloat(total), 132.63), total);
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
// Exit explicitly: the app's own db pool (imported transitively) would keep the process alive.
process.exit(failed > 0 ? 1 : 0);
