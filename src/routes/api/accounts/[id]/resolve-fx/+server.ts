import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, currencyConversions, transactions } from '$lib/server/db/schema.js';
import { propagateRateToAccount } from '$lib/server/currency-converter.js';

// ─── POST /api/accounts/[id]/resolve-fx ───────────────────────────────────────
// Manually assign an exchange rate to unresolved transactions on a non-EUR account.
// Body: { exchangeRate: number, effectiveFrom?: string (ISO date) }

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const account = await db.query.bankAccounts.findFirst({
		where: and(eq(bankAccounts.id, params.id), isNull(bankAccounts.deletedAt)),
		columns: { id: true, workspaceId: true, currency: true, ownerUserId: true }
	});
	if (!account) throw error(404, 'Account not found');
	if (account.ownerUserId !== locals.user.id) throw error(403, 'Forbidden');
	if (account.currency === 'EUR') throw error(400, 'Account is already EUR-denominated');

	const body = await request.json();
	const exchangeRate = parseFloat(body.exchangeRate);
	if (isNaN(exchangeRate) || exchangeRate <= 0) throw error(400, 'Invalid exchange rate');

	// Determine effectiveFrom: use the earliest unresolved transaction date
	// (or the date provided in the request body).
	let effectiveFrom: Date;
	if (body.effectiveFrom) {
		effectiveFrom = new Date(body.effectiveFrom);
	} else {
		const earliest = await db.query.transactions.findFirst({
			where: and(
				eq(transactions.bankAccountId, params.id),
				isNull(transactions.conversionId),
				eq(transactions.isOpeningBalance, false)
			),
			columns: { accountingDate: true },
			orderBy: (t, { asc }) => asc(t.accountingDate)
		});
		if (!earliest) throw error(404, 'No unresolved transactions found');
		effectiveFrom = earliest.accountingDate as unknown as Date;
	}

	// Find a EUR account in this workspace to use as the nominal source
	const eurAccount = await db.query.bankAccounts.findFirst({
		where: and(
			eq(bankAccounts.workspaceId, account.workspaceId),
			eq(bankAccounts.currency, 'EUR'),
			isNull(bankAccounts.deletedAt)
		),
		columns: { id: true }
	});
	const fromAccountId = eurAccount?.id ?? params.id;

	// Create a manual conversion record (no specific counterpart transactions)
	await db.insert(currencyConversions).values({
		workspaceId: account.workspaceId,
		fromAccountId,
		toAccountId: params.id,
		fromAmount: '0.0000',
		toAmount: '0.0000',
		exchangeRate: exchangeRate.toFixed(6),
		effectiveFrom,
		confidence: 'manual',
		fromTransactionId: null,
		toTransactionId: null
	});

	const affectedCount = await propagateRateToAccount(params.id);

	return json({ ok: true, affectedCount });
};
