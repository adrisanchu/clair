import { and, asc, desc, eq, gte, ilike, inArray, sql } from 'drizzle-orm';
import { db } from './index.js';
import { transactions, bankAccounts } from './schema.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

export const TX_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Rolling balance query
// ---------------------------------------------------------------------------

export type Granularity = 'week' | 'month' | 'quarter';

export interface BalancePoint {
	bucket: string; // ISO date string — start of the period bucket
	netChange: number;
	cumulativeBalance: number;
}

export interface RollingBalanceResult {
	points: BalancePoint[];
	windowStart: string; // ISO string — serialisable across SSR boundary
	windowEnd: string;
}

export async function queryRollingBalance(
	accessibleIds: string[],
	granularity: Granularity = 'month'
): Promise<RollingBalanceResult> {
	const now = new Date();
	const windowEnd = now.toISOString();

	const threeMonthsAgo = new Date(now);
	threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

	// Find the earliest posted non-transfer non-opening-balance transaction
	const [earliest] = await db
		.select({ minDate: sql<string>`MIN(${transactions.accountingDate})::text` })
		.from(transactions)
		.where(
			and(
				inArray(transactions.bankAccountId, accessibleIds),
				eq(transactions.isTransfer, false),
				eq(transactions.isOpeningBalance, false),
				eq(transactions.status, 'posted')
			)
		);

	if (!earliest?.minDate) {
		return { points: [], windowStart: threeMonthsAgo.toISOString(), windowEnd };
	}

	const earliestDate = new Date(earliest.minDate);
	const windowStart = earliestDate < threeMonthsAgo ? threeMonthsAgo : earliestDate;

	// safe — granularity is a validated union type, never user-controlled input
	const unit = sql.raw(`'${granularity}'`);
	const bucketExpr = sql<string>`DATE_TRUNC(${unit}, ${transactions.accountingDate}::timestamp)::date::text`;

	const buckets = await db
		.select({
			bucket: bucketExpr,
			netChange: sql<string>`SUM(CASE WHEN ${transactions.currency} = ${PRIMARY_CURRENCY} THEN ${transactions.amount}::numeric ELSE ${transactions.amountEur}::numeric END)`
		})
		.from(transactions)
		.where(
			and(
				inArray(transactions.bankAccountId, accessibleIds),
				eq(transactions.isTransfer, false),
				eq(transactions.isOpeningBalance, false),
				eq(transactions.status, 'posted'),
				gte(transactions.accountingDate, windowStart)
			)
		)
		.groupBy(bucketExpr)
		.orderBy(bucketExpr);

	// Compute running cumulative sum in JS — dataset is tiny (≤52 weekly buckets)
	let running = 0;
	const points: BalancePoint[] = buckets.map((b) => {
		running += parseFloat(b.netChange ?? '0');
		return {
			bucket: b.bucket,
			netChange: parseFloat(b.netChange ?? '0'),
			cumulativeBalance: running
		};
	});

	return { points, windowStart: windowStart.toISOString(), windowEnd };
}

export type TxFilter = 'all' | 'expenses' | 'transfers' | 'review';

export interface TxQueryParams {
	accessibleIds: string[];
	q?: string;
	accountId?: string;
	filter?: TxFilter;
	page?: number;
}

export interface TxRow {
	id: string;
	accountingDate: Date;
	description: string;
	amount: number;
	currency: string;
	amountEur: number | null;
	exchangeRate: number | null;
	conversionId: string | null;
	status: 'pending' | 'posted' | 'review';
	isTransfer: boolean;
	isOpeningBalance: boolean;
	notes: string | null;
	category: string | null;
	categoryOverride: string | null;
	bankAccountId: string;
	accountName: string | null;
	bankProfileId: string | null;
}

export interface TxQueryResult {
	rows: TxRow[];
	total: number;
	counts: { all: number; expenses: number; transfers: number; review: number };
	page: number;
	limit: number;
}

// ---------------------------------------------------------------------------
// Export query (no pagination) — round-trip-safe subset for CSV download
// ---------------------------------------------------------------------------

export interface ExportTxRow {
	accountingDate: Date;
	amount: number;
	description: string;
	currency: string;
	accountName: string | null;
	category: string | null; // AI-tagged category
	categoryOverride: string | null; // user correction (takes precedence on export)
	notes: string | null;
	city: string | null;
}

/**
 * Fetch every accessible transaction for CSV export.
 *
 * No pagination. Ordered accountingDate ASC then originalOrder ASC so a re-import
 * lands rows in their original file sequence. Opening-balance rows are synthetic
 * and excluded — they are not real transactions and would re-import oddly.
 *
 * @param accessibleIds account IDs the user may view (from getFullAccessAccountIds)
 * @param accountIds optional subset to export; ignored entries outside accessibleIds
 */
export async function queryTransactionsForExport(
	accessibleIds: string[],
	accountIds?: string[]
): Promise<ExportTxRow[]> {
	if (accessibleIds.length === 0) return [];

	// Intersect the requested subset with what the user is actually allowed to see.
	const requested = accountIds?.length
		? accountIds.filter((id) => accessibleIds.includes(id))
		: accessibleIds;
	if (requested.length === 0) return [];

	const rows = await db
		.select({
			accountingDate: transactions.accountingDate,
			amount: transactions.amount,
			description: transactions.description,
			currency: transactions.currency,
			accountName: bankAccounts.displayName,
			category: transactions.category,
			categoryOverride: transactions.categoryOverride,
			notes: transactions.notes,
			city: transactions.city
		})
		.from(transactions)
		.leftJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(inArray(transactions.bankAccountId, requested), eq(transactions.isOpeningBalance, false))
		)
		.orderBy(asc(transactions.accountingDate), asc(transactions.originalOrder));

	return rows.map((r) => ({
		...r,
		amount: parseFloat(r.amount as string)
	}));
}

export async function queryTransactions(params: TxQueryParams): Promise<TxQueryResult> {
	const { accessibleIds, q = '', accountId = '', filter = 'all', page = 1 } = params;
	const limit = TX_PAGE_SIZE;
	const offset = (page - 1) * limit;

	if (accessibleIds.length === 0) {
		return {
			rows: [],
			total: 0,
			counts: { all: 0, expenses: 0, transfers: 0, review: 0 },
			page: 1,
			limit
		};
	}

	const baseWhere = and(inArray(transactions.bankAccountId, accessibleIds));

	// Opening balance is only visible in the 'all' tab.
	// For 'expenses' we must explicitly exclude it (it could have a negative amount).
	// For 'transfers' and 'review' it is naturally excluded by those conditions.
	const filterCondition =
		filter === 'expenses'
			? and(
					sql`${transactions.amount}::numeric < 0`,
					eq(transactions.isTransfer, false),
					eq(transactions.isOpeningBalance, false)
				)
			: filter === 'transfers'
				? eq(transactions.isTransfer, true)
				: filter === 'review'
					? eq(transactions.status, 'review')
					: undefined;

	const searchCondition = q.trim() ? ilike(transactions.description, `%${q.trim()}%`) : undefined;
	const accountCondition = accountId ? eq(transactions.bankAccountId, accountId) : undefined;

	const fullWhere = and(baseWhere, filterCondition, searchCondition, accountCondition);
	const countWhere = and(baseWhere, searchCondition, accountCondition);

	const [rows, countsResult] = await Promise.all([
		db
			.select({
				id: transactions.id,
				accountingDate: transactions.accountingDate,
				description: transactions.description,
				amount: transactions.amount,
				currency: transactions.currency,
				amountEur: transactions.amountEur,
				exchangeRate: transactions.exchangeRate,
				conversionId: transactions.conversionId,
				status: transactions.status,
				isTransfer: transactions.isTransfer,
				isOpeningBalance: transactions.isOpeningBalance,
				notes: transactions.notes,
				category: transactions.category,
				categoryOverride: transactions.categoryOverride,
				bankAccountId: transactions.bankAccountId,
				accountName: bankAccounts.displayName,
				bankProfileId: bankAccounts.bankProfileId
			})
			.from(transactions)
			.leftJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
			.where(fullWhere)
			.orderBy(desc(transactions.accountingDate), desc(transactions.createdAt))
			.limit(limit)
			.offset(offset),

		db
			.select({
				// Tab badge counts never include the opening balance row
				all: sql<number>`COUNT(*) FILTER (WHERE NOT ${transactions.isOpeningBalance})::int`,
				allWithOpening: sql<number>`COUNT(*)::int`,
				expenses: sql<number>`COUNT(*) FILTER (WHERE ${transactions.amount}::numeric < 0 AND NOT ${transactions.isTransfer} AND NOT ${transactions.isOpeningBalance})::int`,
				transfers: sql<number>`COUNT(*) FILTER (WHERE ${transactions.isTransfer})::int`,
				review: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'review')::int`
			})
			.from(transactions)
			.where(countWhere)
	]);

	const counts = {
		all: countsResult[0]?.all ?? 0,
		expenses: countsResult[0]?.expenses ?? 0,
		transfers: countsResult[0]?.transfers ?? 0,
		review: countsResult[0]?.review ?? 0
	};

	// For 'all', use allWithOpening so pagination math is accurate when the
	// opening balance row is visible in the table.
	const total =
		filter === 'all'
			? (countsResult[0]?.allWithOpening ?? 0)
			: filter === 'expenses'
				? counts.expenses
				: filter === 'transfers'
					? counts.transfers
					: counts.review;

	return {
		rows: rows.map((r) => ({
			...r,
			amount: parseFloat(r.amount as string),
			amountEur:
				r.currency === PRIMARY_CURRENCY
					? parseFloat(r.amount as string)
					: r.amountEur != null
						? parseFloat(r.amountEur as string)
						: null,
			exchangeRate: r.exchangeRate != null ? parseFloat(r.exchangeRate as string) : null,
			status: r.status as 'pending' | 'posted' | 'review',
			isOpeningBalance: r.isOpeningBalance ?? false
		})),
		total,
		counts,
		page,
		limit
	};
}
