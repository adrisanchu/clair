import { error } from '@sveltejs/kit';
import { and, inArray, isNull } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);

	const accounts =
		accessibleIds.length > 0
			? await db
					.select({ id: bankAccounts.id, displayName: bankAccounts.displayName })
					.from(bankAccounts)
					.where(and(inArray(bankAccounts.id, accessibleIds), isNull(bankAccounts.deletedAt)))
					.orderBy(bankAccounts.displayName)
			: [];

	return { accounts };
};
