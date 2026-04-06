import { error, json } from '@sveltejs/kit';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { categories } from '$lib/server/db/schema.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ─── GET /api/settings/categories ────────────────────────────────────────────
// Returns all categories for the user's workspace, ordered for display:
// top-level categories first (by sortOrder, then name), subcategories grouped
// under their parents. Returned as a flat array; clients build the tree.

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const rows = await db
		.select()
		.from(categories)
		.where(eq(categories.workspaceId, locals.user.workspaceId))
		.orderBy(
			sql`COALESCE(${categories.parentId}, ${categories.id})`,
			asc(categories.sortOrder),
			asc(categories.name)
		);

	return json(rows);
};

// ─── POST /api/settings/categories ───────────────────────────────────────────
// Creates a new category or subcategory. Owner only.

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const body = await request.json();
	const { name, color = '#6b7280', parentId = null, sortOrder = 0 } = body;

	if (!name?.trim()) throw error(400, 'name is required');
	if (name.trim().length > 50) throw error(400, 'name must be 50 characters or fewer');
	if (!COLOR_RE.test(color)) throw error(400, 'color must be a valid hex color (e.g. #f97316)');

	const workspaceId = locals.user.workspaceId;

	// Validate parentId: must exist in same workspace and be a top-level category
	if (parentId !== null) {
		const parent = await db.query.categories.findFirst({
			where: and(eq(categories.id, parentId), eq(categories.workspaceId, workspaceId))
		});
		if (!parent) throw error(400, 'parentId not found in this workspace');
		if (parent.parentId !== null) throw error(400, 'Cannot nest more than one level deep');
	}

	// Uniqueness check: no sibling with same name at same level
	const sibling = await db.query.categories.findFirst({
		where: and(
			eq(categories.workspaceId, workspaceId),
			eq(categories.name, name.trim()),
			parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId)
		)
	});
	if (sibling) throw error(409, `A category named "${name.trim()}" already exists at this level`);

	const [created] = await db
		.insert(categories)
		.values({ workspaceId, name: name.trim(), color, parentId, sortOrder })
		.returning();

	return json(created, { status: 201 });
};
