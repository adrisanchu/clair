import { and, ne, eq, isNull, sql, inArray } from 'drizzle-orm';
import { addDays, subDays } from 'date-fns';
import { db } from './db/index.js';
import { bankAccounts, transactions } from './db/schema.js';

function toDateStr(d: unknown): string {
	const date = d instanceof Date ? d : new Date(d as string);
	return date.toISOString().split('T')[0];
}

export interface TransferCandidate {
	id: string;
	accountingDate: Date;
	amount: number;
	description: string;
	bankAccountId: string;
	accountName: string;
	daysDiff: number;
}

export interface TransferMatch {
	sourceId: string;
	sourceDescription: string;
	sourceAmount: number;
	sourceDate: Date;
	sourceAccountName: string;
	candidateId: string | null; // null = no auto-link found
	candidates: TransferCandidate[]; // populated for auto-linked (1 item) and unresolved (1+ items)
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
	if (newTransactionIds.length === 0 || accessibleAccountIds.length === 0) return [];

	const sources = await db
		.select({
			id: transactions.id,
			accountingDate: transactions.accountingDate,
			amount: transactions.amount,
			description: transactions.description,
			bankAccountId: transactions.bankAccountId,
			accountName: bankAccounts.displayName
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				inArray(transactions.id, newTransactionIds),
				eq(transactions.isTransfer, true),
				isNull(transactions.transferCounterpartId),
				eq(transactions.isOpeningBalance, false)
			)
		);

	const results: TransferMatch[] = [];

	for (const source of sources) {
		const sourceDate = source.accountingDate as unknown as Date;
		// Convert to ISO date string — passing a Date directly into a `sql` template
		// causes the pg driver to serialise via .toString() which PostgreSQL cannot cast as ::date.
		const sourceDateStr = (
			sourceDate instanceof Date ? sourceDate : new Date(sourceDate as unknown as string)
		)
			.toISOString()
			.split('T')[0];

		const candidates = await db
			.select({
				id: transactions.id,
				accountingDate: transactions.accountingDate,
				amount: transactions.amount,
				description: transactions.description,
				bankAccountId: transactions.bankAccountId,
				accountName: bankAccounts.displayName,
				daysDiff: sql<number>`ABS(EXTRACT(DAY FROM (
					${transactions.accountingDate} - ${sourceDateStr}::date
				)))`
			})
			.from(transactions)
			.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
			.where(
				and(
					ne(transactions.bankAccountId, source.bankAccountId),
					inArray(transactions.bankAccountId, accessibleAccountIds),
					sql`ABS(${transactions.amount}::numeric) = ABS(${source.amount}::numeric)`,
					sql`SIGN(${transactions.amount}::numeric) != SIGN(${source.amount}::numeric)`,
					sql`${transactions.accountingDate} >= ${toDateStr(subDays(sourceDate, 3))}::date`,
					sql`${transactions.accountingDate} <= ${toDateStr(addDays(sourceDate, 3))}::date`,
					isNull(transactions.transferCounterpartId),
					eq(transactions.isOpeningBalance, false)
				)
			)
			.orderBy(
				sql`ABS(EXTRACT(DAY FROM (${transactions.accountingDate} - ${sourceDateStr}::date)))`
			)
			.limit(5);

		const mappedCandidates = candidates.map((c) => ({
			id: c.id,
			accountingDate: c.accountingDate as unknown as Date,
			amount: parseFloat(c.amount as unknown as string),
			description: c.description,
			bankAccountId: c.bankAccountId,
			accountName: c.accountName,
			daysDiff: c.daysDiff
		}));

		const baseMatch = {
			sourceId: source.id,
			sourceDescription: source.description,
			sourceAmount: parseFloat(source.amount as unknown as string),
			sourceDate: sourceDate,
			sourceAccountName: source.accountName
		};

		if (candidates.length === 1) {
			await linkPair(source.id, candidates[0].id, linkedById);
			results.push({ ...baseMatch, candidateId: candidates[0].id, candidates: mappedCandidates });
		} else {
			results.push({ ...baseMatch, candidateId: null, candidates: mappedCandidates });
		}
	}

	return results;
}

export async function linkPair(idA: string, idB: string, linkedById: string): Promise<void> {
	const now = new Date();
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
	]);
}

export async function unlinkPair(idA: string): Promise<void> {
	const tx = await db.query.transactions.findFirst({
		where: eq(transactions.id, idA),
		columns: { transferCounterpartId: true }
	});
	if (!tx?.transferCounterpartId) return;

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
	]);
}
