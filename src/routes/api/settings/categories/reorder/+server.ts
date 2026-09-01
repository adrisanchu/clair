import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { categories } from '$lib/server/db/schema.js';
import type { CategoryReorderItem } from '$lib/types';

// ─── PATCH /api/settings/categories/reorder ──────────────────────────────────
// Batch-updates sortOrder + parentId for many categories in one atomic write.
// Used by the drag-and-drop manager to persist a reordered / re-nested tree.
// Owner only. Never touches `name`, so no transaction-label propagation is needed
// (transactions reference categories by name — see the [id] PATCH handler for the
// rename propagation logic).

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const workspaceId = locals.user.workspaceId;

	const body = await request.json();
	const items: CategoryReorderItem[] = body?.items;

	if (!Array.isArray(items) || items.length === 0) throw error(400, 'items is required');

	// Shape validation
	for (const item of items) {
		if (typeof item?.id !== 'string') throw error(400, 'each item needs an id');
		if (item.parentId !== null && typeof item.parentId !== 'string')
			throw error(400, 'parentId must be a string or null');
		if (typeof item.sortOrder !== 'number') throw error(400, 'sortOrder must be a number');
	}

	// No duplicate ids in the payload
	const ids = items.map((i) => i.id);
	if (new Set(ids).size !== ids.length) throw error(400, 'duplicate id in items');

	// Every id must belong to this workspace
	const owned = await db
		.select({ id: categories.id })
		.from(categories)
		.where(and(eq(categories.workspaceId, workspaceId), inArray(categories.id, ids)));
	if (owned.length !== ids.length) throw error(400, 'one or more categories not found');

	// 1-level nesting rule (validated against the submitted payload):
	// any item with a parent must reference an item that is present and itself top-level.
	const byId = new Map(items.map((i) => [i.id, i]));
	for (const item of items) {
		if (item.parentId === null) continue;
		if (item.parentId === item.id) throw error(400, 'a category cannot be its own parent');
		const parent = byId.get(item.parentId);
		if (!parent) throw error(400, 'parent must be included in the reorder payload');
		if (parent.parentId !== null) throw error(400, 'Cannot nest more than one level deep');
	}

	await db.transaction(async (tx) => {
		for (const item of items) {
			await tx
				.update(categories)
				.set({ parentId: item.parentId, sortOrder: item.sortOrder })
				.where(and(eq(categories.id, item.id), eq(categories.workspaceId, workspaceId)));
		}
	});

	return json({ ok: true });
};
