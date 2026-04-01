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

// ─── PATCH /api/accounts/[id] ─────────────────────────────────────────────────
// Rename an account. Owner only.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	await getOwnedAccount(params.id, locals.user.id);

	const { displayName } = await request.json();
	if (!displayName?.trim()) throw error(400, 'displayName is required');

	const [updated] = await db
		.update(bankAccounts)
		.set({ displayName: displayName.trim() })
		.where(eq(bankAccounts.id, params.id))
		.returning({ id: bankAccounts.id, displayName: bankAccounts.displayName });

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
