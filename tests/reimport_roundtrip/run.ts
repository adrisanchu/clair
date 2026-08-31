#!/usr/bin/env tsx
/**
 * Cross-date-format round-trip regression (issue #56).
 *
 * Reproduces the reported scenario: a Revolut export first imported in one date
 * format (the fixture's `dd/MM/yyyy HH:mm`) and then re-imported after being
 * re-downloaded in another format (`yyyy-MM-dd HH:mm`). The two files describe the
 * *same* transactions, so the second import must be a clean no-op:
 *
 *   0 inserts · 0 status updates · 0 description updates · 0 review
 *
 * i.e. every row dedupes to `skip`, with no phantom "updated". It guards against a
 * regression where a textual date-format change slips a row past the dedup key.
 *
 * Part 2 covers the flip side: three transactions in the same minute with the same amount
 * and description, told apart only by their seconds (dd/MM/yyyy HH:mm:ss — the precision the
 * normalizer now preserves). It asserts they each dedupe to their OWN twin (not naively
 * collapsed into one duplicate), contrasts that with time-less matching which would collapse
 * them, and confirms the reverse is safe too: a re-export whose seconds shifted still dedupes
 * via the same-day fallback rather than spawning a duplicate.
 *
 * Like tests/reimport_enrichment, this drives a throw-away Postgres client and the
 * REAL parser + REAL computeEnrichmentDelta, and replicates the exact tier-2/tier-3
 * matching that classifyRow runs (classifyRow itself is coupled to the db singleton).
 *
 * Run: npx tsx tests/reimport_roundtrip/run.ts
 * Requires: a running DB (docker compose up -d) + a seeded user (npm run db:seed).
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

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { computeEnrichmentDelta } from '../../src/lib/server/enrichment.js';
import { parseCSV, getProfile } from '../../src/lib/server/parsers/index.js';
import type { NormalizedTransaction } from '../../src/lib/server/parsers/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = join(__dirname, '..', 'data', 'revolut_eur_20260810.csv');
// Same-minute fixture: three beers in the same minute, same amount, same description,
// distinguished only by their seconds (HH:mm:ss — the precision the normalizer now keeps;
// see parseDateField in parsers/normalizer.ts).
const beersFixture = join(__dirname, '..', 'data', 'revolut_same_minute.csv');

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

// UTC calendar day for the `::date` day-only fallback (matches normalizer storage).
function toDateStr(d: Date): string {
	return d.toISOString().split('T')[0];
}

// Same status rules as src/lib/server/dedup.ts statusTransition().
function statusTransition(
	existing: 'pending' | 'posted' | 'review' | 'reverted',
	incoming: NormalizedTransaction['status']
): boolean {
	if (existing === incoming) return false;
	if (existing === 'pending' && (incoming === 'posted' || incoming === 'reverted')) return true;
	if (existing === 'posted' && incoming === 'reverted') return true;
	return false;
}

const profile = getProfile('revolut_eu');
if (!profile) throw new Error('revolut_eu profile not found');

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
	costGroup: true,
	notes: true,
	city: true
} as const;

type Action = 'insert' | 'skip' | 'update_status' | 'update_desc' | 'update_enrichment' | 'review';

// Replicates classifyRow tier-2 (amount+description, exact-instant then day-only) and
// tier-3 (amount only, same fallbacks) against the DB — no externalId/internalId here.
async function classify(accountId: string, row: NormalizedTransaction): Promise<Action> {
	const rowDate = toDateStr(row.accountingDate);

	const sameExact =
		(await db.query.transactions.findFirst({
			where: (t, { and: a, eq: e, sql: s }) =>
				a(
					e(t.bankAccountId, accountId),
					e(t.accountingDate, row.accountingDate),
					s`${t.amount}::numeric = ${row.amount}`,
					s`md5(${t.description}) = md5(${row.description})`
				),
			columns: EXISTING_COLUMNS
		})) ??
		(await db.query.transactions.findFirst({
			where: (t, { and: a, eq: e, sql: s }) =>
				a(
					e(t.bankAccountId, accountId),
					s`${t.accountingDate}::date = ${rowDate}::date`,
					s`${t.amount}::numeric = ${row.amount}`,
					s`md5(${t.description}) = md5(${row.description})`
				),
			columns: EXISTING_COLUMNS
		}));
	if (sameExact) {
		if (statusTransition(sameExact.status, row.status)) return 'update_status';
		if (computeEnrichmentDelta(sameExact, row)) return 'update_enrichment';
		return 'skip';
	}

	let sameAmountDate = await db.query.transactions.findMany({
		where: (t, { and: a, eq: e, sql: s }) =>
			a(
				e(t.bankAccountId, accountId),
				e(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`
			),
		columns: EXISTING_COLUMNS
	});
	if (sameAmountDate.length === 0) {
		sameAmountDate = await db.query.transactions.findMany({
			where: (t, { and: a, eq: e, sql: s }) =>
				a(
					e(t.bankAccountId, accountId),
					s`${t.accountingDate}::date = ${rowDate}::date`,
					s`${t.amount}::numeric = ${row.amount}`
				),
			columns: EXISTING_COLUMNS
		});
	}
	if (sameAmountDate.length === 1) {
		return statusTransition(sameAmountDate[0].status, row.status) ? 'update_status' : 'update_desc';
	}
	if (sameAmountDate.length > 1) return 'review';
	return 'insert';
}

// Persist parsed rows as baseline transactions (the shape buildTxInsert produces).
async function insertBaseline(accountId: string, rows: NormalizedTransaction[]) {
	await db.insert(transactions).values(
		rows.map((r) => ({
			bankAccountId: accountId,
			accountingDate: r.accountingDate,
			valueDate: r.valueDate,
			amount: r.amount.toFixed(4),
			fee: r.fee.toFixed(4),
			currency: r.currency,
			amountOriginal: r.amountOriginal.toFixed(4),
			currencyOriginal: r.currencyOriginal,
			description: r.description,
			isTransfer: r.isTransferCandidate,
			isFxCandidate: r.isFxCandidate,
			category: r.category ?? null,
			city: r.city ?? null,
			notes: r.notes ?? null,
			originalOrder: r.sourceIndex,
			status: r.status,
			payerUserId: user!.id,
			syncSource: 'csv_upload' as const
		}))
	);
}

// Id of the stored row an incoming row matches on the exact instant (date+time+amount+desc).
async function twinIdExact(accountId: string, row: NormalizedTransaction): Promise<string | undefined> {
	const m = await db.query.transactions.findFirst({
		where: (t, { and: a, eq: e, sql: s }) =>
			a(
				e(t.bankAccountId, accountId),
				e(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`,
				s`md5(${t.description}) = md5(${row.description})`
			),
		columns: { id: true }
	});
	return m?.id;
}

// Same match but with the time discarded (day + amount + desc) — models what dedup would
// collapse to if the export carried no time-of-day. Used to contrast why time precision matters.
async function twinIdDayOnly(accountId: string, row: NormalizedTransaction): Promise<string | undefined> {
	const rowDate = toDateStr(row.accountingDate);
	const m = await db.query.transactions.findFirst({
		where: (t, { and: a, eq: e, sql: s }) =>
			a(
				e(t.bankAccountId, accountId),
				s`${t.accountingDate}::date = ${rowDate}::date`,
				s`${t.amount}::numeric = ${row.amount}`,
				s`md5(${t.description}) = md5(${row.description})`
			),
		columns: { id: true }
	});
	return m?.id;
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
		displayName: '__ROUNDTRIP_TEST__',
		institutionName: 'Test',
		bankProfileId: 'revolut_eu',
		ibanLast4: '0000',
		currency: 'EUR'
	})
	.returning({ id: bankAccounts.id });

const [beerAccount] = await db
	.insert(bankAccounts)
	.values({
		ownerUserId: user.id,
		workspaceId: user.workspaceId,
		displayName: '__ROUNDTRIP_BEERS__',
		institutionName: 'Test',
		bankProfileId: 'revolut_eu',
		ibanLast4: '0001',
		currency: 'EUR'
	})
	.returning({ id: bankAccounts.id });

console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' Cross-date-format round-trip — re-import must be a clean no-op');
console.log('══════════════════════════════════════════════════════════════════\n');

try {
	// ── First import: parse the fixture verbatim and insert every row ──────────
	console.log('1. Cross-date-format re-import (dd/MM/yyyy → yyyy-MM-dd) on real data');
	const raw = readFileSync(fixture, 'utf-8');
	const first = parseCSV(raw, profile);
	assert('fixture parsed some rows', first.rows.length > 0, `${first.rows.length} rows`);

	await insertBaseline(account.id, first.rows);

	// ── Re-download in a different date format: dd/MM/yyyy HH:mm → yyyy-MM-dd HH:mm ──
	// Same instants, different textual representation — the reported scenario.
	const reformatted = raw.replace(
		/(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/g,
		(_m, d, mo, y, t) => `${y}-${mo}-${d} ${t}`
	);
	assert('reformat actually changed the dates', reformatted !== raw);

	const second = parseCSV(reformatted, profile);
	assert(
		'reformatted file parses to the same row count',
		second.rows.length === first.rows.length,
		`${second.rows.length} vs ${first.rows.length}`
	);
	assert('reformatted file has no skipped rows', second.skippedCount === 0, `${second.skippedCount} skipped`);

	// ── Classify every re-imported row against the DB ─────────────────────────
	const counts: Record<Action, number> = {
		insert: 0,
		skip: 0,
		update_status: 0,
		update_desc: 0,
		update_enrichment: 0,
		review: 0
	};
	for (const row of second.rows) {
		counts[await classify(account.id, row)]++;
	}

	console.log(
		`\n  actions → insert:${counts.insert} skip:${counts.skip} ` +
			`update_status:${counts.update_status} update_desc:${counts.update_desc} ` +
			`update_enrichment:${counts.update_enrichment} review:${counts.review}\n`
	);

	assert('no rows inserted', counts.insert === 0, `${counts.insert} inserted`);
	assert('no phantom status updates', counts.update_status === 0, `${counts.update_status}`);
	assert('no phantom description updates', counts.update_desc === 0, `${counts.update_desc}`);
	assert('no rows flagged for review', counts.review === 0, `${counts.review}`);
	assert(
		'every row deduped as a true duplicate',
		counts.skip === second.rows.length,
		`${counts.skip}/${second.rows.length} skipped`
	);

	// ── Part 2: same-MINUTE distinct transactions rely on second precision ──────
	// Three beers in the same minute, same amount, same description — only the seconds
	// (HH:mm:ss) tell them apart. Second precision keeps them as three distinct rows;
	// with only minute precision they'd collapse and a genuinely-new beer would be
	// skipped as a "duplicate".
	console.log('\n2. Same-minute distinct times (three beers, dd/MM/yyyy HH:mm:ss)');
	const beersRaw = readFileSync(beersFixture, 'utf-8');
	const beers = parseCSV(beersRaw, profile);
	const beerRows = beers.rows.filter((r) => r.description === 'Bar Manolo');
	assert('fixture parses the 3 beers', beerRows.length === 3, `${beerRows.length}`);
	assert(
		'beers share day + amount + description',
		beerRows.every(
			(r) =>
				r.amount === beerRows[0].amount &&
				r.description === beerRows[0].description &&
				toDateStr(r.accountingDate) === toDateStr(beerRows[0].accountingDate)
		)
	);
	// The scenario minute-only precision could not represent: identical down to the minute.
	const minuteKey = (d: Date) => `${d.getUTCHours()}:${d.getUTCMinutes()}`;
	assert(
		'beers fall in the SAME minute',
		new Set(beerRows.map((r) => minuteKey(r.accountingDate))).size === 1
	);
	assert(
		'beers differ by seconds (preserved by the normalizer)',
		new Set(beerRows.map((r) => r.accountingDate.getTime())).size === 3
	);

	// First import: classified against an empty account, every row is new (matches
	// production, where the batch is inserted only after all rows are classified).
	let firstImportInserts = 0;
	for (const r of beers.rows) if ((await classify(beerAccount.id, r)) === 'insert') firstImportInserts++;
	assert('first import inserts every row', firstImportInserts === beers.rows.length);
	await insertBaseline(beerAccount.id, beers.rows);
	const stored = await db.query.transactions.findMany({
		where: eq(transactions.bankAccountId, beerAccount.id),
		columns: { id: true }
	});
	assert('all rows stored distinctly', stored.length === beers.rows.length, `${stored.length}`);

	// Re-import verbatim → each row dedupes to its OWN twin via the exact instant; 0 inserts.
	const beerCounts: Record<Action, number> = {
		insert: 0,
		skip: 0,
		update_status: 0,
		update_desc: 0,
		update_enrichment: 0,
		review: 0
	};
	for (const r of beers.rows) beerCounts[await classify(beerAccount.id, r)]++;
	assert('re-import inserts nothing', beerCounts.insert === 0, `${beerCounts.insert}`);
	assert('re-import: every row a duplicate', beerCounts.skip === beers.rows.length, `${beerCounts.skip}`);

	const exactTwins = new Set<string>();
	for (const r of beerRows) {
		const id = await twinIdExact(beerAccount.id, r);
		if (id) exactTwins.add(id);
	}
	assert(
		'second precision → 3 same-minute beers map to 3 DISTINCT twins',
		exactTwins.size === 3,
		`${exactTwins.size} unique`
	);

	// Without any time-of-day the same three rows would collapse to a single twin —
	// the naive-duplicate risk that second precision avoids.
	const dayTwins = new Set<string>();
	for (const r of beerRows) {
		const id = await twinIdDayOnly(beerAccount.id, r);
		if (id) dayTwins.add(id);
	}
	assert(
		'time-less matching would collapse them to 1 (why time precision matters)',
		dayTwins.size === 1,
		`${dayTwins.size} unique`
	);

	// ── Safety: a re-export whose seconds shifted must NOT spawn a duplicate ─────
	// Bump one beer by a few seconds (as a jittered re-download might) and confirm it
	// still dedupes to an existing row via the same-calendar-day fallback — never inserts.
	const jittered = {
		...beerRows[0],
		accountingDate: new Date(beerRows[0].accountingDate.getTime() + 4000)
	};
	assert(
		'jittered copy is a genuinely different instant',
		jittered.accountingDate.getTime() !== beerRows[0].accountingDate.getTime()
	);
	const jitterAction = await classify(beerAccount.id, jittered);
	assert(
		'a seconds-shifted re-export dedupes (no duplicate) via the same-day fallback',
		jitterAction === 'skip',
		jitterAction
	);
} finally {
	for (const id of [account.id, beerAccount.id]) {
		await db.delete(transactions).where(eq(transactions.bankAccountId, id));
		await db.delete(bankAccounts).where(eq(bankAccounts.id, id));
	}
	console.log('\nCleaned up test data.');
	await client.end();
}

console.log(`\n Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
