import { eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { transactions } from './db/schema.js';
import type { NormalizedTransaction, DedupAction, DedupResult } from './parsers/types.js';

/**
 * Classify a normalised row before writing to the DB.
 *
 * Priority order:
 *  1. externalId match (when the bank profile provides one)
 *  2. accountingDate + amount + description exact match
 *  3. accountingDate + amount only (description may have changed)
 *
 * PENDING → POSTED transitions trigger "update_status" instead of "skip",
 * preserving all user-enriched fields (category, notes, city, tags).
 */
export async function classifyRow(
	row: NormalizedTransaction,
	bankAccountId: string,
	externalId?: string
): Promise<DedupResult> {
	// Priority 1: externalId match
	if (externalId) {
		const existing = await db.query.transactions.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.bankAccountId, bankAccountId), eq(t.externalId, externalId)),
			columns: { id: true, status: true }
		});
		if (existing) {
			if (existing.status === 'pending' && row.status === 'posted')
				return { action: 'update_status', existingId: existing.id };
			return { action: 'skip' };
		}
	}

	// Priority 2: accountingDate + amount + description (exact)
	const sameExact = await db.query.transactions.findFirst({
		where: (t, { and, eq, sql: s }) =>
			and(
				eq(t.bankAccountId, bankAccountId),
				eq(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`,
				s`md5(${t.description}) = md5(${row.description})`
			),
		columns: { id: true, status: true }
	});
	if (sameExact) {
		if (sameExact.status === 'pending' && row.status === 'posted')
			return { action: 'update_status', existingId: sameExact.id };
		return { action: 'skip' };
	}

	// Priority 3: accountingDate + amount only (description may have changed)
	const sameAmountDate = await db.query.transactions.findMany({
		where: (t, { and, eq, sql: s }) =>
			and(
				eq(t.bankAccountId, bankAccountId),
				eq(t.accountingDate, row.accountingDate),
				s`${t.amount}::numeric = ${row.amount}`
			),
		columns: { id: true, status: true }
	});

	if (sameAmountDate.length === 1) {
		if (sameAmountDate[0].status === 'pending' && row.status === 'posted')
			return { action: 'update_status', existingId: sameAmountDate[0].id };
		return { action: 'update_desc', existingId: sameAmountDate[0].id };
	}
	if (sameAmountDate.length > 1) return { action: 'review' };

	return { action: 'insert' };
}

/**
 * Apply a PENDING → POSTED status upgrade.
 * Only touches system-owned fields. Never overwrites category, notes, city, tags.
 */
export async function applyStatusUpdate(
	existingId: string,
	row: NormalizedTransaction
): Promise<void> {
	await db
		.update(transactions)
		.set({
			status: 'posted',
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
