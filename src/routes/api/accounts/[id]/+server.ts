import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts } from '$lib/server/db/schema.js';

async function getOwnedAccount(accountId: string, userId: string) {
	const account = await db.query.bankAccounts.findFirst({
		where: and(
			eq(bankAccounts.id, accountId),
			eq(bankAccounts.ownerUserId, userId),
			isNull(bankAccounts.deletedAt)
		)
	});
	if (!account) throw error(404, 'Account not found');
	return account;
}

const VALID_VISIBILITY = new Set(['private', 'stats_only', 'full']);

// ─── PATCH /api/accounts/[id] ─────────────────────────────────────────────────
// Update display name and/or visibility. Owner only.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	await getOwnedAccount(params.id, locals.user.id);

	const body = await request.json();
	const { displayName, visibility } = body;

	if (!displayName && !visibility) throw error(400, 'Nothing to update');
	if (displayName !== undefined && !displayName?.trim())
		throw error(400, 'displayName cannot be empty');
	if (visibility !== undefined && !VALID_VISIBILITY.has(visibility))
		throw error(400, 'visibility must be private | stats_only | full');

	const patch: Record<string, unknown> = {};
	if (displayName) patch.displayName = displayName.trim();
	if (visibility) patch.visibility = visibility;

	const [updated] = await db
		.update(bankAccounts)
		.set(patch)
		.where(eq(bankAccounts.id, params.id))
		.returning({
			id: bankAccounts.id,
			displayName: bankAccounts.displayName,
			visibility: bankAccounts.visibility
		});

	return json(updated);
};

// ─── DELETE /api/accounts/[id] ────────────────────────────────────────────────
// Soft-delete an account. Owner only.

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	await getOwnedAccount(params.id, locals.user.id);

	await db
		.update(bankAccounts)
		.set({ deletedAt: new Date() })
		.where(eq(bankAccounts.id, params.id));

	return new Response(null, { status: 204 });
};
