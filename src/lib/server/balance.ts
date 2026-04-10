import { eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { transactions, bankAccounts } from './db/schema.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

/**
 * Compute the synthetic opening balance needed so that:
 *   openingBalance + uploadSum + existingSum = enteredCurrentBalance
 */
export async function computeOpeningBalance(
	bankAccountId: string,
	enteredCurrentBalance: number,
	uploadedRows: { amount: number }[]
): Promise<number> {
	const [{ sum }] = await db
		.select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
		.from(transactions)
		.where(eq(transactions.bankAccountId, bankAccountId));

	const uploadSum = uploadedRows.reduce((acc, r) => acc + r.amount, 0);
	return enteredCurrentBalance - uploadSum - parseFloat(sum);
}

/**
 * Insert or update the synthetic opening-balance transaction for an account.
 * There is at most one per account (identified by isOpeningBalance = true).
 */
export async function upsertOpeningBalance(
	bankAccountId: string,
	openingAmount: number,
	earliestDate: Date,
	userId: string
): Promise<void> {
	const openingDate = new Date(earliestDate);
	openingDate.setDate(openingDate.getDate() - 1);

	// Check for an existing opening balance row
	const existing = await db.query.transactions.findFirst({
		where: (t, { and, eq }) =>
			and(eq(t.bankAccountId, bankAccountId), eq(t.isOpeningBalance, true)),
		columns: { id: true }
	});

	if (existing) {
		await db
			.update(transactions)
			.set({ amount: openingAmount.toFixed(4), updatedAt: new Date() })
			.where(eq(transactions.id, existing.id));
	} else {
		await db.insert(transactions).values({
			bankAccountId,
			accountingDate: openingDate,
			amount: openingAmount.toFixed(4),
			currency: PRIMARY_CURRENCY,
			description: 'Opening balance',
			notes:
				'This represents the opening status of the bank account in order to reconcile the balance with the ledger.',
			category: 'balance_adjustment',
			isOpeningBalance: true,
			payerUserId: userId,
			status: 'posted',
			syncSource: 'csv_upload'
		});
	}
}

/**
 * Recompute and store the current balance for an account by summing all transactions.
 */
export async function refreshCurrentBalance(bankAccountId: string): Promise<void> {
	const [{ sum }] = await db
		.select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
		.from(transactions)
		.where(eq(transactions.bankAccountId, bankAccountId));

	await db
		.update(bankAccounts)
		.set({ currentBalance: sum })
		.where(eq(bankAccounts.id, bankAccountId));
}
