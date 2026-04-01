import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, csvUploads, transactions } from '$lib/server/db/schema.js';
import { getProfile, parseCSV, fileToText } from '$lib/server/parsers/index.js';
import { classifyRow, applyStatusUpdate, applyDescUpdate } from '$lib/server/dedup.js';
import {
	computeOpeningBalance,
	upsertOpeningBalance,
	refreshCurrentBalance
} from '$lib/server/balance.js';
import type { NormalizedTransaction } from '$lib/server/parsers/types.js';

// ─── POST /api/accounts/[id]/import ───────────────────────────────────────────
// Parse a CSV, dedup against existing transactions, and persist to DB.

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

	const currentBalanceRaw = formData.get('currentBalance') as string | null;
	const currentBalance = currentBalanceRaw ? parseFloat(currentBalanceRaw.replace(',', '.')) : null;

	const profile = getProfile(account.bankProfileId);
	if (!profile) throw error(400, `No parser for bank profile: ${account.bankProfileId}`);

	let csvText: string;
	try {
		csvText = await fileToText(file);
	} catch {
		throw error(400, 'Could not read file');
	}

	const { rows, skippedCount } = parseCSV(csvText, profile);

	// Create the upload record first (transactions reference it)
	const [upload] = await db
		.insert(csvUploads)
		.values({
			bankAccountId: account.id,
			userId: locals.user.id,
			filename: file.name,
			bankProfileId: profile.bankProfileId,
			rowCount: rows.length + skippedCount,
			importedCount: 0,
			duplicateCount: 0,
			flaggedCount: 0,
			statusUpdates: 0
		})
		.returning({ id: csvUploads.id });

	let importedCount = 0;
	let duplicateCount = 0;
	let statusUpdatesCount = 0;
	let flaggedCount = 0;

	const toInsert: (typeof transactions.$inferInsert)[] = [];

	for (const row of rows) {
		const dedup = await classifyRow(row, account.id);

		if (dedup.action === 'insert') {
			toInsert.push(buildTxInsert(row, account.id, upload.id, locals.user.id, row.status));
			importedCount++;
		} else if (dedup.action === 'review') {
			toInsert.push(buildTxInsert(row, account.id, upload.id, locals.user.id, 'review'));
			flaggedCount++;
		} else if (dedup.action === 'update_status' && dedup.existingId) {
			await applyStatusUpdate(dedup.existingId, row);
			statusUpdatesCount++;
		} else if (dedup.action === 'update_desc' && dedup.existingId) {
			await applyDescUpdate(dedup.existingId, row);
			statusUpdatesCount++;
		} else {
			duplicateCount++;
		}
	}

	if (toInsert.length > 0) {
		await db.insert(transactions).values(toInsert);
	}

	// Update upload with actual counts
	await db
		.update(csvUploads)
		.set({
			importedCount: importedCount + flaggedCount,
			duplicateCount,
			flaggedCount,
			statusUpdates: statusUpdatesCount
		})
		.where(eq(csvUploads.id, upload.id));

	// Handle balance reconciliation if a current balance was provided
	if (currentBalance !== null && !isNaN(currentBalance) && rows.length > 0) {
		const earliest = rows.reduce((a, b) => (a.accountingDate <= b.accountingDate ? a : b));
		const openingAmt = await computeOpeningBalance(account.id, currentBalance, rows);
		await upsertOpeningBalance(account.id, openingAmt, earliest.accountingDate, locals.user.id);
	}

	// Mark account as active and refresh balance
	await db.update(bankAccounts).set({ status: 'active' }).where(eq(bankAccounts.id, account.id));

	await refreshCurrentBalance(account.id);

	return json({
		imported: importedCount,
		flagged: flaggedCount,
		statusUpdates: statusUpdatesCount,
		duplicates: duplicateCount
	});
};

function buildTxInsert(
	row: NormalizedTransaction,
	bankAccountId: string,
	csvUploadId: string,
	payerUserId: string,
	status: 'pending' | 'posted' | 'review'
): typeof transactions.$inferInsert {
	return {
		bankAccountId,
		csvUploadId,
		accountingDate: row.accountingDate,
		valueDate: row.valueDate,
		amount: row.amount.toFixed(4),
		currency: row.currency,
		amountOriginal: row.amountOriginal.toFixed(4),
		currencyOriginal: row.currencyOriginal,
		description: row.description,
		status,
		payerUserId,
		syncSource: 'csv_upload'
	};
}
