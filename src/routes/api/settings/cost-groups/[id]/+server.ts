import { error, json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { costGroups } from '$lib/server/db/schema.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

async function getOwnedCostGroup(costGroupId: string, workspaceId: string) {
	const costGroup = await db.query.costGroups.findFirst({
		where: and(eq(costGroups.id, costGroupId), eq(costGroups.workspaceId, workspaceId))
	});
	if (!costGroup) throw error(404, 'Cost group not found');
	return costGroup;
}

// ─── PATCH /api/settings/cost-groups/[id] ────────────────────────────────────
// Update name, color, or sortOrder. Owner only.
// When name changes: propagates to transactions.cost_group within the workspace
// (atomic DB transaction), keeping assigned rows in sync with the registry.

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const workspaceId = locals.user.workspaceId;
	const existing = await getOwnedCostGroup(params.id, workspaceId);

	const body = await request.json();
	const { name, color, sortOrder } = body;

	if (name === undefined && color === undefined && sortOrder === undefined)
		throw error(400, 'Nothing to update');

	if (name !== undefined) {
		if (!name?.trim()) throw error(400, 'name cannot be empty');
		if (name.trim().length > 50) throw error(400, 'name must be 50 characters or fewer');
	}
	if (color !== undefined && !COLOR_RE.test(color))
		throw error(400, 'color must be a valid hex color (e.g. #f97316)');

	const newName = name !== undefined ? name.trim() : undefined;
	const oldName = existing.name;
	const nameChanged = newName !== undefined && newName !== oldName;

	// Uniqueness check on rename
	if (nameChanged) {
		const sibling = await db.query.costGroups.findFirst({
			where: and(eq(costGroups.workspaceId, workspaceId), eq(costGroups.name, newName!))
		});
		if (sibling && sibling.id !== params.id)
			throw error(409, `A cost group named "${newName}" already exists`);
	}

	const patch: Record<string, unknown> = {};
	if (newName !== undefined) patch.name = newName;
	if (color !== undefined) patch.color = color;
	if (sortOrder !== undefined) patch.sortOrder = sortOrder;

	// Wrap in a transaction when renaming so propagation is atomic
	const updated = await db.transaction(async (tx) => {
		const [row] = await tx
			.update(costGroups)
			.set(patch)
			.where(eq(costGroups.id, params.id))
			.returning();

		if (nameChanged) {
			// Propagate to transactions.cost_group (scoped to the workspace)
			await tx.execute(sql`
				UPDATE "core"."transactions" t
				SET "cost_group" = ${newName}
				FROM "core"."bank_accounts" ba
				WHERE t."cost_group" = ${oldName}
				  AND t."bank_account_id" = ba."id"
				  AND ba."workspace_id" = ${workspaceId}
			`);
		}

		return row;
	});

	return json(updated);
};

// ─── DELETE /api/settings/cost-groups/[id] ───────────────────────────────────
// Deletes a cost group. Owner only. Transactions that reference this cost group
// by name retain the old text (intended — same tolerance as categories).

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	await getOwnedCostGroup(params.id, locals.user.workspaceId);

	await db.delete(costGroups).where(eq(costGroups.id, params.id));

	return new Response(null, { status: 204 });
};
