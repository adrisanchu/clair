import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { queryTransactions, type TxFilter } from '$lib/server/db/queries.js';

// ─── GET /api/transactions ────────────────────────────────────────────────────
// Returns paginated transactions for the authenticated user.
//
// Query params:
//   q         – text search on description
//   accountId – filter by specific bank account ID
//   filter    – 'all' | 'expenses' | 'transfers' | 'review'
//   page      – page number (default 1)

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);

	const q = url.searchParams.get('q') ?? '';
	const accountId = url.searchParams.get('accountId') ?? '';
	const filter = (url.searchParams.get('filter') ?? 'all') as TxFilter;
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));

	const result = await queryTransactions({ accessibleIds, q, accountId, filter, page });
	return json(result);
};
