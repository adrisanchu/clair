#!/usr/bin/env tsx
/**
 * Maintenance: rebuild currency-conversion links for a workspace using the CURRENT
 * (fixed) detectors — the confident-match rules that require both legs to be flagged FX
 * and reject implausible rates. Wipes the workspace's conversion links/tags and re-runs
 * detectFxPairs + rescanWorkspaceConversions (the same order the import pipeline uses).
 *
 * SAFE to run against prod (Neon).
 * The confident matcher will recreate the good pairs (SEK, etc.) identically and simply
 * NOT recreate the nonsense ones. It does NOT delete any transactions.
 *
 * It preserves `fx_detection_excluded` (user opt-outs) — those anchors stay unlinked.
 *
 * Usage — the TSX_TSCONFIG_PATH shim is ALWAYS required (it aliases SvelteKit's
 * `$env/dynamic/private`, imported transitively via src/lib/server/db/index.ts, to
 * process.env so the db-coupled detector loads under tsx). It is DB-agnostic; the target
 * is whatever DATABASE_URL you pass — local test DB or prod Neon.
 *
 *   # 1. List workspaces (no changes) to find the id you want:
 *   TSX_TSCONFIG_PATH=tests/_shims/tsconfig.tsx.json \
 *     DATABASE_URL="<url>" npx tsx scripts/redetect-conversions.ts
 *
 *   # 2. Rebuild ONE workspace:
 *   TSX_TSCONFIG_PATH=tests/_shims/tsconfig.tsx.json \
 *     DATABASE_URL="<url>" npx tsx scripts/redetect-conversions.ts <workspaceId>
 *
 *   # 2b. Rebuild EVERY workspace that has conversions (old behaviour):
 *   TSX_TSCONFIG_PATH=tests/_shims/tsconfig.tsx.json \
 *     DATABASE_URL="<url>" npx tsx scripts/redetect-conversions.ts --all
 */
try {
	(process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env');
} catch {
	/* env may already be set */
}

import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db/index.js';
import {
	bankAccounts,
	currencyConversions,
	transactions,
	workspaces
} from '../src/lib/server/db/schema.js';
import {
	detectFxPairs,
	rescanWorkspaceConversions
} from '../src/lib/server/currency-converter.js';
import { PRIMARY_CURRENCY } from '../src/lib/currencies.js';

const args = process.argv.slice(2).filter((a: string) => a !== '');
const runAll = args.includes('--all');
const target = args.find((a: string) => !a.startsWith('--')) ?? process.env.WORKSPACE_ID ?? null;

/** No target and not --all → list workspaces with their conversion/foreign-account counts. */
async function listWorkspaces(): Promise<void> {
	const [rows, convCounts, foreignCounts] = await Promise.all([
		db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).orderBy(workspaces.name),
		db
			.select({
				ws: currencyConversions.workspaceId,
				n: sql<number>`COUNT(*)::int`
			})
			.from(currencyConversions)
			.groupBy(currencyConversions.workspaceId),
		db
			.select({
				ws: bankAccounts.workspaceId,
				n: sql<number>`COUNT(*)::int`
			})
			.from(bankAccounts)
			.where(sql`${bankAccounts.currency} <> ${PRIMARY_CURRENCY}`)
			.groupBy(bankAccounts.workspaceId)
	]);
	const convByWs = new Map(convCounts.map((r) => [r.ws, r.n]));
	const foreignByWs = new Map(foreignCounts.map((r) => [r.ws, r.n]));

	console.log(`\nWorkspaces (${rows.length}):\n`);
	for (const r of rows) {
		console.log(
			`  ${r.id}  ${r.name}  — conversions=${convByWs.get(r.id) ?? 0}, foreign accounts=${foreignByWs.get(r.id) ?? 0}`
		);
	}
	console.log('\nRe-run with a workspace id to rebuild it, e.g.:');
	console.log('  DATABASE_URL="<url>" npx tsx scripts/redetect-conversions.ts ' + (rows[0]?.id ?? '<workspaceId>'));
	console.log('Or --all to rebuild every workspace that has conversions.\n');
}

/** Reset + re-detect a single workspace. Returns the leg-dupe count for verification. */
async function rebuild(ws: string): Promise<void> {
	const [meta] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ws));
	console.log(`\nRebuilding workspace ${ws}${meta ? ` (${meta.name})` : ''}…`);

	await db.delete(currencyConversions).where(eq(currencyConversions.workspaceId, ws));

	const accts = await db
		.select({ id: bankAccounts.id, currency: bankAccounts.currency })
		.from(bankAccounts)
		.where(eq(bankAccounts.workspaceId, ws));
	const allIds = accts.map((a) => a.id);
	const foreignIds = accts.filter((a) => a.currency !== PRIMARY_CURRENCY).map((a) => a.id);

	// Clear the leg link on every account (legs live on both EUR and foreign sides)…
	if (allIds.length) {
		await db
			.update(transactions)
			.set({ conversionCounterpartId: null })
			.where(inArray(transactions.bankAccountId, allIds));
	}
	// …and the rate tags on the foreign accounts.
	if (foreignIds.length) {
		await db
			.update(transactions)
			.set({ conversionId: null, exchangeRate: null, amountEur: null })
			.where(inArray(transactions.bankAccountId, foreignIds));
	}

	const pairs = await detectFxPairs(ws);
	const rescan = await rescanWorkspaceConversions(ws);
	console.log(`  exact-pairs=${pairs.length} rescan=${rescan.length}`);
}

if (!runAll && !target) {
	await listWorkspaces();
	process.exit(0);
}

const wsIds: string[] = runAll
	? (await db.selectDistinct({ ws: currencyConversions.workspaceId }).from(currencyConversions)).map(
			(r) => r.ws
		)
	: [target as string];

if (!runAll) {
	const [exists] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, target as string));
	if (!exists) {
		console.error(`Workspace ${target} not found. Run with no args to list workspaces.`);
		process.exit(1);
	}
}

console.log(`Rebuilding ${wsIds.length} workspace(s)…`);
for (const ws of wsIds) {
	await rebuild(ws);
}

// Verify: no transaction is a leg of more than one conversion.
const dupes = await db.execute(sql`
	SELECT leg_id, COUNT(*) AS n FROM (
		SELECT from_transaction_id AS leg_id FROM core.currency_conversions WHERE from_transaction_id IS NOT NULL
		UNION ALL
		SELECT to_transaction_id AS leg_id FROM core.currency_conversions WHERE to_transaction_id IS NOT NULL
	) legs
	GROUP BY leg_id HAVING COUNT(*) > 1
`);
console.log(`\nLegs used in >1 conversion: ${dupes.length} (expect 0)`);
if (dupes.length > 0) console.log(dupes);

process.exit(dupes.length > 0 ? 1 : 0);
