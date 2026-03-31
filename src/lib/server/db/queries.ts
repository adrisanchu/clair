import { and, desc, eq, ilike, inArray, sql } from 'drizzle-orm'
import { db } from './index.js'
import { transactions, bankAccounts } from './schema.js'

export const TX_PAGE_SIZE = 25

export type TxFilter = 'all' | 'expenses' | 'transfers' | 'review'

export interface TxQueryParams {
	accessibleIds: string[]
	q?: string
	accountId?: string
	filter?: TxFilter
	page?: number
}

export interface TxRow {
	id: string
	bookingDate: Date
	description: string
	amount: number
	currency: string
	status: 'pending' | 'posted' | 'review'
	isTransfer: boolean
	category: string | null
	bankAccountId: string
	accountName: string | null
	bankProfileId: string | null
}

export interface TxQueryResult {
	rows: TxRow[]
	total: number
	counts: { all: number; expenses: number; transfers: number; review: number }
	page: number
	limit: number
}

export async function queryTransactions(params: TxQueryParams): Promise<TxQueryResult> {
	const { accessibleIds, q = '', accountId = '', filter = 'all', page = 1 } = params
	const limit = TX_PAGE_SIZE
	const offset = (page - 1) * limit

	if (accessibleIds.length === 0) {
		return {
			rows: [],
			total: 0,
			counts: { all: 0, expenses: 0, transfers: 0, review: 0 },
			page: 1,
			limit
		}
	}

	const baseWhere = and(
		inArray(transactions.bankAccountId, accessibleIds),
		eq(transactions.isOpeningBalance, false)
	)

	const filterCondition =
		filter === 'expenses'
			? and(sql`${transactions.amount}::numeric < 0`, eq(transactions.isTransfer, false))
			: filter === 'transfers'
				? eq(transactions.isTransfer, true)
				: filter === 'review'
					? eq(transactions.status, 'review')
					: undefined

	const searchCondition = q.trim() ? ilike(transactions.description, `%${q.trim()}%`) : undefined
	const accountCondition = accountId ? eq(transactions.bankAccountId, accountId) : undefined

	const fullWhere = and(baseWhere, filterCondition, searchCondition, accountCondition)
	const countWhere = and(baseWhere, searchCondition, accountCondition)

	const [rows, countsResult] = await Promise.all([
		db
			.select({
				id: transactions.id,
				bookingDate: transactions.bookingDate,
				description: transactions.description,
				amount: transactions.amount,
				currency: transactions.currency,
				status: transactions.status,
				isTransfer: transactions.isTransfer,
				category: transactions.category,
				bankAccountId: transactions.bankAccountId,
				accountName: bankAccounts.displayName,
				bankProfileId: bankAccounts.bankProfileId
			})
			.from(transactions)
			.leftJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
			.where(fullWhere)
			.orderBy(desc(transactions.bookingDate), desc(transactions.createdAt))
			.limit(limit)
			.offset(offset),

		db
			.select({
				all: sql<number>`COUNT(*)::int`,
				expenses: sql<number>`COUNT(*) FILTER (WHERE ${transactions.amount}::numeric < 0 AND NOT ${transactions.isTransfer})::int`,
				transfers: sql<number>`COUNT(*) FILTER (WHERE ${transactions.isTransfer})::int`,
				review: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'review')::int`
			})
			.from(transactions)
			.where(countWhere)
	])

	const counts = {
		all: countsResult[0]?.all ?? 0,
		expenses: countsResult[0]?.expenses ?? 0,
		transfers: countsResult[0]?.transfers ?? 0,
		review: countsResult[0]?.review ?? 0
	}

	const total =
		filter === 'all'
			? counts.all
			: filter === 'expenses'
				? counts.expenses
				: filter === 'transfers'
					? counts.transfers
					: counts.review

	return {
		rows: rows.map((r) => ({
			...r,
			amount: parseFloat(r.amount),
			status: r.status as 'pending' | 'posted' | 'review'
		})),
		total,
		counts,
		page,
		limit
	}
}
