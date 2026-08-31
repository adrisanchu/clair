import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { queryTransferCandidates } from '$lib/server/db/queries.js';

// ─── GET /api/transactions/[id]/transfer-candidates ───────────────────────────
// Candidate counterparts for manually linking this transaction (transfer or FX).

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const result = await queryTransferCandidates(accessibleIds, params.id);
	if (!result.source) throw error(404, 'Transaction not found');

	return json(result);
};
