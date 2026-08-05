import { error } from '@sveltejs/kit';
import { and, count, eq, inArray, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, transactions } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { getAllProfiles } from '$lib/server/parsers/index.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);

	const accounts =
		accessibleIds.length === 0
			? []
			: await db
					.select({
						id: bankAccounts.id,
						displayName: bankAccounts.displayName,
						bankProfileId: bankAccounts.bankProfileId,
						currency: bankAccounts.currency,
						txCount: count(transactions.id)
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

	return {
		accounts,
		profiles: getAllProfiles().map((p) => ({
			id: p.bankProfileId,
			displayName: p.displayName
		}))
	};
};
