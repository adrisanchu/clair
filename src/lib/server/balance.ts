import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { transactions, bankAccounts } from './db/schema.js';
import { eurSumSql } from './db/queries.js';
import { propagateRateToAccount } from './currency-converter.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

/**
 * Compute the synthetic opening balance needed so that:
 *   openingBalance + uploadSum + existingSum = enteredCurrentBalance
 */
export async function computeOpeningBalance(
	bankAccountId: string,
	enteredCurrentBalance: number,
	uploadedRows: { amount: number; status?: 'pending' | 'posted' | 'review' | 'reverted' }[]
): Promise<number> {
	// Only posted rows move the real balance — pending and reverted are excluded so the
	// derived opening balance reconciles with refreshCurrentBalance (which also sums posted).
	const [{ sum }] = await db
		.select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
		.from(transactions)
		.where(and(eq(transactions.bankAccountId, bankAccountId), eq(transactions.status, 'posted')));

	const uploadSum = uploadedRows
		.filter((r) => (r.status ?? 'posted') === 'posted')
		.reduce((acc, r) => acc + r.amount, 0);
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

	// The opening row is denominated in the account's own currency (a SEK account's opening
	// balance is SEK), so EUR-normalised sums never read foreign units as EUR.
	const account = await db.query.bankAccounts.findFirst({
		where: eq(bankAccounts.id, bankAccountId),
		columns: { currency: true }
	});
	const currency = account?.currency ?? PRIMARY_CURRENCY;

	// Check for an existing opening balance row
	const existing = await db.query.transactions.findFirst({
		where: (t, { and, eq }) =>
			and(eq(t.bankAccountId, bankAccountId), eq(t.isOpeningBalance, true)),
		columns: { id: true }
	});

	if (existing) {
		await db
			.update(transactions)
			.set({ amount: openingAmount.toFixed(4), currency, updatedAt: new Date() })
			.where(eq(transactions.id, existing.id));
	} else {
		await db.insert(transactions).values({
			bankAccountId,
			accountingDate: openingDate,
			amount: openingAmount.toFixed(4),
			currency,
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
	// Sum posted transactions only — pending and reverted rows don't affect the real balance,
	// so Clair's current balance matches the bank app's balance.
	const [{ sum }] = await db
		.select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
		.from(transactions)
		.where(and(eq(transactions.bankAccountId, bankAccountId), eq(transactions.status, 'posted')));

	await db
		.update(bankAccounts)
		.set({ currentBalance: sum })
		.where(eq(bankAccounts.id, bankAccountId));
}

/**
 * Recompute everything derived from an account's rows: the stored current balance and,
 * on a foreign-currency account, the EUR valuation of every row. Call after any change
 * that adds, removes, or moves a row's amount/date (manual cash edits, deletions) — the
 * FX valuation is order-dependent, so a single changed row can re-value later ones.
 */
export async function refreshAccountDerived(bankAccountId: string): Promise<void> {
	await refreshCurrentBalance(bankAccountId);
	const account = await db.query.bankAccounts.findFirst({
		where: eq(bankAccounts.id, bankAccountId),
		columns: { currency: true }
	});
	if (account && account.currency !== PRIMARY_CURRENCY) {
		await propagateRateToAccount(bankAccountId);
	}
}

export interface EurBalance {
	/** EUR value of the account's posted rows (cost basis on foreign accounts). */
	balanceEur: number;
	/** True when some posted foreign row has no EUR value yet, so `balanceEur` is incomplete. */
	eurPartial: boolean;
}

/**
 * EUR-normalised balance per account: EUR rows count at face value, foreign rows at their
 * stored `amountEur`. Same posted-only rule as `refreshCurrentBalance`, so for EUR accounts
 * it equals `currentBalance`.
 */
export async function getEurBalances(accountIds: string[]): Promise<Map<string, EurBalance>> {
	const result = new Map<string, EurBalance>();
	if (accountIds.length === 0) return result;

	const rows = await db
		.select({
			bankAccountId: transactions.bankAccountId,
			balanceEur: eurSumSql,
			unresolved: sql<number>`COUNT(*) FILTER (WHERE ${transactions.currency} <> ${PRIMARY_CURRENCY} AND ${transactions.amountEur} IS NULL AND ${transactions.amount}::numeric <> 0)::int`
		})
		.from(transactions)
		.where(and(inArray(transactions.bankAccountId, accountIds), eq(transactions.status, 'posted')))
		.groupBy(transactions.bankAccountId);

	for (const r of rows) {
		result.set(r.bankAccountId, {
			balanceEur: parseFloat(r.balanceEur ?? '0') || 0,
			eurPartial: r.unresolved > 0
		});
	}
	return result;
}
