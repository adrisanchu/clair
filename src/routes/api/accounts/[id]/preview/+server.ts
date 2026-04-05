import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts } from '$lib/server/db/schema.js';
import { uploadAndParse } from '$lib/server/parsers/index.js';

// ─── POST /api/accounts/[id]/preview ──────────────────────────────────────────
// Parse a CSV for the given bank account and return a preview — no DB writes.

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const account = await db.query.bankAccounts.findFirst({
		where: and(eq(bankAccounts.id, params.id), isNull(bankAccounts.deletedAt))
	});
	if (!account) throw error(404, 'Account not found');
	if (account.ownerUserId !== locals.user.id) throw error(403, 'Forbidden');

	const formData = await request.formData();
	const file = formData.get('file') as File | null;
	if (!file) throw error(400, 'No file provided');

	let rows: Awaited<ReturnType<typeof uploadAndParse>>['result']['rows'];
	let skippedCount: number;

	try {
		({ result: { rows, skippedCount } } = await uploadAndParse(file, account.bankProfileId));
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not parse file');
	}

	const preview = rows.slice(0, 5).map((r) => ({
		date: r.accountingDate.toISOString().split('T')[0],
		description: r.description,
		amount: r.amount,
		currency: r.currency
	}));

	// Derive balance metrics from the running balance column (if the profile provides one)
	let openingBalance: number | null = null;
	let closingBalance: number | null = null;
	if (rows.length > 0) {
		const earliest = rows.reduce((a, b) => (a.accountingDate <= b.accountingDate ? a : b));
		const latest = rows.reduce((a, b) => (a.accountingDate >= b.accountingDate ? a : b));
		if (earliest.runningBalance !== null) {
			openingBalance = earliest.runningBalance - earliest.amount;
		}
		if (latest.runningBalance !== null) {
			closingBalance = latest.runningBalance;
		}
	}

	return json({
		filename: file.name,
		profile: account.bankProfileId,
		totalParsed: rows.length,
		skippedCount,
		preview,
		openingBalance,
		closingBalance
	});
};
