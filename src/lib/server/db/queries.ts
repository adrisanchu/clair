import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db } from './index.js';
import { transactions, bankAccounts } from './schema.js';

export const TX_PAGE_SIZE = 25;

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
	status: 'pending' | 'posted' | 'review';
	isTransfer: boolean;
	isOpeningBalance: boolean;
	category: string | null;
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
				status: transactions.status,
				isTransfer: transactions.isTransfer,
				isOpeningBalance: transactions.isOpeningBalance,
				category: transactions.category,
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
			amount: parseFloat(r.amount),
			status: r.status as 'pending' | 'posted' | 'review',
			isOpeningBalance: r.isOpeningBalance ?? false
		})),
		total,
		counts,
		page,
		limit
	};
}
