import { error, json } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { transactions } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { linkPair, unlinkPair } from '$lib/server/transfer-detector.js';

// ─── POST /api/transactions/[id]/link-transfer ────────────────────────────────
// Manually link two transactions as a transfer pair.

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const counterpartId = body?.counterpartId;
	if (!counterpartId || typeof counterpartId !== 'string') {
		throw error(400, 'counterpartId is required');
	}

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const [source, counterpart] = await Promise.all([
		db.query.transactions.findFirst({
			where: eq(transactions.id, params.id),
			columns: { id: true, bankAccountId: true, transferCounterpartId: true }
		}),
		db.query.transactions.findFirst({
			where: eq(transactions.id, counterpartId),
			columns: { id: true, bankAccountId: true, transferCounterpartId: true }
		})
	]);

	if (!source || !counterpart) throw error(404, 'Transaction not found');

	// Both transactions must be in accounts the user can access
	const ids = [source.bankAccountId, counterpart.bankAccountId];
	if (!ids.every((id) => accessibleIds.includes(id))) throw error(403, 'Forbidden');

	if (source.transferCounterpartId || counterpart.transferCounterpartId) {
		throw error(409, 'One or both transactions are already linked');
	}

	await linkPair(params.id, counterpartId, locals.user.id);

	return json({ ok: true });
};

// ─── DELETE /api/transactions/[id]/link-transfer ──────────────────────────────
// Break a same-currency transfer pair (bidirectional).

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const source = await db.query.transactions.findFirst({
		where: eq(transactions.id, params.id),
		columns: { id: true, bankAccountId: true, transferCounterpartId: true }
	});
	if (!source) throw error(404, 'Transaction not found');
	if (!accessibleIds.includes(source.bankAccountId)) throw error(403, 'Forbidden');
	if (!source.transferCounterpartId) throw error(409, 'Transaction is not linked');

	await unlinkPair(params.id);

	return json({ ok: true });
};
