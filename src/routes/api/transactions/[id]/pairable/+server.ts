import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { queryPairableTransactions } from '$lib/server/db/queries.js';

// ─── GET /api/transactions/[id]/pairable?q=… ──────────────────────────────────
// Browse-and-pick backing for manually pairing this transaction with any unlinked
// transaction from a DIFFERENT account. `q` LIKE-matches description or notes.

export const GET: RequestHandler = async ({ params, url, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const q = url.searchParams.get('q') ?? '';
	const result = await queryPairableTransactions(accessibleIds, params.id, q);
	if (!result.source) throw error(404, 'Transaction not found');

	return json(result);
};
