import type { NormalizedTransaction, EnrichmentDelta } from './parsers/types.js';

/**
 * The stored category/notes/city fields an incoming re-imported row is diffed against.
 * Structurally a subset of a persisted transaction — kept db-free so this module (and the
 * diff below) stays pure and unit-testable without a database connection.
 */
export interface EnrichableExisting {
	category: string | null; // raw bank-file value
	categoryAI: string | null; // AI guess
	categoryOverride: string | null; // human decision
	costGroup: string | null; // cost bucket label (single source — no raw/AI split)
	notes: string | null;
	city: string | null;
}

/**
 * Diff a re-imported row's enrichment cells against the stored transaction.
 *
 * Policy (see the "category-reimport-plan" note in the Obsidian vault, §8):
 *  - Empty incoming cell → leave unchanged (never wipe existing data on a round-trip).
 *  - Category: compare incoming against the stored *effective* value
 *    (`categoryOverride ?? category ?? categoryAI`); a genuine change is recorded as a
 *    human `categoryOverride`, leaving raw `category` and AI `categoryAI` pristine.
 *  - Notes / City: compare directly against the stored column.
 *
 * Returns undefined when nothing changed (so the caller can treat it as a true duplicate).
 */
export function computeEnrichmentDelta(
	existing: EnrichableExisting,
	row: NormalizedTransaction
): EnrichmentDelta | undefined {
	const delta: EnrichmentDelta = {};

	const incomingCategory = row.category?.trim();
	if (incomingCategory) {
		const storedEffective =
			existing.categoryOverride ?? existing.category ?? existing.categoryAI ?? null;
		if (incomingCategory !== storedEffective) delta.categoryOverride = incomingCategory;
	}

	// Cost group has a single source (user/import), so we diff the incoming label directly
	// against the stored column — no effective-value fallback like category.
	const incomingCostGroup = row.costGroup?.trim();
	if (incomingCostGroup && incomingCostGroup !== (existing.costGroup ?? null))
		delta.costGroup = incomingCostGroup;

	const incomingNotes = row.notes?.trim();
	if (incomingNotes && incomingNotes !== (existing.notes ?? null)) delta.notes = incomingNotes;

	const incomingCity = row.city?.trim();
	if (incomingCity && incomingCity !== (existing.city ?? null)) delta.city = incomingCity;

	return Object.keys(delta).length > 0 ? delta : undefined;
}
