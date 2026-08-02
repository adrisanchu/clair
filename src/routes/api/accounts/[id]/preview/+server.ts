import { error, json } from '@sveltejs/kit';
import { and, eq, isNull } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, categories, csvColumnMappings } from '$lib/server/db/schema.js';
import { uploadAndParse, detectFileDirection } from '$lib/server/parsers/index.js';
import { summarizeClassification } from '$lib/server/dedup.js';
import { matchCategories } from '$lib/server/ai/tagger.js';

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

	// Dry-run dedup so the preview shows the same New / Duplicates / Updates / Review
	// breakdown the import will produce (dedup keys on date+amount+description, which
	// are unaffected by category/city/notes column overrides — so this matches import).
	const classification = await summarizeClassification(rows, account.id);

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

	// AI-powered category matching: if the CSV has category values, match against workspace categories
	const csvCategoryValues = [
		...new Set(rows.map((r) => r.category?.trim()).filter(Boolean) as string[])
	];

	let categoryMappings: Array<{
		csvCategory: string;
		suggestedMatch: string | null;
		confidence: number;
	}> | null = null;

	const workspaceCategories = await db
		.select({
			id: categories.id,
			name: categories.name,
			color: categories.color,
			parentId: categories.parentId
		})
		.from(categories)
		.where(eq(categories.workspaceId, account.workspaceId));

	if (csvCategoryValues.length > 0) {
		const workspaceCategoryNames = workspaceCategories.map((c) => c.name);
		const aiMappings = await matchCategories(csvCategoryValues, workspaceCategoryNames);
		categoryMappings = aiMappings.map((m) => ({
			csvCategory: m.csvCategory,
			suggestedMatch: m.matchedCategory,
			confidence: m.confidence
		}));
	}

	return json({
		filename: file.name,
		profile: account.bankProfileId,
		totalParsed: rows.length,
		skippedCount,
		// Dedup projection (matches the import outcome)
		newCount: classification.newCount,
		duplicateCount: classification.duplicateCount,
		updateCount: classification.updateCount,
		reviewCount: classification.reviewCount,
		preview,
		openingBalance,
		closingBalance,
		columnMappings: result.columnMappings,
		unusedColumns: result.unusedColumns,
		savedMappings: savedMappings.map((m) => ({
			field: m.columnKey,
			csvHeader: m.columnLabel,
			enabled: m.enabled
		})),
		categoryMappings,
		workspaceCategories,
		// Adaptive detection metadata — null when the strict profile was used successfully
		detection: result.detectionMeta
			? {
					usedAdaptive: true,
					overallConfidence: result.detectionMeta.overallConfidence,
					warnings: result.detectionMeta.warnings,
					detectedDelimiter: result.detectionMeta.detectedDelimiter.value,
					detectedDateFormat: result.detectionMeta.detectedDateFormat.value,
					columnMappings: Object.fromEntries(
						Object.entries(result.detectionMeta.columnMappingDetails).map(([f, d]) => [
							f,
							{ header: d.value, confidence: d.confidence }
						])
					)
				}
			: null
	});
};
