import { and, eq, isNull, isNotNull, desc } from 'drizzle-orm';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, categories, transactions } from '$lib/server/db/schema.js';
import { isAiAvailable, tagBatch, type TagResult } from './tagger.js';
import { CONFIDENCE_LOW, TAG_BATCH_SIZE } from '$lib/constants/ai.js';

/**
 * Auto-tags uncategorised transactions from a specific CSV upload.
 * Only processes transactions where both `category` and `categoryOverride` are null.
 *
 * Returns { tagged, skipped } counts. Gracefully returns zeros when AI is unavailable.
 */
export async function autoTagUpload(
	csvUploadId: string,
	workspaceId: string
): Promise<{ tagged: number; skipped: number }> {
	if (!isAiAvailable()) return { tagged: 0, skipped: 0 };

	// Find uncategorised transactions from this upload
	const uncategorised = await db
		.select({
			id: transactions.id,
			description: transactions.description,
			amount: transactions.amount,
			currency: transactions.currency
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.csvUploadId, csvUploadId),
				isNull(transactions.category),
				isNull(transactions.categoryOverride)
			)
		);

	if (uncategorised.length === 0) return { tagged: 0, skipped: 0 };

	// Load workspace category names
	const workspaceCategories = await db
		.select({ name: categories.name })
		.from(categories)
		.where(eq(categories.workspaceId, workspaceId));

	const categoryNames = workspaceCategories.map((c) => c.name);
	if (categoryNames.length === 0) return { tagged: 0, skipped: uncategorised.length };

	// Build few-shot examples from recent user corrections
	const fewShot = await buildFewShotExamples(workspaceId);

	let tagged = 0;
	let skipped = 0;

	// Process in batches
	for (let i = 0; i < uncategorised.length; i += TAG_BATCH_SIZE) {
		const batch = uncategorised.slice(i, i + TAG_BATCH_SIZE);
		const items = batch.map((tx) => ({
			id: tx.id,
			description: tx.description,
			amount: parseFloat(tx.amount),
			currency: tx.currency
		}));

		const results = await tagBatch(items, categoryNames, fewShot);
		const resultMap = new Map<string, TagResult>(results.map((r) => [r.id, r]));

		for (const tx of batch) {
			const result = resultMap.get(tx.id);
			if (!result || result.confidence < CONFIDENCE_LOW) {
				skipped++;
				continue;
			}

			await db
				.update(transactions)
				.set({
					category: result.category,
					categoryConfidence: result.confidence.toFixed(3),
					...(result.isTransfer && result.confidence >= CONFIDENCE_LOW
						? { isTransfer: true }
						: {})
				})
				.where(eq(transactions.id, tx.id));
			tagged++;
		}
	}

	return { tagged, skipped };
}

/**
 * Builds a few-shot prompt string from recent user category corrections.
 * Uses transactions where `categoryOverride` is set — these represent
 * human corrections that improve future AI tagging accuracy.
 */
async function buildFewShotExamples(workspaceId: string): Promise<string> {
	// Get recent corrections by joining through bank accounts to filter by workspace
	const corrections = await db
		.select({
			description: transactions.description,
			amount: transactions.amount,
			categoryOverride: transactions.categoryOverride
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				isNotNull(transactions.categoryOverride)
			)
		)
		.orderBy(desc(transactions.accountingDate))
		.limit(20);

	if (corrections.length === 0) return '';

	return corrections
		.map(
			(c) =>
				`"${c.description}" (${c.amount}) → ${c.categoryOverride}`
		)
		.join('\n');
}
