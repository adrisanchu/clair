import { error } from '@sveltejs/kit';
import { and, count, eq, gte, inArray, isNull, sql, sum } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, csvUploads, transactions } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import {
	queryRollingBalance,
	findActionableOrphans,
	type Granularity,
	type OrphanTransfer
} from '$lib/server/db/queries.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);

	const gParam = url.searchParams.get('g') ?? 'month';
	const granularity: Granularity = (['week', 'month', 'quarter'] as const).includes(
		gParam as Granularity
	)
		? (gParam as Granularity)
		: 'month';

	const emptyBalance = { points: [], windowStart: '', windowEnd: '' };

	if (accessibleIds.length === 0) {
		return {
			user: locals.user,
			accounts: [] as {
				id: string;
				displayName: string;
				bankProfileId: string;
				ibanLast4: string;
				currency: string;
				currentBalance: number;
				status: 'no_data' | 'active';
				isOwner: boolean;
				txCount: number;
				lastUploadedAt: Date | null;
			}[],
			trendPercent: null as number | null,
			balanceData: emptyBalance,
			granularity,
			orphans: [] as OrphanTransfer[]
		};
	}

	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const [rows, recentSums, balanceData, orphans] = await Promise.all([
		db
			.select({
				id: bankAccounts.id,
				displayName: bankAccounts.displayName,
				bankProfileId: bankAccounts.bankProfileId,
				ibanLast4: bankAccounts.ibanLast4,
				currency: bankAccounts.currency,
				currentBalance: bankAccounts.currentBalance,
				status: bankAccounts.status,
				ownerUserId: bankAccounts.ownerUserId,
				txCount: count(transactions.id),
				lastUploadedAt: sql<Date | null>`(SELECT MAX(${csvUploads.uploadedAt}) FROM ${csvUploads} WHERE ${csvUploads.bankAccountId} = ${bankAccounts.id})`
			})
			.from(bankAccounts)
			.leftJoin(
				transactions,
				and(
					eq(transactions.bankAccountId, bankAccounts.id),
					eq(transactions.isOpeningBalance, false)
				)
			)
			.where(and(inArray(bankAccounts.id, accessibleIds), isNull(bankAccounts.deletedAt)))
			.groupBy(bankAccounts.id)
			.orderBy(bankAccounts.createdAt),

		db
			.select({
				bankAccountId: transactions.bankAccountId,
				netChange: sum(transactions.amount)
			})
			.from(transactions)
			.where(
				and(
					inArray(transactions.bankAccountId, accessibleIds),
					gte(transactions.accountingDate, thirtyDaysAgo),
					eq(transactions.isOpeningBalance, false),
					// Only settled transactions affect the real net change — exclude pending/reverted.
					eq(transactions.status, 'posted')
				)
			)
			.groupBy(transactions.bankAccountId),

		queryRollingBalance(accessibleIds, granularity),
		findActionableOrphans(accessibleIds)
	]);

	const netChangeMap = new Map(
		recentSums.map((r) => [r.bankAccountId, parseFloat(r.netChange ?? '0')])
	);

	const accounts = rows.map((r) => ({
		id: r.id,
		displayName: r.displayName,
		bankProfileId: r.bankProfileId,
		ibanLast4: r.ibanLast4,
		currency: r.currency,
		currentBalance: parseFloat(r.currentBalance),
		status: r.status,
		isOwner: r.ownerUserId === locals.user!.id,
		txCount: r.txCount,
		lastUploadedAt: r.lastUploadedAt
	}));

	const totalBalance = accounts.reduce((s, a) => s + a.currentBalance, 0);
	const totalNetChange = accounts.reduce((s, a) => s + (netChangeMap.get(a.id) ?? 0), 0);
	const balanceBefore = totalBalance - totalNetChange;
	const trendPercent =
		balanceBefore !== 0 ? (totalNetChange / Math.abs(balanceBefore)) * 100 : null;

	return {
		user: locals.user,
		accounts,
		trendPercent,
		balanceData,
		granularity,
		orphans
	};
};
