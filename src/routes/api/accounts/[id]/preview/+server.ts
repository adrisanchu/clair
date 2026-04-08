import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, csvColumnMappings } from '$lib/server/db/schema.js';
import { uploadAndParse, detectFileDirection } from '$lib/server/parsers/index.js';

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

	let result: Awaited<ReturnType<typeof uploadAndParse>>['result'];

	try {
		({ result } = await uploadAndParse(file, account.bankProfileId));
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not parse file');
	}

	const { rows, skippedCount } = result;

	const preview = rows.slice(0, 5).map((r) => ({
		date: r.accountingDate.toISOString().split('T')[0],
		description: r.description,
		amount: r.amount,
		currency: r.currency
	}));

	// Derive balance metrics from the running balance column (if the profile provides one).
	// Use file direction (first vs last date) to identify the chronologically first/last row
	// without relying on within-day ordering, which date sorting cannot resolve.
	let openingBalance: number | null = null;
	let closingBalance: number | null = null;
	if (rows.length > 0) {
		const direction = detectFileDirection(rows);
		const firstRow = direction === 'desc' ? rows[rows.length - 1] : rows[0];
		const lastRow = direction === 'desc' ? rows[0] : rows[rows.length - 1];
		if (firstRow.runningBalance !== null) {
			openingBalance = firstRow.runningBalance - firstRow.amount;
		}
		if (lastRow.runningBalance !== null) {
			closingBalance = lastRow.runningBalance;
		}
	}

	const savedMappings = await db.query.csvColumnMappings.findMany({
		where: eq(csvColumnMappings.workspaceId, account.workspaceId)
	});

	return json({
		filename: file.name,
		profile: account.bankProfileId,
		totalParsed: rows.length,
		skippedCount,
		preview,
		openingBalance,
		closingBalance,
		columnMappings: result.columnMappings,
		unusedColumns: result.unusedColumns,
		savedMappings: savedMappings.map((m) => ({
			field: m.columnKey,
			csvHeader: m.columnLabel,
			enabled: m.enabled
		}))
	});
};
