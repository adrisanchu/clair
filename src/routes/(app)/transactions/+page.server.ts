import { error } from '@sveltejs/kit'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { PageServerLoad } from './$types'
import { db } from '$lib/server/db/index.js'
import { bankAccounts } from '$lib/server/db/schema.js'
import { getAccessibleAccountIds } from '$lib/server/db/access.js'
import { queryTransactions, type TxFilter } from '$lib/server/db/queries.js'

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) error(401)

	const accessibleIds = await getAccessibleAccountIds(locals.user.id)

	const q = url.searchParams.get('q') ?? ''
	const accountId = url.searchParams.get('accountId') ?? ''
	const filter = (url.searchParams.get('filter') ?? 'all') as TxFilter
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))

	const [result, accounts] = await Promise.all([
		queryTransactions({ accessibleIds, q, accountId, filter, page }),
		accessibleIds.length > 0
			? db
					.select({ id: bankAccounts.id, displayName: bankAccounts.displayName })
					.from(bankAccounts)
					.where(
						and(inArray(bankAccounts.id, accessibleIds), isNull(bankAccounts.deletedAt))
					)
					.orderBy(bankAccounts.displayName)
			: Promise.resolve([])
	])

	return {
		...result,
		accounts,
		filters: { q, accountId, filter }
	}
}
