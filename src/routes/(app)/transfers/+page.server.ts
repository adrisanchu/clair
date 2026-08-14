import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import { queryTransferPairs } from '$lib/server/db/queries.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	const { settled, orphans } = await queryTransferPairs(accessibleIds);

	return { settled, orphans };
};
