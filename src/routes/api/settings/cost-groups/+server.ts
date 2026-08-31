import { error, json } from '@sveltejs/kit';
import { and, asc, eq, max } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { costGroups } from '$lib/server/db/schema.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ─── GET /api/settings/cost-groups ───────────────────────────────────────────
// Returns all cost groups for the user's workspace, ordered for display
// (sortOrder, then name). Flat — cost groups have no hierarchy.

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const rows = await db
		.select()
		.from(costGroups)
		.where(eq(costGroups.workspaceId, locals.user.workspaceId))
		.orderBy(asc(costGroups.sortOrder), asc(costGroups.name));

	return json(rows);
};

// ─── POST /api/settings/cost-groups ──────────────────────────────────────────
// Creates a new cost group. Owner only.

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const body = await request.json();
	const { name, color = '#6b7280', sortOrder = undefined } = body;

	if (!name?.trim()) throw error(400, 'name is required');
	if (name.trim().length > 50) throw error(400, 'name must be 50 characters or fewer');
	if (!COLOR_RE.test(color)) throw error(400, 'color must be a valid hex color (e.g. #f97316)');

	const workspaceId = locals.user.workspaceId;

	// Uniqueness check: no cost group with the same name in the workspace
	const existing = await db.query.costGroups.findFirst({
		where: and(eq(costGroups.workspaceId, workspaceId), eq(costGroups.name, name.trim()))
	});
	if (existing) throw error(409, `A cost group named "${name.trim()}" already exists`);

	// Compute sortOrder: use provided value if set, otherwise append at end
	const [{ maxOrder }] = await db
		.select({ maxOrder: max(costGroups.sortOrder) })
		.from(costGroups)
		.where(eq(costGroups.workspaceId, workspaceId));
	const resolvedSortOrder = sortOrder ?? (maxOrder != null ? maxOrder + 1 : 0);

	const [created] = await db
		.insert(costGroups)
		.values({ workspaceId, name: name.trim(), color, sortOrder: resolvedSortOrder })
		.returning();

	return json(created, { status: 201 });
};
