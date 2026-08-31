import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, categories, costGroups } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import {
	queryTransactions,
	type TxFilter,
	type UploadOutcomeFilter
} from '$lib/server/db/queries.js';

const UPLOAD_OUTCOMES: UploadOutcomeFilter[] = ['inserted', 'updated', 'duplicate'];

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);

	const q = url.searchParams.get('q') ?? '';
	const accountId = url.searchParams.get('accountId') ?? '';
	const filter = (url.searchParams.get('filter') ?? 'all') as TxFilter;
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));

	const uploadId = url.searchParams.get('upload') ?? undefined;
	const outcomeParam = url.searchParams.get('outcome');
	const uploadOutcome =
		uploadId && outcomeParam && UPLOAD_OUTCOMES.includes(outcomeParam as UploadOutcomeFilter)
			? (outcomeParam as UploadOutcomeFilter)
			: undefined;

	const [result, accounts, cats, groups] = await Promise.all([
		queryTransactions({ accessibleIds, q, accountId, filter, page, uploadId, uploadOutcome }),
		accessibleIds.length > 0
			? db
					.select({ id: bankAccounts.id, displayName: bankAccounts.displayName })
					.from(bankAccounts)
					.where(and(inArray(bankAccounts.id, accessibleIds), isNull(bankAccounts.deletedAt)))
					.orderBy(bankAccounts.displayName)
			: Promise.resolve([]),
		locals.user.workspaceId
			? db
					.select()
					.from(categories)
					.where(eq(categories.workspaceId, locals.user.workspaceId))
					.orderBy(
						sql`COALESCE(${categories.parentId}, ${categories.id})`,
						asc(categories.sortOrder),
						asc(categories.name)
					)
			: Promise.resolve([]),
		locals.user.workspaceId
			? db
					.select()
					.from(costGroups)
					.where(eq(costGroups.workspaceId, locals.user.workspaceId))
					.orderBy(asc(costGroups.sortOrder), asc(costGroups.name))
			: Promise.resolve([])
	]);

	return {
		...result,
		accounts,
		categories: cats,
		costGroups: groups,
		filters: { q, accountId, filter, uploadId: uploadId ?? null, uploadOutcome: uploadOutcome ?? null }
	};
};
