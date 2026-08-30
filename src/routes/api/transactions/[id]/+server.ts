import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { transactions } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import { unlinkPair } from '$lib/server/transfer-detector.js';

// ─── PATCH /api/transactions/[id] ────────────────────────────────────────────
// Updates user-editable fields on a transaction. Partial: only the fields present
// in the body are touched. Supports:
//   - categoryOverride (string | null)
//   - notes           (string | null — empty/whitespace is normalised to null)
//   - isTransfer      (boolean — un-flagging a linked transfer clears both legs)
//
// The raw bank `description` is intentionally NOT editable: it is the dedup anchor
// for CSV re-imports (see #42). Users annotate via `notes` instead.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const hasCategory = 'categoryOverride' in body;
	const hasNotes = 'notes' in body;
	const hasTransfer = 'isTransfer' in body;

	if (!hasCategory && !hasNotes && !hasTransfer) {
		throw error(400, 'No editable fields provided');
	}
	if (hasCategory && body.categoryOverride !== null && typeof body.categoryOverride !== 'string') {
		throw error(400, 'categoryOverride must be a string or null');
	}
	if (hasNotes && body.notes !== null && typeof body.notes !== 'string') {
		throw error(400, 'notes must be a string or null');
	}
	if (hasTransfer && typeof body.isTransfer !== 'boolean') {
		throw error(400, 'isTransfer must be a boolean');
	}

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const tx = await db.query.transactions.findFirst({
		where: eq(transactions.id, params.id),
		columns: { id: true, bankAccountId: true, transferCounterpartId: true }
	});

	if (!tx) throw error(404, 'Transaction not found');
	if (!accessibleIds.includes(tx.bankAccountId)) throw error(403, 'Forbidden');

	// Un-flagging a transfer that is linked to a counterpart must break the pair on
	// both sides; unlinkPair() already sets isTransfer=false + clears the link.
	const unlinking = hasTransfer && body.isTransfer === false && !!tx.transferCounterpartId;

	const set: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
	if (hasCategory) {
		set.categoryOverride = body.categoryOverride ?? null;
		set.categoryOverrideById = body.categoryOverride !== null ? locals.user.id : null;
	}
	if (hasNotes) {
		const trimmed = typeof body.notes === 'string' ? body.notes.trim() : '';
		set.notes = trimmed ? trimmed : null;
	}
	// When unlinking, isTransfer is handled by unlinkPair() below.
	if (hasTransfer && !unlinking) {
		set.isTransfer = body.isTransfer;
	}

	await db.update(transactions).set(set).where(eq(transactions.id, params.id));
	if (unlinking) await unlinkPair(params.id);

	return json({ ok: true });
};
