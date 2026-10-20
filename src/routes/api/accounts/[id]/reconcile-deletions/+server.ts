import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { transactions } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import { refreshAccountDerived } from '$lib/server/balance.js';
import { unlinkPair } from '$lib/server/transfer-detector.js';
import { unlinkConversionLegs } from '$lib/server/currency-converter.js';

// ─── POST /api/accounts/[id]/reconcile-deletions ──────────────────────────────
// Remove transactions the user confirmed are gone from the bank (detected during the
// upload preview as in-window rows the file no longer contains). Transfer/conversion legs
// are unlinked from their counterpart before deletion so nothing is left dangling.
//
// This is the sanctioned deletion path for bank-account rows — unlike DELETE
// /api/transactions/[id], which is restricted to cash accounts.

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	if (!accessibleIds.includes(params.id)) throw error(403, 'Access denied to this account');

	const body = await request.json().catch(() => null);
	const deleteIds: unknown = body?.deleteIds;
	if (!Array.isArray(deleteIds) || deleteIds.some((id) => typeof id !== 'string')) {
		throw error(400, 'deleteIds must be an array of transaction ids');
	}
	if (deleteIds.length === 0) return json({ ok: true, deleted: 0 });

	// Only touch rows that actually belong to this account — ignore anything else.
	const rows = await db.query.transactions.findMany({
		where: and(
			eq(transactions.bankAccountId, params.id),
			inArray(transactions.id, deleteIds as string[])
		),
		columns: { id: true, transferCounterpartId: true, conversionCounterpartId: true }
	});
	if (rows.length === 0) return json({ ok: true, deleted: 0 });

	// Break links on both sides first so the surviving counterpart isn't left pointing at a
	// deleted row. unlinkPair reads/clears both transfer legs; unlinkConversionLegs clears
	// the conversion self-link on the ids passed (the deleted leg included — harmless).
	for (const row of rows) {
		if (row.transferCounterpartId) await unlinkPair(row.id);
		if (row.conversionCounterpartId)
			await unlinkConversionLegs([row.id, row.conversionCounterpartId]);
	}

	await db.delete(transactions).where(
		inArray(
			transactions.id,
			rows.map((r) => r.id)
		)
	);

	await refreshAccountDerived(params.id);

	return json({ ok: true, deleted: rows.length });
};
