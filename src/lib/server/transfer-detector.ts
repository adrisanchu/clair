import { and, ne, eq, isNull, gte, lte, sql, inArray } from 'drizzle-orm'
import { addDays, subDays } from 'date-fns'
import { db } from './db/index.js'
import { transactions } from './db/schema.js'

export interface TransferCandidate {
	id: string
	bookingDate: Date
	amount: number
	description: string
	bankAccountId: string
	daysDiff: number
}

export interface TransferMatch {
	sourceId: string
	candidateId: string | null // null = no auto-link found
	candidates: TransferCandidate[] // empty when auto-linked
}

/**
 * For each newly inserted transaction flagged as a transfer candidate,
 * attempt to find its counterpart in other accessible accounts.
 *
 * Matching criteria:
 *   - Different bank account
 *   - Opposite sign, same absolute amount
 *   - Booking date within ±3 days
 *   - Not already linked
 *
 * Auto-links when exactly 1 candidate found. Surfaces multiple candidates for
 * manual resolution via the UI.
 */
export async function detectAndLinkTransfers(
	newTransactionIds: string[],
	accessibleAccountIds: string[],
	linkedById: string
): Promise<TransferMatch[]> {
	if (newTransactionIds.length === 0 || accessibleAccountIds.length === 0) return []

	const sources = await db
		.select()
		.from(transactions)
		.where(
			and(
				inArray(transactions.id, newTransactionIds),
				eq(transactions.isTransfer, true),
				isNull(transactions.transferCounterpartId),
				eq(transactions.isOpeningBalance, false)
			)
		)

	const results: TransferMatch[] = []

	for (const source of sources) {
		const sourceDate = source.bookingDate as unknown as Date

		const candidates = await db
			.select({
				id: transactions.id,
				bookingDate: transactions.bookingDate,
				amount: transactions.amount,
				description: transactions.description,
				bankAccountId: transactions.bankAccountId,
				daysDiff: sql<number>`ABS(EXTRACT(DAY FROM (
					${transactions.bookingDate} - ${source.bookingDate}::date
				)))`
			})
			.from(transactions)
			.where(
				and(
					ne(transactions.bankAccountId, source.bankAccountId),
					inArray(transactions.bankAccountId, accessibleAccountIds),
					sql`ABS(${transactions.amount}::numeric) = ABS(${source.amount}::numeric)`,
					sql`SIGN(${transactions.amount}::numeric) != SIGN(${source.amount}::numeric)`,
					gte(transactions.bookingDate, subDays(sourceDate, 3)),
					lte(transactions.bookingDate, addDays(sourceDate, 3)),
					isNull(transactions.transferCounterpartId),
					eq(transactions.isOpeningBalance, false)
				)
			)
			.orderBy(
				sql`ABS(EXTRACT(DAY FROM (${transactions.bookingDate} - ${source.bookingDate}::date)))`
			)
			.limit(5)

		if (candidates.length === 1) {
			await linkPair(source.id, candidates[0].id, linkedById)
			results.push({ sourceId: source.id, candidateId: candidates[0].id, candidates: [] })
		} else {
			results.push({
				sourceId: source.id,
				candidateId: null,
				candidates: candidates.map((c) => ({
					id: c.id,
					bookingDate: c.bookingDate as unknown as Date,
					amount: parseFloat(c.amount as unknown as string),
					description: c.description,
					bankAccountId: c.bankAccountId,
					daysDiff: c.daysDiff
				}))
			})
		}
	}

	return results
}

export async function linkPair(idA: string, idB: string, linkedById: string): Promise<void> {
	const now = new Date()
	await Promise.all([
		db
			.update(transactions)
			.set({
				isTransfer: true,
				transferCounterpartId: idB,
				transferLinkedById: linkedById,
				transferLinkedAt: now
			})
			.where(eq(transactions.id, idA)),
		db
			.update(transactions)
			.set({
				isTransfer: true,
				transferCounterpartId: idA,
				transferLinkedById: linkedById,
				transferLinkedAt: now
			})
			.where(eq(transactions.id, idB))
	])
}

export async function unlinkPair(idA: string): Promise<void> {
	const tx = await db.query.transactions.findFirst({
		where: eq(transactions.id, idA),
		columns: { transferCounterpartId: true }
	})
	if (!tx?.transferCounterpartId) return

	await Promise.all([
		db
			.update(transactions)
			.set({
				isTransfer: false,
				transferCounterpartId: null,
				transferLinkedById: null,
				transferLinkedAt: null
			})
			.where(eq(transactions.id, idA)),
		db
			.update(transactions)
			.set({
				isTransfer: false,
				transferCounterpartId: null,
				transferLinkedById: null,
				transferLinkedAt: null
			})
			.where(eq(transactions.id, tx.transferCounterpartId))
	])
}
