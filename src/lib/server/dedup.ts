import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { transactions } from './db/schema.js';
import type { NormalizedTransaction, DedupResult, EnrichmentDelta } from './parsers/types.js';
import { computeEnrichmentDelta, type EnrichableExisting } from './enrichment.js';

/**
 * The subset of an existing transaction the dedup engine needs to decide an action
 * and compute an enrichment delta.
 */
interface ExistingRow extends EnrichableExisting {
	id: string;
	status: 'pending' | 'posted' | 'review' | 'reverted';
}

/**
 * Decide whether an incoming row's status finalises an existing one.
 * Returns the new status to apply, or null when there is nothing to change.
 *
 *  - pending → posted / reverted: a provisional row settled (or was returned).
 *  - posted  → reverted:          a settled charge was later returned/cancelled.
 *
 * We never downgrade (posted → pending), never un-revert, and leave `review` rows to
 * manual resolution.
 */
function statusTransition(
	existing: ExistingRow['status'],
	incoming: NormalizedTransaction['status']
): NormalizedTransaction['status'] | null {
	if (existing === incoming) return null;
	if (existing === 'pending' && (incoming === 'posted' || incoming === 'reverted')) return incoming;
	if (existing === 'posted' && incoming === 'reverted') return 'reverted';
	return null;
}

const EXISTING_COLUMNS = {
	id: true,
	status: true,
	category: true,
	categoryAI: true,
	categoryOverride: true,
	notes: true,
	city: true
} as const;

/**
 * ISO calendar date (`yyyy-MM-dd`) for a `::date` SQL comparison.
 *
 * A raw `Date` interpolated into a `sql` template is serialised by the pg driver via
 * `.toString()` (e.g. `Thu Jul 31 2025 …`), which PostgreSQL cannot cast to `::date`.
 * Passing the date as a `yyyy-MM-dd` string sidesteps that. Uses UTC parts to match how
 * `accountingDate` is stored (see parsers/normalizer.ts).
 */
function toDateStr(d: Date): string {
	return d.toISOString().split('T')[0];
}

/**
 * Classify a normalised row before writing to the DB.
 *
 * Priority order:
 *  0. internalId match — an id echoed back by a Clair export+re-import (`transactions.id`).
 *     Exact and authoritative; makes edit attribution precise even for identical bank rows.
 *  1. externalId match (when the bank profile provides one)
 *  2. amount + description at the same instant, then (if none) on the same calendar day
 *  3. amount only (description may have changed) at the same instant, then same calendar day
 *
 * accountingDate now carries the source CSV's hour/minute when it had one (else 00:00).
 * Priorities 2 and 3 therefore match on the full timestamp first — this keeps two same-day
 * purchases with an identical amount/description but different times apart, and lets a
 * re-import of the exact same file pin each row to its own twin. When no same-instant row
 * matches, they retry at day granularity (`::date`) so a re-import whose time was dropped
 * (a date-only export) or shifted between statements (e.g. pending→posted) still dedupes.
 * A date-only re-import of genuinely distinct same-day rows is inherently ambiguous — the
 * day-only retry may merge them, which is the caller's responsibility to accept.
 *
 * On any match, an enrichment delta is computed from the row's (re-imported) Category /
 * Notes / City cells vs the stored values. When the effective category, notes, or city
 * changed, the delta is attached so the import loop can apply the user's edits:
 *  - PENDING → POSTED transitions stay `update_status` (+ enrichment payload).
 *  - An exact match with only enrichment changes becomes `update_enrichment`.
 *  - A same-date+amount match with a changed description stays `update_desc` (+ enrichment).
 *  - A match with no status change and no enrichment delta stays `skip` (a true duplicate).
 */
export async function classifyRow(
	row: NormalizedTransaction,
	bankAccountId: string,
	externalId?: string
): Promise<DedupResult> {
	// Day-only comparisons interpolate this string (not the raw Date) — see toDateStr.
	const rowDate = toDateStr(row.accountingDate);

	// Priority 0: internal id echoed back from a Clair export
	if (row.internalId) {
		const existing = await db.query.transactions.findFirst({
			where: (t, { and, eq }) => and(eq(t.bankAccountId, bankAccountId), eq(t.id, row.internalId!)),
			columns: EXISTING_COLUMNS
		});
		// Only trust the id when it resolves within this account; otherwise fall through.
		if (existing) return resolveExactMatch(existing, row);
	}

	// Priority 1: externalId match
	if (externalId) {
		const existing = await db.query.transactions.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.bankAccountId, bankAccountId), eq(t.externalId, externalId)),
			columns: EXISTING_COLUMNS
		});
		if (existing) return resolveExactMatch(existing, row);
	}

	// Priority 2: amount + description at the same instant, then the same calendar day.
	// The exact-timestamp match keeps distinct same-day purchases apart; the day-only
	// fallback still catches a re-import whose time was dropped or shifted.
	const sameExact =
		(await db.query.transactions.findFirst({
			where: (t, { and, eq, sql: s }) =>
				and(
					eq(t.bankAccountId, bankAccountId),
					eq(t.accountingDate, row.accountingDate),
					s`${t.amount}::numeric = ${row.amount}`,
					s`md5(${t.description}) = md5(${row.description})`
				),
			columns: EXISTING_COLUMNS
		})) ??
		(await db.query.transactions.findFirst({
			where: (t, { and, eq, sql: s }) =>
				and(
					eq(t.bankAccountId, bankAccountId),
					s`${t.accountingDate}::date = ${rowDate}::date`,
					s`${t.amount}::numeric = ${row.amount}`,
					s`md5(${t.description}) = md5(${row.description})`
				),
			columns: EXISTING_COLUMNS
		}));
	if (sameExact) return resolveExactMatch(sameExact, row);

	// Priority 3: amount only (description may have changed). Same instant first — so a
	// same-day pair is disambiguated by time when possible — then the same calendar day.
	let sameAmountDate = await db.query.transactions.findMany({
		where: (t, { and, eq, sql: s }) =>
			and(
				eq(t.bankAccountId, bankAccountId),
				eq(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`
			),
		columns: EXISTING_COLUMNS
	});
	if (sameAmountDate.length === 0) {
		sameAmountDate = await db.query.transactions.findMany({
			where: (t, { and, eq, sql: s }) =>
				and(
					eq(t.bankAccountId, bankAccountId),
					s`${t.accountingDate}::date = ${rowDate}::date`,
					s`${t.amount}::numeric = ${row.amount}`
				),
			columns: EXISTING_COLUMNS
		});
	}

	if (sameAmountDate.length === 1) {
		const existing = sameAmountDate[0];
		const enrichment = computeEnrichmentDelta(existing, row);
		if (statusTransition(existing.status, row.status))
			return { action: 'update_status', existingId: existing.id, enrichment };
		// Description changed (out of contract) — still apply enrichment on this branch.
		return { action: 'update_desc', existingId: existing.id, enrichment };
	}
	if (sameAmountDate.length > 1) return { action: 'review' };

	return { action: 'insert' };
}

/**
 * Decide the action for a row matched exactly (tier 0/1/2) to a single existing row.
 * Prefers a PENDING→POSTED status upgrade, then an enrichment update, else a plain skip.
 */
function resolveExactMatch(existing: ExistingRow, row: NormalizedTransaction): DedupResult {
	const enrichment = computeEnrichmentDelta(existing, row);
	if (statusTransition(existing.status, row.status))
		return { action: 'update_status', existingId: existing.id, enrichment };
	if (enrichment) return { action: 'update_enrichment', existingId: existing.id, enrichment };
	return { action: 'skip', existingId: existing.id };
}

/**
 * Dry-run classification summary used by the preview step so it can show the
 * same New / Duplicates / Updates / Review breakdown the import will produce —
 * without writing anything.
 *
 * The action → bucket mapping MUST stay in sync with the import loop in
 * routes/api/accounts/[id]/import/+server.ts:
 *   insert → new · review → review ·
 *   update_status|update_desc|update_enrichment → update · skip → duplicate
 */
export interface ClassificationSummary {
	newCount: number;
	duplicateCount: number;
	updateCount: number;
	reviewCount: number;
}

export async function summarizeClassification(
	rows: NormalizedTransaction[],
	bankAccountId: string
): Promise<ClassificationSummary> {
	const summary: ClassificationSummary = {
		newCount: 0,
		duplicateCount: 0,
		updateCount: 0,
		reviewCount: 0
	};

	for (const row of rows) {
		const { action } = await classifyRow(row, bankAccountId);
		if (action === 'insert') summary.newCount++;
		else if (action === 'review') summary.reviewCount++;
		else if (
			action === 'update_status' ||
			action === 'update_desc' ||
			action === 'update_enrichment'
		)
			summary.updateCount++;
		else summary.duplicateCount++; // 'skip'
	}

	return summary;
}

/**
 * Apply a status transition (pending → posted/reverted, or posted → reverted).
 * Refreshes the bank-owned fields that can change on settlement (status, amount, fee,
 * valueDate). Only touches system-owned fields — never category, notes, city, tags.
 */
export async function applyStatusUpdate(
	existingId: string,
	row: NormalizedTransaction
): Promise<void> {
	await db
		.update(transactions)
		.set({
			status: row.status,
			amount: row.amount.toFixed(4),
			fee: row.fee.toFixed(4),
			valueDate: row.valueDate,
			updatedAt: new Date()
			// Intentionally NOT updating: category, categoryOverride, notes, city, tags
		})
		.where(eq(transactions.id, existingId));
}

/**
 * Update the description of an existing transaction (same date+amount, desc changed).
 */
export async function applyDescUpdate(
	existingId: string,
	row: NormalizedTransaction
): Promise<void> {
	await db
		.update(transactions)
		.set({
			description: row.description,
			updatedAt: new Date()
		})
		.where(eq(transactions.id, existingId));
}

/**
 * Apply an enrichment delta (edited Category / Notes / City) onto an existing row.
 *
 * A changed category is written as `categoryOverride` (a human decision) — the raw
 * `category` and AI `categoryAI` columns are left untouched, so provenance and the
 * AI-skip guard stay intact and repeated round-trips are idempotent. `overrideById`
 * records who imported the edit.
 */
export async function applyEnrichmentUpdate(
	existingId: string,
	delta: EnrichmentDelta,
	overrideById: string
): Promise<void> {
	const set: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
	if (delta.categoryOverride !== undefined) {
		set.categoryOverride = delta.categoryOverride;
		set.categoryOverrideById = overrideById;
	}
	if (delta.notes !== undefined) set.notes = delta.notes;
	if (delta.city !== undefined) set.city = delta.city;

	await db.update(transactions).set(set).where(eq(transactions.id, existingId));
}
