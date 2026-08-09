import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { subDays } from 'date-fns';
import { db } from './db/index.js';
import { bankAccounts, currencyConversions, transactions } from './db/schema.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

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

interface ForeignAnchor {
	id: string;
	amount: string | number;
	accountingDate: unknown;
	bankAccountId: string;
	description: string;
	accountName: string;
}

/**
 * Resolve a single foreign-currency anchor — a flagged inbound (`isFxCandidate`,
 * e.g. Revolut 'Cambio') on a non-EUR account — to its EUR funding leg, and create
 * the `currency_conversions` record.
 *
 * Matching strategy (#30): the flagged foreign leg is the **anchor**; the EUR funding
 * leg is matched structurally — the nearest opposite-sign EUR row in a `[T-3, T]`
 * window — **without requiring the EUR leg to be flagged**. A flagged EUR leg is
 * merely preferred (it ranks first). This is what lets cross-bank funding link: a
 * €250 wire from an unflagged Spanish EUR bank now matches the Revolut 'Cambio' it
 * funded. Because FX legs cannot be amount-matched across currencies, keeping the
 * flagged foreign leg as the anchor is what guards against over-pairing.
 *
 * Returns the created conversion, or null when no EUR funder exists in the window.
 */
async function resolveForeignAnchor(
	fxTx: ForeignAnchor,
	workspaceId: string
): Promise<CurrencyConversionResult | null> {
	const txDate = fxTx.accountingDate as unknown as Date;
	const txDateStr = toDateStr(txDate);

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
				eq(bankAccounts.currency, PRIMARY_CURRENCY),
				sql`${transactions.amount}::numeric < 0`,
				isNull(transactions.conversionId),
				eq(transactions.isOpeningBalance, false),
				// EUR outgoing must be ≤ FX settlement date, within 3 days
				sql`${transactions.accountingDate} >= ${toDateStr(subDays(txDate, 3))}::date`,
				sql`${transactions.accountingDate} <= ${txDateStr}::date`
			)
		)
		// Prefer a flagged EUR leg (both sides typed as FX), then the closest by date.
		.orderBy(
			sql`${transactions.isFxCandidate} DESC`,
			sql`ABS(EXTRACT(DAY FROM (${transactions.accountingDate} - ${txDateStr}::date)))`
		)
		.limit(5);

	if (eurCandidates.length === 0) return null;

	const best = eurCandidates[0];
	const fxAmount = parseFloat(fxTx.amount as unknown as string);
	const eurAmount = Math.abs(parseFloat(best.amount as unknown as string));
	if (eurAmount === 0) return null;
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

	return {
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
	};
}

/**
 * Detect cross-currency conversions across the whole workspace by (re)scanning every
 * UNRESOLVED foreign anchor — not just the rows from the current import.
 *
 * Run on every import, this fixes two #30 failure modes at once:
 *   - **Re-upload / late funder:** detection no longer hinges on a non-empty inserted
 *     batch, so a EUR funder imported after the foreign leg (or a plain re-upload)
 *     still links. This was the production silent-failure: a re-upload dedups to zero
 *     inserts, so the old `insertedIds`-gated detector never ran.
 *   - **Cross-bank funding:** the EUR leg no longer has to be flagged (see
 *     `resolveForeignAnchor`), so funding from a non-Revolut EUR account links.
 *
 * The anchor must be a flagged foreign inbound (`isFxCandidate`) — the reliable signal
 * a parser emits (e.g. Revolut 'Cambio'). Only the EUR funding leg is matched loosely.
 * Foreign↔foreign conversions (no EUR leg) are intentionally out of scope.
 */
export async function rescanWorkspaceConversions(
	workspaceId: string
): Promise<CurrencyConversionResult[]> {
	const anchors = await db
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
				ne(bankAccounts.currency, PRIMARY_CURRENCY),
				sql`${transactions.amount}::numeric > 0`,
				eq(transactions.isFxCandidate, true),
				isNull(transactions.conversionId),
				eq(transactions.isOpeningBalance, false)
			)
		)
		// Oldest first so earlier conversions establish rate windows before later ones.
		.orderBy(asc(transactions.accountingDate));

	const results: CurrencyConversionResult[] = [];
	for (const anchor of anchors) {
		const result = await resolveForeignAnchor(anchor, workspaceId);
		if (result) results.push(result);
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
				and(
					eq(transactions.bankAccountId, accountId),
					eq(transactions.isOpeningBalance, false),
					dateRange
				)
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
				ne(bankAccounts.currency, PRIMARY_CURRENCY),
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
				ne(bankAccounts.currency, PRIMARY_CURRENCY),
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
