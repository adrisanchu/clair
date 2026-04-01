#!/usr/bin/env tsx
/**
 * Dedup simulation test.
 * Parses revolut_1.csv (first upload) and revolut_2.csv (second upload),
 * then simulates the classifyRow logic in memory to show exactly what
 * action would be taken for each row in the second file.
 *
 * Run: npx tsx tests/dedup_detector/run.ts
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')

// ── Import parser using relative paths (no $lib alias) ────────────────────
const { parseCSV } = await import('../../src/lib/server/parsers/index.js')
const { getProfile } = await import('../../src/lib/server/parsers/index.js')

const profile = getProfile('revolut_eu')
if (!profile) throw new Error('revolut_eu profile not found')

const csv1 = readFileSync(join(dataDir, 'revolut_1.csv'), 'utf-8')
const csv2 = readFileSync(join(dataDir, 'revolut_2.csv'), 'utf-8')

const r1 = parseCSV(csv1, profile)
const r2 = parseCSV(csv2, profile)

const PAD_DESC = 44

// ── Print parsed rows ─────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════')
console.log(' REVOLUT_1.CSV — parsed rows')
console.log('══════════════════════════════════════════════════════════════')
for (const r of r1.rows) {
	console.log(
		`  ${r.accountingDate.toISOString().split('T')[0]}` +
			`  ${String(r.amount.toFixed(2)).padStart(9)}` +
			`  [${r.status}]` +
			`  ${r.description}`
	)
}
console.log(`  (${r1.skippedCount} rows skipped, ${r1.errors.length} errors)`)

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' REVOLUT_2.CSV — parsed rows')
console.log('══════════════════════════════════════════════════════════════')
for (const r of r2.rows) {
	console.log(
		`  ${r.accountingDate.toISOString().split('T')[0]}` +
			`  ${String(r.amount.toFixed(2)).padStart(9)}` +
			`  [${r.status}]` +
			`  ${r.description}`
	)
}
console.log(`  (${r2.skippedCount} rows skipped, ${r2.errors.length} errors)`)

// ── Dedup simulation ──────────────────────────────────────────────────────
// Mirrors classifyRow priorities (no externalId for Revolut):
//   P2: accountingDate + amount + description (exact)
//   P3: accountingDate + amount only
//
// Amount comparison uses toFixed(4) string equality to avoid IEEE-754 drift
// (this is what would happen when Postgres casts numeric vs float parameter).

function amountEq(a: number, b: number) {
	return a.toFixed(4) === b.toFixed(4)
}

console.log('\n══════════════════════════════════════════════════════════════')
console.log(' DEDUP SIMULATION — revolut_2 rows against revolut_1')
console.log('══════════════════════════════════════════════════════════════')
console.log(' action           date         amount     description')
console.log('──────────────────────────────────────────────────────────────')

const counts = { insert: 0, skip: 0, update_status: 0, update_desc: 0, review: 0 }

for (const row of r2.rows) {
	const dateStr = row.accountingDate.toISOString().split('T')[0]
	const amtStr = String(row.amount.toFixed(2)).padStart(9)

	// Priority 2: exact match
	const exact = r1.rows.find(
		(r) =>
			r.accountingDate.getTime() === row.accountingDate.getTime() &&
			amountEq(r.amount, row.amount) &&
			r.description === row.description
	)
	if (exact) {
		const action =
			exact.status === 'pending' && row.status === 'posted' ? 'update_status' : 'skip'
		counts[action]++
		console.log(` ${action.padEnd(16)}  ${dateStr}  ${amtStr}  ${row.description}`)
		continue
	}

	// Priority 3: date + amount only
	const fuzzy = r1.rows.filter(
		(r) =>
			r.accountingDate.getTime() === row.accountingDate.getTime() && amountEq(r.amount, row.amount)
	)
	if (fuzzy.length === 1) {
		const action =
			fuzzy[0].status === 'pending' && row.status === 'posted' ? 'update_status' : 'update_desc'
		counts[action]++
		console.log(
			` ${action.padEnd(16)}  ${dateStr}  ${amtStr}  ${row.description}` +
				(action === 'update_desc' ? `  ← was: "${fuzzy[0].description}"` : '')
		)
		continue
	}
	if (fuzzy.length > 1) {
		counts.review++
		console.log(` review            ${dateStr}  ${amtStr}  ${row.description}  (${fuzzy.length} conflicts)`)
		continue
	}

	counts.insert++
	console.log(` insert            ${dateStr}  ${amtStr}  ${row.description}`)
}

console.log('──────────────────────────────────────────────────────────────')
console.log(` insert: ${counts.insert}  skip: ${counts.skip}  update_status: ${counts.update_status}  update_desc: ${counts.update_desc}  review: ${counts.review}`)
console.log()
