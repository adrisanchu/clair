import { error } from '@sveltejs/kit'
import { and, count, eq, inArray, isNull, max } from 'drizzle-orm'
import type { PageServerLoad } from './$types'
import { db } from '$lib/server/db/index.js'
import { bankAccounts, csvUploads, transactions } from '$lib/server/db/schema.js'
import { getAccessibleAccountIds } from '$lib/server/db/access.js'
import { getAllProfiles } from '$lib/server/parsers/index.js'

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401)

	const accessibleIds = await getAccessibleAccountIds(locals.user.id)

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
						ownerUserId: bankAccounts.ownerUserId,
						createdAt: bankAccounts.createdAt,
						txCount: count(transactions.id),
						lastUploadedAt: max(csvUploads.uploadedAt)
					})
					.from(bankAccounts)
					.leftJoin(
						transactions,
						and(
							eq(transactions.bankAccountId, bankAccounts.id),
							eq(transactions.isOpeningBalance, false)
						)
					)
					.leftJoin(csvUploads, eq(csvUploads.bankAccountId, bankAccounts.id))
					.where(and(inArray(bankAccounts.id, accessibleIds), isNull(bankAccounts.deletedAt)))
					.groupBy(bankAccounts.id)
					.orderBy(bankAccounts.createdAt)

	return {
		accounts: accounts.map((a) => ({
			...a,
			currentBalance: parseFloat(a.currentBalance),
			isOwner: a.ownerUserId === locals.user!.id
		})),
		profiles: getAllProfiles().map((p) => ({
			id: p.bankProfileId,
			displayName: p.displayName
		}))
	}
}
