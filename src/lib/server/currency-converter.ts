import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { addDays, subDays } from 'date-fns';
import { db } from './db/index.js';
import { bankAccounts, currencyConversions, transactions } from './db/schema.js';

/**
 * Converts a Date (or Drizzle date result) to a plain `YYYY-MM-DD` string.
 * When embedded in a `sql` template literal, Drizzle parameterises the value
 * and the pg driver serialises a JS Date via `.toString()` — which PostgreSQL
 * cannot cast to `::date`. Passing an ISO date string instead is always safe.
 */
function toDateStr(d: unknown): string {
	const date = d instanceof Date ? d : new Date(d as string);
	return date.toISOString().split('T')[0];
}

export interface CurrencyConversionResult {
	conversionId: string;
	fromAccountId: string; // EUR source account
	toAccountId: string; // foreign-currency destination account
	fromTransactionId: string;
	toTransactionId: string;
	fromAmount: number; // EUR amount (absolute value)
	toAmount: number; // foreign amount
	exchangeRate: number; // toAmount / fromAmount
	effectiveFrom: Date;
	affectedTxCount: number;
	confidence: 'auto';
	fromAccountName: string;
	fromTransactionDescription: string;
	toAccountName: string;
	toTransactionDescription: string;
}

/**
 * After inserting a batch of transactions, detect cross-currency conversion pairs
 * and create currency_conversions records.
 *
 * Two flows depending on the account currency:
 *   - Non-EUR account: look for matching negative EUR transactions in the workspace
 *   - EUR account: look for existing unresolved positive foreign-currency transactions
 *
 * Returns the list of conversions created.
 */
export async function detectAndCreateConversions(
	insertedIds: string[],
	workspaceId: string,
	accountCurrency: string
): Promise<CurrencyConversionResult[]> {
	if (insertedIds.length === 0) return [];

	const results: CurrencyConversionResult[] = [];

	if (accountCurrency !== 'EUR') {
		// Flow 1: new non-EUR transactions → find matching negative EUR transactions
		const fxTxs = await db
			.select({
				id: transactions.id,
				amount: transactions.amount,
				accountingDate: transactions.accountingDate,
				bankAccountId: transactions.bankAccountId,
				description: transactions.description,
				accountName: bankAccounts.displayName
			})
			.from(transactions)
			.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
			.where(
				and(
					inArray(transactions.id, insertedIds),
					sql`${transactions.amount}::numeric > 0`,
					eq(transactions.isFxCandidate, true),
					isNull(transactions.conversionId)
				)
			);

		for (const fxTx of fxTxs) {
			const txDate = fxTx.accountingDate as unknown as Date;
			const txDateStr = toDateStr(txDate);

			// Find matching negative EUR transactions in the same workspace (date window: C ≤ T ≤ C+3)
			const eurCandidates = await db
				.select({
					id: transactions.id,
					amount: transactions.amount,
					accountingDate: transactions.accountingDate,
					bankAccountId: transactions.bankAccountId,
					description: transactions.description,
					accountName: bankAccounts.displayName
				})
				.from(transactions)
				.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
				.where(
					and(
						eq(bankAccounts.workspaceId, workspaceId),
						eq(bankAccounts.currency, 'EUR'),
						sql`${transactions.amount}::numeric < 0`,
						eq(transactions.isFxCandidate, true),
						// EUR outgoing must be ≤ FX settlement date, within 3 days
						sql`${transactions.accountingDate} >= ${toDateStr(subDays(txDate, 3))}::date`,
						sql`${transactions.accountingDate} <= ${txDateStr}::date`,
						isNull(transactions.conversionId)
					)
				)
				.orderBy(
					sql`ABS(EXTRACT(DAY FROM (${transactions.accountingDate} - ${txDateStr}::date)))`
				)
				.limit(5);

			if (eurCandidates.length === 0) continue;

			const best = eurCandidates[0];
			const fxAmount = parseFloat(fxTx.amount as unknown as string);
			const eurAmount = Math.abs(parseFloat(best.amount as unknown as string));
			const rate = fxAmount / eurAmount;
			const effectiveFrom = best.accountingDate as unknown as Date;

			const [conversion] = await db
				.insert(currencyConversions)
				.values({
					workspaceId,
					fromAccountId: best.bankAccountId,
					toAccountId: fxTx.bankAccountId,
					fromAmount: eurAmount.toFixed(4),
					toAmount: fxAmount.toFixed(4),
					exchangeRate: rate.toFixed(6),
					effectiveFrom,
					confidence: 'auto',
					fromTransactionId: best.id,
					toTransactionId: fxTx.id
				})
				.returning({ id: currencyConversions.id });

			const count = await propagateRateToAccount(fxTx.bankAccountId);

			results.push({
				conversionId: conversion.id,
				fromAccountId: best.bankAccountId,
				toAccountId: fxTx.bankAccountId,
				fromTransactionId: best.id,
				toTransactionId: fxTx.id,
				fromAmount: eurAmount,
				toAmount: fxAmount,
				exchangeRate: rate,
				effectiveFrom,
				affectedTxCount: count,
				confidence: 'auto',
				fromAccountName: best.accountName,
				fromTransactionDescription: best.description,
				toAccountName: fxTx.accountName,
				toTransactionDescription: fxTx.description
			});
		}
	} else {
		// Flow 2: new EUR transactions → backfill existing unresolved foreign-currency transactions
		const eurTxs = await db
			.select({
				id: transactions.id,
				amount: transactions.amount,
				accountingDate: transactions.accountingDate,
				bankAccountId: transactions.bankAccountId,
				description: transactions.description,
				accountName: bankAccounts.displayName
			})
			.from(transactions)
			.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
			.where(
				and(
					inArray(transactions.id, insertedIds),
					sql`${transactions.amount}::numeric < 0`,
					eq(transactions.isFxCandidate, true)
				)
			);

		for (const eurTx of eurTxs) {
			const txDate = eurTx.accountingDate as unknown as Date;
			const txDateStr = toDateStr(txDate);
			const eurAbsAmount = Math.abs(parseFloat(eurTx.amount as unknown as string));

			// Find existing unresolved positive FX-candidate transactions on non-EUR accounts
			// FX settlement T.date >= C.date, within 3 days
			const fxCandidates = await db
				.select({
					id: transactions.id,
					amount: transactions.amount,
					accountingDate: transactions.accountingDate,
					bankAccountId: transactions.bankAccountId,
					description: transactions.description,
					accountName: bankAccounts.displayName
				})
				.from(transactions)
				.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
				.where(
					and(
						eq(bankAccounts.workspaceId, workspaceId),
						ne(bankAccounts.currency, 'EUR'),
						sql`${transactions.amount}::numeric > 0`,
						eq(transactions.isFxCandidate, true),
						isNull(transactions.conversionId),
						sql`${transactions.accountingDate} >= ${txDateStr}::date`,
						sql`${transactions.accountingDate} <= ${toDateStr(addDays(txDate, 3))}::date`
					)
				)
				.orderBy(
					sql`ABS(EXTRACT(DAY FROM (${transactions.accountingDate} - ${txDateStr}::date)))`
				)
				.limit(5);

			if (fxCandidates.length === 0) continue;

			const best = fxCandidates[0];
			const fxAmount = parseFloat(best.amount as unknown as string);
			const rate = fxAmount / eurAbsAmount;
			const effectiveFrom = txDate;

			const [conversion] = await db
				.insert(currencyConversions)
				.values({
					workspaceId,
					fromAccountId: eurTx.bankAccountId,
					toAccountId: best.bankAccountId,
					fromAmount: eurAbsAmount.toFixed(4),
					toAmount: fxAmount.toFixed(4),
					exchangeRate: rate.toFixed(6),
					effectiveFrom,
					confidence: 'auto',
					fromTransactionId: eurTx.id,
					toTransactionId: best.id
				})
				.returning({ id: currencyConversions.id });

			const count = await propagateRateToAccount(best.bankAccountId);

			results.push({
				conversionId: conversion.id,
				fromAccountId: eurTx.bankAccountId,
				toAccountId: best.bankAccountId,
				fromTransactionId: eurTx.id,
				toTransactionId: best.id,
				fromAmount: eurAbsAmount,
				toAmount: fxAmount,
				exchangeRate: rate,
				effectiveFrom,
				affectedTxCount: count,
				confidence: 'auto',
				fromAccountName: eurTx.accountName,
				fromTransactionDescription: eurTx.description,
				toAccountName: best.accountName,
				toTransactionDescription: best.description
			});
		}
	}

	return results;
}

/**
 * Assigns exchange rates to all transactions on a foreign-currency account,
 * using the time-window rule: each transaction uses the latest conversion
 * whose effectiveFrom is ≤ the transaction date.
 *
 * Re-runs the full assignment so multiple conversions at different rates are
 * handled correctly.
 *
 * Returns the total number of transactions updated.
 */
export async function propagateRateToAccount(accountId: string): Promise<number> {
	const allConversions = await db
		.select({
			id: currencyConversions.id,
			exchangeRate: currencyConversions.exchangeRate,
			effectiveFrom: currencyConversions.effectiveFrom
		})
		.from(currencyConversions)
		.where(eq(currencyConversions.toAccountId, accountId))
		.orderBy(asc(currencyConversions.effectiveFrom));

	if (allConversions.length === 0) return 0;

	let totalUpdated = 0;

	for (let i = 0; i < allConversions.length; i++) {
		const conv = allConversions[i];
		const nextConv = allConversions[i + 1];
		const rate = parseFloat(conv.exchangeRate as unknown as string);
		const effectiveFrom = conv.effectiveFrom as unknown as Date;

		const effectiveFromStr = toDateStr(effectiveFrom);
		const dateRange =
			nextConv !== undefined
				? and(
						sql`${transactions.accountingDate} >= ${effectiveFromStr}::date`,
						sql`${transactions.accountingDate} < ${toDateStr(nextConv.effectiveFrom as unknown as Date)}::date`
					)
				: sql`${transactions.accountingDate} >= ${effectiveFromStr}::date`;

		const updated = await db
			.update(transactions)
			.set({
				conversionId: conv.id,
				exchangeRate: rate.toFixed(6),
				amountEur: sql`ROUND((${transactions.amount}::numeric / ${rate}::numeric), 4)`
			})
			.where(
				and(eq(transactions.bankAccountId, accountId), eq(transactions.isOpeningBalance, false), dateRange)
			)
			.returning({ id: transactions.id });

		totalUpdated += updated.length;
	}

	return totalUpdated;
}

/**
 * Returns the count of transactions on non-EUR accounts in the workspace
 * that have no conversion assigned (conversionId IS NULL).
 * Used to surface the unresolved FX banner on the accounts page.
 */
export async function countUnresolvedFxTransactions(workspaceId: string): Promise<number> {
	const result = await db
		.select({ count: sql<number>`COUNT(*)::int` })
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				ne(bankAccounts.currency, 'EUR'),
				isNull(transactions.conversionId),
				eq(transactions.isOpeningBalance, false)
			)
		);

	return result[0]?.count ?? 0;
}

/**
 * Returns the list of non-EUR accounts in the workspace that have unresolved
 * transactions, along with the date range of their unresolved transactions.
 */
export interface UnresolvedFxAccount {
	accountId: string;
	accountName: string;
	currency: string;
	unresolvedCount: number;
	earliestDate: Date;
	latestDate: Date;
}

export async function getUnresolvedFxAccounts(workspaceId: string): Promise<UnresolvedFxAccount[]> {
	const rows = await db
		.select({
			accountId: bankAccounts.id,
			accountName: bankAccounts.displayName,
			currency: bankAccounts.currency,
			unresolvedCount: sql<number>`COUNT(${transactions.id})::int`,
			earliestDate: sql<Date>`MIN(${transactions.accountingDate})`,
			latestDate: sql<Date>`MAX(${transactions.accountingDate})`
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				ne(bankAccounts.currency, 'EUR'),
				isNull(transactions.conversionId),
				eq(transactions.isOpeningBalance, false)
			)
		)
		.groupBy(bankAccounts.id, bankAccounts.displayName, bankAccounts.currency)
		.having(sql`COUNT(${transactions.id}) > 0`);

	return rows.map((r) => ({
		accountId: r.accountId,
		accountName: r.accountName,
		currency: r.currency,
		unresolvedCount: r.unresolvedCount,
		earliestDate: r.earliestDate,
		latestDate: r.latestDate
	}));
}
