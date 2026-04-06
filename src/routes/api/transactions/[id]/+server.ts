import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { transactions } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';

// ─── PATCH /api/transactions/[id] ────────────────────────────────────────────
// Updates user-editable fields on a transaction.
// Currently supports: categoryOverride (string | null)

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { categoryOverride } = body;

	if (categoryOverride !== null && typeof categoryOverride !== 'string') {
		throw error(400, 'categoryOverride must be a string or null');
	}

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const tx = await db.query.transactions.findFirst({
		where: eq(transactions.id, params.id),
		columns: { id: true, bankAccountId: true }
	});

	if (!tx) throw error(404, 'Transaction not found');
	if (!accessibleIds.includes(tx.bankAccountId)) throw error(403, 'Forbidden');

	await db
		.update(transactions)
		.set({
			categoryOverride: categoryOverride ?? null,
			categoryOverrideById: categoryOverride !== null ? locals.user.id : null,
			updatedAt: new Date()
		})
		.where(eq(transactions.id, params.id));

	return json({ ok: true });
};
