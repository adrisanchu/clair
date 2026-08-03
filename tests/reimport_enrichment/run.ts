#!/usr/bin/env tsx
/**
 * Enrichment round-trip integration test (issue #42).
 *
 * Exercises the export → edit → re-import contract against real Postgres:
 *   - the real `computeEnrichmentDelta` from src (the pure diff production uses), and
 *   - the exact tier-0 (internal id) and tier-2 (date+amount+description) matching
 *     queries `classifyRow` runs — replicated here with a throw-away client, the same
 *     way tests/dedup_detector/db-test.ts validates classifyRow without importing the
 *     db-coupled module.
 *
 * Creates a throw-away bank account, inserts baseline transactions, then simulates a
 * re-imported (edited) export and asserts what would be written. Cleans up on exit.
 *
 * Run: npx tsx tests/reimport_enrichment/run.ts
 * Requires: docker compose up -d && a seeded user (npm run db:seed).
 */

// ── Load .env (same trick as seed-owner.ts) ───────────────────────────────
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

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { computeEnrichmentDelta } from '../../src/lib/server/enrichment.js';
import type { NormalizedTransaction } from '../../src/lib/server/parsers/types.js';

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

// A NormalizedTransaction with sensible defaults; override the fields a case cares about.
function mkRow(p: Partial<NormalizedTransaction>): NormalizedTransaction {
	return {
		accountingDate: new Date(Date.UTC(2024, 0, 1)),
		valueDate: null,
		amount: 0,
		currency: 'EUR',
		amountOriginal: 0,
		currencyOriginal: 'EUR',
		description: '',
		runningBalance: null,
		status: 'posted',
		rawType: null,
		isTransferCandidate: false,
		isFxCandidate: false,
		category: null,
		city: null,
		notes: null,
		internalId: null,
		sourceIndex: 0,
		...p
	};
}

const client = postgres(DATABASE_URL);
const schema = await import('../../src/lib/server/db/schema.js');
const { transactions, bankAccounts } = schema;
const db = drizzle(client, { schema });

const EXISTING_COLUMNS = {
	id: true,
	status: true,
	category: true,
	categoryAI: true,
	categoryOverride: true,
	notes: true,
	city: true
} as const;

// Replicates classifyRow tier-0 (internal id) then tier-2 (date+amount+description).
async function findMatch(accountId: string, row: NormalizedTransaction) {
	if (row.internalId) {
		const byId = await db.query.transactions.findFirst({
			where: (t, { and: a, eq: e }) => a(e(t.bankAccountId, accountId), e(t.id, row.internalId!)),
			columns: EXISTING_COLUMNS
		});
		if (byId) return byId;
	}
	return db.query.transactions.findFirst({
		where: (t, { and: a, eq: e, sql: s }) =>
			a(
				e(t.bankAccountId, accountId),
				e(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`,
				s`md5(${t.description}) = md5(${row.description})`
			),
		columns: EXISTING_COLUMNS
	});
}

const user = await db.query.authUser.findFirst({ columns: { id: true, workspaceId: true } });
if (!user?.workspaceId) {
	console.error('No seeded user found — run: npm run db:seed first');
	await client.end();
	process.exit(1);
}

const [account] = await db
	.insert(bankAccounts)
	.values({
		ownerUserId: user.id,
		workspaceId: user.workspaceId,
		displayName: '__ENRICH_TEST__',
		institutionName: 'Test',
		bankProfileId: 'revolut_eu',
		ibanLast4: '0000',
		currency: 'EUR'
	})
	.returning({ id: bankAccounts.id });

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' Enrichment round-trip — classifyRow matching + computeEnrichmentDelta');
console.log('══════════════════════════════════════════════════════════════════\n');

const D1 = new Date(Date.UTC(2024, 2, 1));
const D2 = new Date(Date.UTC(2024, 2, 2));
const D3 = new Date(Date.UTC(2024, 2, 3));

try {
	// ── Baseline: what a first import + AI tagging would have produced ────────
	// A) file-provided category (raw), no AI.
	const [txA] = await db
		.insert(transactions)
		.values({
			bankAccountId: account.id,
			accountingDate: D1,
			amount: '-20.0000',
			currency: 'EUR',
			amountOriginal: '-20.0000',
			currencyOriginal: 'EUR',
			description: 'Grocery Store',
			category: 'Food', // raw bank-file value
			payerUserId: user.id
		})
		.returning({ id: transactions.id });

	// B) no file category → AI guessed it (categoryAI only).
	const [txB] = await db
		.insert(transactions)
		.values({
			bankAccountId: account.id,
			accountingDate: D2,
			amount: '-10.0000',
			currency: 'EUR',
			amountOriginal: '-10.0000',
			currencyOriginal: 'EUR',
			description: 'Netflix',
			categoryAI: 'Entertainment',
			categoryConfidence: '0.900',
			payerUserId: user.id
		})
		.returning({ id: transactions.id });

	// C) two genuinely identical bank rows (same date+amount+description).
	const [txC1] = await db
		.insert(transactions)
		.values({
			bankAccountId: account.id,
			accountingDate: D3,
			amount: '-3.0000',
			currency: 'EUR',
			amountOriginal: '-3.0000',
			currencyOriginal: 'EUR',
			description: 'Coffee',
			payerUserId: user.id
		})
		.returning({ id: transactions.id });
	const [txC2] = await db
		.insert(transactions)
		.values({
			bankAccountId: account.id,
			accountingDate: D3,
			amount: '-3.0000',
			currency: 'EUR',
			amountOriginal: '-3.0000',
			currencyOriginal: 'EUR',
			description: 'Coffee',
			payerUserId: user.id
		})
		.returning({ id: transactions.id });

	// ── 1. Re-import unchanged export → every row is a true duplicate, no delta ──
	console.log('1. Unchanged re-import → no writes');
	{
		const rowA = mkRow({
			internalId: txA.id,
			accountingDate: D1,
			amount: -20,
			description: 'Grocery Store',
			category: 'Food' // effective was 'Food' (raw)
		});
		const rowB = mkRow({
			internalId: txB.id,
			accountingDate: D2,
			amount: -10,
			description: 'Netflix',
			category: 'Entertainment' // effective was the AI value
		});
		const mA = await findMatch(account.id, rowA);
		const mB = await findMatch(account.id, rowB);
		assert('row A matches the file-category row', mA?.id === txA.id);
		assert('row B matches the AI-category row', mB?.id === txB.id);
		assert('unchanged raw category → no delta', computeEnrichmentDelta(mA!, rowA) === undefined);
		assert('unchanged AI category → no delta (AI not disturbed)', computeEnrichmentDelta(mB!, rowB) === undefined);
	}

	// ── 2. Edited Category → categoryOverride; raw/AI untouched ─────────────────
	console.log('\n2. Edited Category → override, raw + AI pristine');
	{
		const rowA = mkRow({
			internalId: txA.id,
			accountingDate: D1,
			amount: -20,
			description: 'Grocery Store',
			category: 'Groceries' // user changed Food → Groceries
		});
		const m = await findMatch(account.id, rowA);
		const delta = computeEnrichmentDelta(m!, rowA);
		assert('delta records the changed category as an override', delta?.categoryOverride === 'Groceries');
		assert('delta leaves notes/city out', delta?.notes === undefined && delta?.city === undefined);

		// Apply it the way the import loop would, then read back.
		await db
			.update(transactions)
			.set({ categoryOverride: delta!.categoryOverride, categoryOverrideById: user.id })
			.where(eq(transactions.id, txA.id));
		const after = await db.query.transactions.findFirst({
			where: eq(transactions.id, txA.id),
			columns: { category: true, categoryAI: true, categoryOverride: true }
		});
		assert('categoryOverride written', after?.categoryOverride === 'Groceries');
		assert('raw category untouched', after?.category === 'Food');
		assert('categoryAI untouched (null)', after?.categoryAI === null);

		// Re-importing the now-exported effective value ('Groceries') is idempotent.
		const rowAgain = mkRow({
			internalId: txA.id,
			accountingDate: D1,
			amount: -20,
			description: 'Grocery Store',
			category: 'Groceries'
		});
		const m2 = await findMatch(account.id, rowAgain);
		assert('second round-trip is idempotent (no delta)', computeEnrichmentDelta(m2!, rowAgain) === undefined);
	}

	// ── 3. Edited Notes / City → those columns update; empty leaves unchanged ───
	console.log('\n3. Edited Notes / City; empty cell leaves unchanged');
	{
		const rowB = mkRow({
			internalId: txB.id,
			accountingDate: D2,
			amount: -10,
			description: 'Netflix',
			category: 'Entertainment', // unchanged effective
			notes: 'Shared with partner',
			city: 'Madrid'
		});
		const m = await findMatch(account.id, rowB);
		const delta = computeEnrichmentDelta(m!, rowB);
		assert('notes captured', delta?.notes === 'Shared with partner');
		assert('city captured', delta?.city === 'Madrid');
		assert('unchanged category not in delta', delta?.categoryOverride === undefined);

		// Empty incoming cells must not wipe stored values.
		const emptyRow = mkRow({
			internalId: txB.id,
			accountingDate: D2,
			amount: -10,
			description: 'Netflix',
			category: '',
			notes: '',
			city: ''
		});
		assert('all-empty re-import → no delta (nothing wiped)', computeEnrichmentDelta(m!, emptyRow) === undefined);
	}

	// ── 4. Identical rows WITH distinct Id → each attributed exactly ────────────
	console.log('\n4. Identical bank rows with distinct Id → exact per-row attribution');
	{
		const editC1 = mkRow({
			internalId: txC1.id,
			accountingDate: D3,
			amount: -3,
			description: 'Coffee',
			category: 'Coffee Shops'
		});
		const editC2 = mkRow({
			internalId: txC2.id,
			accountingDate: D3,
			amount: -3,
			description: 'Coffee',
			category: 'Tips'
		});
		const m1 = await findMatch(account.id, editC1);
		const m2 = await findMatch(account.id, editC2);
		assert('id routes edit 1 to coffee #1', m1?.id === txC1.id);
		assert('id routes edit 2 to coffee #2', m2?.id === txC2.id);
		assert('coffee #1 delta', computeEnrichmentDelta(m1!, editC1)?.categoryOverride === 'Coffee Shops');
		assert('coffee #2 delta', computeEnrichmentDelta(m2!, editC2)?.categoryOverride === 'Tips');
	}

	// ── 5. Identical rows WITHOUT Id → best-effort, first match, no crash ───────
	console.log('\n5. Identical bank rows without Id → best-effort (documented)');
	{
		const noId = mkRow({
			accountingDate: D3,
			amount: -3,
			description: 'Coffee',
			category: 'Coffee Shops'
		});
		const m = await findMatch(account.id, noId);
		assert('resolves to one of the two coffees (no crash)', m?.id === txC1.id || m?.id === txC2.id);
	}
} finally {
	// ── Cleanup ───────────────────────────────────────────────────────────────
	await db.delete(transactions).where(eq(transactions.bankAccountId, account.id));
	await db.delete(bankAccounts).where(eq(bankAccounts.id, account.id));
	console.log('\nCleaned up test data.');
	await client.end();
}

console.log(`\n Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
