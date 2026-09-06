import { error, json } from '@sveltejs/kit';
import { and, eq, inArray, or } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, currencyConversions, transactions } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { linkConversionLegs, propagateRateToAccount } from '$lib/server/currency-converter.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

// ─── POST /api/conversions ────────────────────────────────────────────────────
// Manually link two transactions as a cross-currency conversion.
// Body: { transactionId, counterpartId }. Derives the rate from the actual pair.

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { transactionId, counterpartId } = body ?? {};
	if (typeof transactionId !== 'string' || typeof counterpartId !== 'string') {
		throw error(400, 'transactionId and counterpartId are required');
	}
	if (transactionId === counterpartId) throw error(400, 'A transaction cannot convert to itself');

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (accessibleIds.length === 0) throw error(403, 'Forbidden');

	const rows = await db
		.select({
			id: transactions.id,
			amount: transactions.amount,
			accountingDate: transactions.accountingDate,
			bankAccountId: transactions.bankAccountId,
			description: transactions.description,
			accountCurrency: bankAccounts.currency,
			workspaceId: bankAccounts.workspaceId
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(inArray(transactions.id, [transactionId, counterpartId]));

	const a = rows.find((r) => r.id === transactionId);
	const b = rows.find((r) => r.id === counterpartId);
	if (!a || !b) throw error(404, 'Transaction not found');
	if (![a, b].every((r) => accessibleIds.includes(r.bankAccountId))) throw error(403, 'Forbidden');

	// A conversion moves money BETWEEN accounts. Two rows in the same account are not a
	// conversion — that's a cost group (e.g. an expense partly reimbursed into the same card).
	if (a.bankAccountId === b.bankAccountId) {
		throw error(
			400,
			'Both transactions are in the same account — link them as a cost group, not a conversion'
		);
	}

	// Must be one EUR leg and one foreign leg (same-currency pairs use link-transfer).
	const eur = [a, b].find((r) => r.accountCurrency === PRIMARY_CURRENCY);
	const foreign = [a, b].find((r) => r.accountCurrency !== PRIMARY_CURRENCY);
	if (!eur || !foreign) {
		throw error(400, 'A conversion needs one EUR leg and one foreign-currency leg');
	}

	// Neither leg may already belong to a conversion.
	const existing = await db
		.select({ id: currencyConversions.id })
		.from(currencyConversions)
		.where(
			or(
				inArray(currencyConversions.fromTransactionId, [a.id, b.id]),
				inArray(currencyConversions.toTransactionId, [a.id, b.id])
			)
		);
	if (existing.length > 0) throw error(409, 'One or both transactions are already in a conversion');

	const eurAmount = Math.abs(parseFloat(eur.amount as unknown as string));
	const foreignAmount = Math.abs(parseFloat(foreign.amount as unknown as string));
	if (eurAmount === 0) throw error(400, 'EUR leg amount is zero');
	const rate = foreignAmount / eurAmount;

	const [conversion] = await db
		.insert(currencyConversions)
		.values({
			workspaceId: foreign.workspaceId,
			fromAccountId: eur.bankAccountId,
			toAccountId: foreign.bankAccountId,
			fromAmount: eurAmount.toFixed(4),
			toAmount: foreignAmount.toFixed(4),
			exchangeRate: rate.toFixed(6),
			effectiveFrom: foreign.accountingDate as unknown as Date,
			confidence: 'manual',
			fromTransactionId: eur.id,
			toTransactionId: foreign.id
		})
		.returning({ id: currencyConversions.id });

	await linkConversionLegs(eur.id, foreign.id);
	const affectedCount = await propagateRateToAccount(foreign.bankAccountId);

	return json({ ok: true, conversionId: conversion.id, exchangeRate: rate, affectedCount });
};
