import { error } from '@sveltejs/kit';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { authUser, bankAccounts, csvUploads, transactions } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { getAllProfiles } from '$lib/server/parsers/index.js';
import { getUnresolvedFxAccounts } from '$lib/server/currency-converter.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401);

	const user = await db.query.authUser.findFirst({
		where: eq(authUser.id, locals.user.id),
		columns: { workspaceId: true }
	});

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);

	const accounts =
		accessibleIds.length === 0
			? []
			: await db
					.select({
						id: bankAccounts.id,
						displayName: bankAccounts.displayName,
						institutionName: bankAccounts.institutionName,
						bankProfileId: bankAccounts.bankProfileId,
						ibanLast4: bankAccounts.ibanLast4,
						currency: bankAccounts.currency,
						currentBalance: bankAccounts.currentBalance,
						status: bankAccounts.status,
						visibility: bankAccounts.visibility,
						ownerUserId: bankAccounts.ownerUserId,
						createdAt: bankAccounts.createdAt,
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
					.orderBy(bankAccounts.createdAt);

	const unresolvedFx = user?.workspaceId
		? await getUnresolvedFxAccounts(user.workspaceId)
		: [];

	return {
		accounts: accounts.map((a) => ({
			...a,
			currentBalance: parseFloat(a.currentBalance),
			isOwner: a.ownerUserId === locals.user!.id
		})),
		profiles: getAllProfiles().map((p) => ({
			id: p.bankProfileId,
			displayName: p.displayName
		})),
		unresolvedFx
	};
};
