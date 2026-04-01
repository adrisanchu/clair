#!/usr/bin/env tsx
/**
 * Integration test: dedup against real Postgres.
 *
 * Creates a throw-away bank account, inserts all revolut_1.csv rows,
 * then runs the exact same Drizzle queries used by classifyRow() for
 * each revolut_2.csv row. Cleans up on exit.
 *
 * Run: npx tsx tests/dedup_detector/db-test.ts
 * Requires: docker compose up -d && npm run db:migrate && npm run db:seed
 */

// ── Load .env (same trick as seed-owner.ts) ───────────────────────────────
try {
	;(process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env')
} catch {
	/* env may already be set */
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
	console.error('DATABASE_URL not set — run from project root with .env present')
	process.exit(1)
}

// ── Imports ───────────────────────────────────────────────────────────────
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { eq, and, inArray } from 'drizzle-orm'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')

const { parseCSV, getProfile } = await import('../../src/lib/server/parsers/index.js')

const profile = getProfile('revolut_eu')
if (!profile) throw new Error('revolut_eu profile not found')

const r1 = parseCSV(readFileSync(join(dataDir, 'revolut_1.csv'), 'utf-8'), profile)
const r2 = parseCSV(readFileSync(join(dataDir, 'revolut_2.csv'), 'utf-8'), profile)

// ── DB connection (own client, no $lib alias needed) ──────────────────────
const client = postgres(DATABASE_URL)
const schema = await import('../../src/lib/server/db/schema.js')
const { transactions, bankAccounts, authUser } = schema
const db = drizzle(client, { schema })

// ── Require a seeded user ─────────────────────────────────────────────────
const user = await db.query.authUser.findFirst({
	columns: { id: true, workspaceId: true }
})
if (!user?.workspaceId) {
	console.error('No seeded user found — run: npm run db:seed first')
	await client.end()
	process.exit(1)
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
	.returning({ id: bankAccounts.id })

console.log(`\nTest account: ${testAccount.id}`)

// ── Insert revolut_1 rows (simulates first upload) ───────────────────────
const insertedIds: string[] = []
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
		.returning({ id: transactions.id })
	insertedIds.push(ins.id)
}
console.log(`Inserted ${insertedIds.length} rows from revolut_1 (${r1.rows.filter((r) => r.status === 'pending').length} pending)\n`)

// ── Run the exact DB queries from classifyRow() ───────────────────────────
console.log('══════════════════════════════════════════════════════════════════')
console.log(' DB DEDUP TEST — revolut_2 rows vs revolut_1 in Postgres')
console.log('══════════════════════════════════════════════════════════════════')
console.log(' priority  action           date          amount    description')
console.log('──────────────────────────────────────────────────────────────────')

const counts = { insert: 0, skip: 0, update_status: 0, update_desc: 0, review: 0 }

for (const row of r2.rows) {
	const dateStr = row.accountingDate.toISOString().split('T')[0]
	const amtStr = String(row.amount.toFixed(2)).padStart(9)

	// ── Priority 2: accountingDate + amount + description ────────────────
	const sameExact = await db.query.transactions.findFirst({
		where: (t, { and: a, eq: e, sql: s }) =>
			a(
				e(t.bankAccountId, testAccount.id),
				e(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`,
				s`md5(${t.description}) = md5(${row.description})`
			),
		columns: { id: true, status: true }
	})

	if (sameExact) {
		const action =
			sameExact.status === 'pending' && row.status === 'posted' ? 'update_status' : 'skip'
		counts[action]++
		console.log(` P2        ${action.padEnd(16)}  ${dateStr}  ${amtStr}  ${row.description}`)
		continue
	}

	// ── Priority 3: accountingDate + amount only ─────────────────────────
	const sameAmountDate = await db.query.transactions.findMany({
		where: (t, { and: a, eq: e, sql: s }) =>
			a(
				e(t.bankAccountId, testAccount.id),
				e(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`
			),
		columns: { id: true, status: true }
	})

	if (sameAmountDate.length === 1) {
		const action =
			sameAmountDate[0].status === 'pending' && row.status === 'posted'
				? 'update_status'
				: 'update_desc'
		counts[action]++
		console.log(` P3        ${action.padEnd(16)}  ${dateStr}  ${amtStr}  ${row.description}`)
		continue
	}
	if (sameAmountDate.length > 1) {
		counts.review++
		console.log(
			` P3        review             ${dateStr}  ${amtStr}  ${row.description}  (${sameAmountDate.length} matches)`
		)
		continue
	}

	counts.insert++
	console.log(` ——        insert             ${dateStr}  ${amtStr}  ${row.description}`)
}

console.log('──────────────────────────────────────────────────────────────────')
console.log(
	` insert: ${counts.insert}  skip: ${counts.skip}  update_status: ${counts.update_status}  update_desc: ${counts.update_desc}  review: ${counts.review}`
)
console.log()
console.log(' Expected: insert=12  skip=10  update_status=4  update_desc=0  review=0')

const ok =
	counts.insert === 12 &&
	counts.skip === 10 &&
	counts.update_status === 4 &&
	counts.update_desc === 0 &&
	counts.review === 0
console.log(ok ? '\n ✓ PASS' : '\n ✗ FAIL — see rows marked incorrectly above')

// ── Cleanup ───────────────────────────────────────────────────────────────
if (insertedIds.length > 0) {
	await db.delete(transactions).where(inArray(transactions.id, insertedIds))
}
await db.delete(bankAccounts).where(eq(bankAccounts.id, testAccount.id))
console.log('\nCleaned up test data.')

await client.end()
