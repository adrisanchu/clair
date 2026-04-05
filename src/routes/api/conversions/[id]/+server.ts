import { error, json } from '@sveltejs/kit';
import { and, eq, or } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { authUser, bankAccounts, currencyConversions } from '$lib/server/db/schema.js';
import { propagateRateToAccount } from '$lib/server/currency-converter.js';

// ─── PATCH /api/conversions/[id] ────────────────────────────────────────────
// Confirm an auto-detected conversion or update its exchange rate.
// Body: { action: 'confirm' } | { action: 'update', exchangeRate: number }

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const user = await db.query.authUser.findFirst({
		where: eq(authUser.id, locals.user.id),
		columns: { workspaceId: true }
	});
	if (!user?.workspaceId) throw error(403, 'No workspace');

	const conversion = await db.query.currencyConversions.findFirst({
		where: and(
			eq(currencyConversions.id, params.id),
			eq(currencyConversions.workspaceId, user.workspaceId)
		)
	});
	if (!conversion) throw error(404, 'Conversion not found');

	// Verify the user owns at least one of the two linked accounts
	const ownedAccount = await db.query.bankAccounts.findFirst({
		where: and(
			or(
				eq(bankAccounts.id, conversion.fromAccountId),
				eq(bankAccounts.id, conversion.toAccountId)
			),
			eq(bankAccounts.ownerUserId, locals.user.id)
		),
		columns: { id: true }
	});
	if (!ownedAccount) throw error(403, 'Forbidden');

	const body = await request.json();

	if (body.action === 'confirm') {
		await db
			.update(currencyConversions)
			.set({ confidence: 'confirmed' })
			.where(eq(currencyConversions.id, params.id));

		return json({ ok: true });
	}

	if (body.action === 'update') {
		const newRate = parseFloat(body.exchangeRate);
		if (isNaN(newRate) || newRate <= 0) throw error(400, 'Invalid exchange rate');

		await db
			.update(currencyConversions)
			.set({
				exchangeRate: newRate.toFixed(6),
				confidence: 'confirmed'
			})
			.where(eq(currencyConversions.id, params.id));

		// Re-propagate with the corrected rate
		await propagateRateToAccount(conversion.toAccountId);

		return json({ ok: true });
	}

	throw error(400, 'Invalid action');
};
