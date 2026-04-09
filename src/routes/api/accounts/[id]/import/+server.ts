import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, categories, csvColumnMappings, csvUploads, transactions } from '$lib/server/db/schema.js';
import { uploadAndParse, detectFileDirection, type ColumnOverrides } from '$lib/server/parsers/index.js';
import { classifyRow, applyStatusUpdate, applyDescUpdate } from '$lib/server/dedup.js';
import { upsertOpeningBalance, refreshCurrentBalance } from '$lib/server/balance.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { detectAndLinkTransfers } from '$lib/server/transfer-detector.js';
import { detectAndCreateConversions } from '$lib/server/currency-converter.js';
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

	const openingBalanceRaw = formData.get('openingBalance') as string | null;
	const openingBalance = openingBalanceRaw ? parseFloat(openingBalanceRaw.replace(',', '.')) : null;

	const columnMappingsRaw = formData.get('columnMappings') as string | null;
	const columnOverrides: ColumnOverrides = columnMappingsRaw ? JSON.parse(columnMappingsRaw) : null;

	let rows: Awaited<ReturnType<typeof uploadAndParse>>['result']['rows'];
	let skippedCount: number;

	try {
		({
			result: { rows, skippedCount }
		} = await uploadAndParse(file, account.bankProfileId, columnOverrides));
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Could not parse file');
	}

	// Create the upload record first (transactions reference it)
	const [upload] = await db
		.insert(csvUploads)
		.values({
			bankAccountId: account.id,
			userId: locals.user.id,
			filename: file.name,
			bankProfileId: account.bankProfileId,
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

	const insertedIds: string[] = [];
	if (toInsert.length > 0) {
		const inserted = await db
			.insert(transactions)
			.values(toInsert)
			.returning({ id: transactions.id });
		insertedIds.push(...inserted.map((r) => r.id));
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

	// Persist the opening balance transaction if one was provided (or auto-computed from CSV)
	if (openingBalance !== null && !isNaN(openingBalance) && rows.length > 0) {
		const direction = detectFileDirection(rows);
		const earliest =
			direction === 'desc'
				? rows[rows.length - 1] // last file row = chronologically first
				: rows.reduce((a, b) => (a.accountingDate <= b.accountingDate ? a : b));
		await upsertOpeningBalance(account.id, openingBalance, earliest.accountingDate, locals.user.id);
	}

	// Save confirmed column mappings to workspace so future uploads are pre-confirmed
	if (columnOverrides) {
		const toSave = [
			columnOverrides.categoryColumn
				? { key: 'category', label: columnOverrides.categoryColumn }
				: null,
			columnOverrides.cityColumn ? { key: 'city', label: columnOverrides.cityColumn } : null,
			columnOverrides.notesColumn ? { key: 'notes', label: columnOverrides.notesColumn } : null
		].filter(Boolean) as Array<{ key: string; label: string }>;

		for (const { key, label } of toSave) {
			await db
				.insert(csvColumnMappings)
				.values({
					workspaceId: account.workspaceId,
					columnKey: key,
					columnLabel: label,
					sortOrder: 0,
					enabled: true
				})
				.onConflictDoUpdate({
					target: [csvColumnMappings.workspaceId, csvColumnMappings.columnKey],
					set: { columnLabel: label, enabled: true }
				});
		}
	}

	// Mark account as active and refresh balance
	await db.update(bankAccounts).set({ status: 'active' }).where(eq(bankAccounts.id, account.id));

	await refreshCurrentBalance(account.id);

	// Detect and insert new categories from the CSV
	const newCategories = await upsertNewCategories(rows, account.workspaceId);

	// Transfer auto-detection and cross-currency conversion detection
	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	const [unresolvedTransfers, detectedConversions] = await Promise.all([
		detectAndLinkTransfers(insertedIds, accessibleIds, locals.user.id),
		detectAndCreateConversions(insertedIds, account.workspaceId, account.currency)
	]);

	return json({
		imported: importedCount,
		flagged: flaggedCount,
		statusUpdates: statusUpdatesCount,
		duplicates: duplicateCount,
		unresolvedTransfers,
		detectedConversions,
		newCategories
	});
};

// ─── Category palette ─────────────────────────────────────────────────────

const CATEGORY_COLORS = [
	'#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6',
	'#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
	'#f59e0b', '#10b981', '#6366f1', '#d946ef', '#0ea5e9'
];

function randomCategoryColor(): string {
	return CATEGORY_COLORS[Math.floor(Math.random() * CATEGORY_COLORS.length)];
}

/**
 * Collect unique non-empty category values from parsed rows,
 * find which ones don't exist yet in the workspace, insert them,
 * and return the newly created category names.
 */
async function upsertNewCategories(
	rows: NormalizedTransaction[],
	workspaceId: string
): Promise<Array<{ name: string; color: string }>> {
	// Collect unique non-empty category names from the CSV
	const csvCategories = [
		...new Set(rows.map((r) => r.category?.trim()).filter(Boolean) as string[])
	];
	if (csvCategories.length === 0) return [];

	// Load existing category names for this workspace (lowercase for comparison)
	const existing = await db.query.categories.findMany({
		where: eq(categories.workspaceId, workspaceId),
		columns: { name: true }
	});
	const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

	// Filter to only the ones that don't exist yet
	const toCreate = csvCategories.filter((name) => !existingNames.has(name.toLowerCase()));
	if (toCreate.length === 0) return [];

	const inserted = await db
		.insert(categories)
		.values(
			toCreate.map((name) => ({
				workspaceId,
				name,
				color: randomCategoryColor(),
				sortOrder: 0
			}))
		)
		.returning({ name: categories.name, color: categories.color });

	return inserted;
}

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
		isTransfer: row.isTransferCandidate,
		isFxCandidate: row.isFxCandidate,
		category: row.category ?? null,
		city: row.city ?? null,
		notes: row.notes ?? null,
		originalOrder: row.sourceIndex,
		status,
		payerUserId,
		syncSource: 'csv_upload'
	};
}
