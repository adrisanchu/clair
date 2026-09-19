import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, transactions } from '$lib/server/db/schema.js';
import { getFullAccessAccountIds } from '$lib/server/db/access.js';
import { queryTransactions, type TxFilter } from '$lib/server/db/queries.js';
import { refreshCurrentBalance } from '$lib/server/balance.js';
import { detectAndLinkTransfers } from '$lib/server/transfer-detector.js';

// ─── GET /api/transactions ────────────────────────────────────────────────────
// Returns paginated transactions for the authenticated user.
//
// Query params:
//   q         – text search on description
//   accountId – filter by specific bank account ID
//   filter    – 'all' | 'expenses' | 'transfers' | 'review'
//   page      – page number (default 1)

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	// Use full-access IDs only — stats_only accounts are excluded from transaction listing
	const accessibleIds = await getFullAccessAccountIds(locals.user.id);

	const q = url.searchParams.get('q') ?? '';
	const accountId = url.searchParams.get('accountId') ?? '';
	const filter = (url.searchParams.get('filter') ?? 'all') as TxFilter;
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'));

	const result = await queryTransactions({ accessibleIds, q, accountId, filter, page });
	return json(result);
};

// ─── POST /api/transactions ────────────────────────────────────────────────────
// Creates a single manual transaction. Only allowed on 'cash' accounts (issue #68):
// bank accounts are CSV-authored and immutable. Body:
//   { bankAccountId, accountingDate, amount, description,
//     currency?, categoryOverride?, notes?, costGroup? }
// Inserted as syncSource='manual', status='posted'; then the balance is refreshed and
// transfer auto-linking runs (a cash deposit can pair with an ATM withdrawal).

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json();
	const { bankAccountId, accountingDate, amount, description } = body;

	if (typeof bankAccountId !== 'string' || !bankAccountId)
		throw error(400, 'bankAccountId is required');
	if (typeof description !== 'string' || !description.trim())
		throw error(400, 'description is required');
	if (typeof amount !== 'number' || !Number.isFinite(amount))
		throw error(400, 'amount must be a finite number');

	const date = new Date(accountingDate);
	if (Number.isNaN(date.getTime())) throw error(400, 'accountingDate is invalid');

	const accessibleIds = await getFullAccessAccountIds(locals.user.id);
	if (!accessibleIds.includes(bankAccountId)) throw error(403, 'Forbidden');

	const account = await db.query.bankAccounts.findFirst({
		where: eq(bankAccounts.id, bankAccountId),
		columns: { accountType: true, currency: true }
	});
	if (!account) throw error(404, 'Account not found');
	if (account.accountType !== 'cash')
		throw error(403, 'Transactions can only be added to cash accounts');

	const currency =
		typeof body.currency === 'string' && body.currency ? body.currency : account.currency;
	const categoryOverride =
		typeof body.categoryOverride === 'string' && body.categoryOverride.trim()
			? body.categoryOverride.trim()
			: null;
	const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
	const costGroup =
		typeof body.costGroup === 'string' && body.costGroup.trim() ? body.costGroup.trim() : null;

	const [inserted] = await db
		.insert(transactions)
		.values({
			bankAccountId,
			accountingDate: date,
			amount: amount.toFixed(4),
			currency,
			description: description.trim(),
			categoryOverride,
			categoryOverrideById: categoryOverride ? locals.user.id : null,
			costGroup,
			costGroupById: costGroup ? locals.user.id : null,
			notes,
			payerUserId: locals.user.id,
			status: 'posted',
			syncSource: 'manual'
		})
		.returning({ id: transactions.id });

	await refreshCurrentBalance(bankAccountId);
	// Auto-pair with an opposite-sign counterpart (e.g. an ATM withdrawal).
	await detectAndLinkTransfers([inserted.id], accessibleIds, locals.user.id);

	return json({ id: inserted.id }, { status: 201 });
};
