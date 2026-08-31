#!/usr/bin/env tsx
/**
 * Integration test: dedup against real Postgres.
 *
 * Creates a throw-away bank account, inserts all revolut_1.csv rows,
 * then runs the REAL classifyRow() from src/lib/server/dedup.ts against each
 * revolut_2.csv row (not a hand-mirrored copy — so query bugs like a bad ::date
 * cast are actually exercised). Scenario 2 additionally asserts that a fee-folded
 * amount with binary-float drift still dedupes on re-import. Cleans up on exit.
 *
 * Run: npx tsx tests/dedup_detector/db-test.ts
 * Requires: docker compose up -d && npm run db:migrate && npm run db:seed
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

// ── Imports ───────────────────────────────────────────────────────────────
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');

const { parseCSV, getProfile } = await import('../../src/lib/server/parsers/index.js');
const { classifyRow } = await import('../../src/lib/server/dedup.js');

const profile = getProfile('revolut_eu');
if (!profile) throw new Error('revolut_eu profile not found');

const r1 = parseCSV(readFileSync(join(dataDir, 'revolut_1.csv'), 'utf-8'), profile);
const r2 = parseCSV(readFileSync(join(dataDir, 'revolut_2.csv'), 'utf-8'), profile);

// ── DB connection (own client, no $lib alias needed) ──────────────────────
const client = postgres(DATABASE_URL);
const schema = await import('../../src/lib/server/db/schema.js');
const { transactions, bankAccounts, authUser } = schema;
const db = drizzle(client, { schema });

// ── Require a seeded user ─────────────────────────────────────────────────
const user = await db.query.authUser.findFirst({
	columns: { id: true, workspaceId: true }
});
if (!user?.workspaceId) {
	console.error('No seeded user found — run: npm run db:seed first');
	await client.end();
	process.exit(1);
}

// ── Create a temporary test bank account ──────────────────────────────────
const [testAccount] = await db
	.insert(bankAccounts)
	.values({
		ownerUserId: user.id,
		workspaceId: user.workspaceId,
		displayName: '__DEDUP_TEST__',
		institutionName: 'Test',
		bankProfileId: 'revolut_eu',
		ibanLast4: '0000',
		currency: 'EUR'
	})
	.returning({ id: bankAccounts.id });

console.log(`\nTest account: ${testAccount.id}`);

// ── Insert revolut_1 rows (simulates first upload) ───────────────────────
const insertedIds: string[] = [];
for (const row of r1.rows) {
	const [ins] = await db
		.insert(transactions)
		.values({
			bankAccountId: testAccount.id,
			accountingDate: row.accountingDate,
			valueDate: row.valueDate,
			amount: row.amount.toFixed(4),
			currency: row.currency,
			amountOriginal: row.amountOriginal.toFixed(4),
			currencyOriginal: row.currencyOriginal,
			description: row.description,
			status: row.status, // preserve pending/posted
			payerUserId: user.id,
			syncSource: 'csv_upload'
		})
		.returning({ id: transactions.id });
	insertedIds.push(ins.id);
}
console.log(
	`Inserted ${insertedIds.length} rows from revolut_1 (${r1.rows.filter((r) => r.status === 'pending').length} pending)\n`
);

// ── Classify each revolut_2 row via the REAL classifyRow() ────────────────
console.log('══════════════════════════════════════════════════════════════════');
console.log(' DB DEDUP TEST — revolut_2 rows vs revolut_1 in Postgres (real classifyRow)');
console.log('══════════════════════════════════════════════════════════════════');
console.log(' action             date          amount    description');
console.log('──────────────────────────────────────────────────────────────────');

const counts = {
	insert: 0,
	skip: 0,
	update_status: 0,
	update_desc: 0,
	update_enrichment: 0,
	review: 0
};

for (const row of r2.rows) {
	const dateStr = row.accountingDate.toISOString().split('T')[0];
	const amtStr = String(row.amount.toFixed(2)).padStart(9);

	// Revolut has no externalId column, so the import flow passes none here too.
	const { action } = await classifyRow(row, testAccount.id);
	counts[action]++;
	console.log(` ${action.padEnd(16)}  ${dateStr}  ${amtStr}  ${row.description}`);
}

console.log('──────────────────────────────────────────────────────────────────');
console.log(
	` insert: ${counts.insert}  skip: ${counts.skip}  update_status: ${counts.update_status}  update_desc: ${counts.update_desc}  update_enrichment: ${counts.update_enrichment}  review: ${counts.review}`
);
console.log();
console.log(
	' Expected: insert=12  skip=10  update_status=4  update_desc=0  update_enrichment=0  review=0'
);

const ok =
	counts.insert === 12 &&
	counts.skip === 10 &&
	counts.update_status === 4 &&
	counts.update_desc === 0 &&
	counts.update_enrichment === 0 &&
	counts.review === 0;
console.log(ok ? '\n ✓ PASS' : '\n ✗ FAIL — see rows marked incorrectly above');

// ── Scenario 2: fee-folding float drift must still dedupe ──────────────────
// `gross − fee` accumulates binary-float error (-168.64 − 4.44 = -173.07999999999998).
// The amount is stored rounded (toFixed(4)), so a re-import of the same row must be
// recognised as a duplicate rather than flagged new. Regression for the bug where
// "Retiro de efectivo…" and "East West Brewing Sai" (the file's only drift-prone fee
// rows) were the only two transactions detected as new on the second upload.
console.log('\n══════════════════════════════════════════════════════════════════');
console.log(' FEE-DRIFT REGRESSION — a re-imported fee row must dedupe, not insert');
console.log('══════════════════════════════════════════════════════════════════');

const driftHeader =
	'Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo,Categoría,Info,Ciudad';
const driftData =
	'Cajero automático,Actual,2025-08-31 00:42:00,2025-09-01 06:05:00,Retiro de efectivo en 00000913,-168.64,4.44,EUR,COMPLETADO,173.26,,,';
const driftRow = parseCSV(`${driftHeader}\n${driftData}`, profile).rows[0];

// gross −168.64 − fee 4.44 = −173.08, rounded clean (no −173.079999… drift).
const amountClean = driftRow.amount === -173.08;
console.log(`  fee-folded amount: ${driftRow.amount}  (expect -173.08, drift-free)`);

// First upload: store exactly as the import does (toFixed(4)).
const [driftIns] = await db
	.insert(transactions)
	.values({
		bankAccountId: testAccount.id,
		accountingDate: driftRow.accountingDate,
		valueDate: driftRow.valueDate,
		amount: driftRow.amount.toFixed(4),
		currency: driftRow.currency,
		amountOriginal: driftRow.amountOriginal.toFixed(4),
		currencyOriginal: driftRow.currencyOriginal,
		description: driftRow.description,
		status: driftRow.status,
		payerUserId: user.id,
		syncSource: 'csv_upload'
	})
	.returning({ id: transactions.id });
insertedIds.push(driftIns.id);

// Re-upload: the same row must be recognised as a duplicate (skip), not inserted.
const { action: driftAction } = await classifyRow(driftRow, testAccount.id);
console.log(`  re-import action:  ${driftAction}  (expect skip)`);

const driftOk = amountClean && driftAction === 'skip';
console.log(driftOk ? '\n ✓ PASS' : '\n ✗ FAIL — fee-drift row was not deduped');

// ── Cleanup ───────────────────────────────────────────────────────────────
if (insertedIds.length > 0) {
	await db.delete(transactions).where(inArray(transactions.id, insertedIds));
}
await db.delete(bankAccounts).where(eq(bankAccounts.id, testAccount.id));
console.log('\nCleaned up test data.');

await client.end();
process.exit(ok && driftOk ? 0 : 1);
