import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { transactions } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import { refreshCurrentBalance } from '$lib/server/balance.js';
import { unlinkPair } from '$lib/server/transfer-detector.js';

// ─── PATCH /api/transactions/[id] ────────────────────────────────────────────
// Updates user-editable fields on a transaction. Partial: only the fields present
// in the body are touched. Supports for ALL accounts:
//   - categoryOverride (string | null)
//   - costGroup        (string | null — cross-cutting cost bucket label)
//   - notes           (string | null — empty/whitespace is normalised to null)
//   - isTransfer      (boolean — un-flagging a linked transfer clears both legs)
//
// For 'cash' accounts only (issue #68), these bank-authored fields also become editable:
//   - description      (string)
//   - amount           (number)
//   - accountingDate   (ISO date string)
//
// On 'bank' accounts the raw `description`/`amount`/`accountingDate` are immutable:
// `description` is the dedup anchor for CSV re-imports (see #42). Users annotate via `notes`.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const hasCategory = 'categoryOverride' in body;
	const hasCostGroup = 'costGroup' in body;
	const hasNotes = 'notes' in body;
	const hasTransfer = 'isTransfer' in body;
	const hasDescription = 'description' in body;
	const hasAmount = 'amount' in body;
	const hasAccountingDate = 'accountingDate' in body;

	if (
		!hasCategory &&
		!hasCostGroup &&
		!hasNotes &&
		!hasTransfer &&
		!hasDescription &&
		!hasAmount &&
		!hasAccountingDate
	) {
		throw error(400, 'No editable fields provided');
	}
	if (hasCategory && body.categoryOverride !== null && typeof body.categoryOverride !== 'string') {
		throw error(400, 'categoryOverride must be a string or null');
	}
	if (hasCostGroup && body.costGroup !== null && typeof body.costGroup !== 'string') {
		throw error(400, 'costGroup must be a string or null');
	}
	if (hasNotes && body.notes !== null && typeof body.notes !== 'string') {
		throw error(400, 'notes must be a string or null');
	}
	if (hasTransfer && typeof body.isTransfer !== 'boolean') {
		throw error(400, 'isTransfer must be a boolean');
	}
	if (hasDescription && (typeof body.description !== 'string' || !body.description.trim())) {
		throw error(400, 'description must be a non-empty string');
	}
	if (hasAmount && (typeof body.amount !== 'number' || !Number.isFinite(body.amount))) {
		throw error(400, 'amount must be a finite number');
	}
	let parsedDate: Date | null = null;
	if (hasAccountingDate) {
		parsedDate = new Date(body.accountingDate);
		if (Number.isNaN(parsedDate.getTime())) throw error(400, 'accountingDate is invalid');
	}

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const tx = await db.query.transactions.findFirst({
		where: eq(transactions.id, params.id),
		columns: { id: true, bankAccountId: true, transferCounterpartId: true },
		with: { bankAccount: { columns: { accountType: true } } }
	});

	if (!tx) throw error(404, 'Transaction not found');
	if (!accessibleIds.includes(tx.bankAccountId)) throw error(403, 'Forbidden');

	// description/amount/accountingDate are only editable on manual (cash) accounts.
	const editsBankAuthored = hasDescription || hasAmount || hasAccountingDate;
	if (editsBankAuthored && tx.bankAccount?.accountType !== 'cash') {
		throw error(403, 'description, amount and date are only editable on cash accounts');
	}

	// Un-flagging a transfer that is linked to a counterpart must break the pair on
	// both sides; unlinkPair() already sets isTransfer=false + clears the link.
	const unlinking = hasTransfer && body.isTransfer === false && !!tx.transferCounterpartId;

	const set: Partial<typeof transactions.$inferInsert> = { updatedAt: new Date() };
	if (hasCategory) {
		set.categoryOverride = body.categoryOverride ?? null;
		set.categoryOverrideById = body.categoryOverride !== null ? locals.user.id : null;
	}
	if (hasCostGroup) {
		const trimmed = typeof body.costGroup === 'string' ? body.costGroup.trim() : '';
		set.costGroup = trimmed ? trimmed : null;
		set.costGroupById = trimmed ? locals.user.id : null;
	}
	if (hasNotes) {
		const trimmed = typeof body.notes === 'string' ? body.notes.trim() : '';
		set.notes = trimmed ? trimmed : null;
	}
	if (hasDescription) set.description = body.description.trim();
	if (hasAmount) set.amount = body.amount.toFixed(4);
	if (hasAccountingDate && parsedDate) set.accountingDate = parsedDate;
	// When unlinking, isTransfer is handled by unlinkPair() below.
	if (hasTransfer && !unlinking) {
		set.isTransfer = body.isTransfer;
	}

	await db.update(transactions).set(set).where(eq(transactions.id, params.id));
	if (unlinking) await unlinkPair(params.id);
	// Amount changes on a cash row move the derived balance.
	if (hasAmount) await refreshCurrentBalance(tx.bankAccountId);

	return json({ ok: true });
};

// ─── DELETE /api/transactions/[id] ────────────────────────────────────────────
// Permanently deletes a transaction. Only allowed on 'cash' accounts (issue #68).
// If the row is transfer-linked, the counterpart is unlinked first (not deleted),
// then the balance is refreshed.

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const tx = await db.query.transactions.findFirst({
		where: eq(transactions.id, params.id),
		columns: { id: true, bankAccountId: true, transferCounterpartId: true },
		with: { bankAccount: { columns: { accountType: true } } }
	});

	if (!tx) throw error(404, 'Transaction not found');
	if (!accessibleIds.includes(tx.bankAccountId)) throw error(403, 'Forbidden');
	if (tx.bankAccount?.accountType !== 'cash')
		throw error(403, 'Only cash-account transactions can be deleted');

	// Break the pair on both sides before removing the row so the counterpart
	// isn't left pointing at a deleted transaction.
	if (tx.transferCounterpartId) await unlinkPair(params.id);

	await db.delete(transactions).where(eq(transactions.id, params.id));
	await refreshCurrentBalance(tx.bankAccountId);

	return json({ ok: true });
};
