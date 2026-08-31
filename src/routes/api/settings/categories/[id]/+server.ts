import { error, json } from '@sveltejs/kit';
import { and, count, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { categories } from '$lib/server/db/schema.js';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

async function getOwnedCategory(categoryId: string, workspaceId: string) {
	const category = await db.query.categories.findFirst({
		where: and(eq(categories.id, categoryId), eq(categories.workspaceId, workspaceId))
	});
	if (!category) throw error(404, 'Category not found');
	return category;
}

// ─── PATCH /api/settings/categories/[id] ─────────────────────────────────────
// Update name, color, sortOrder, or parentId. Owner only.
// When name changes: propagates to transactions.category, transactions.category_ai,
// transactions.category_override, and transaction_overrides.category within the
// workspace (atomic DB transaction).

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	const workspaceId = locals.user.workspaceId;
	const existing = await getOwnedCategory(params.id, workspaceId);

	const body = await request.json();
	const { name, color, sortOrder, parentId } = body;

	if (
		name === undefined &&
		color === undefined &&
		sortOrder === undefined &&
		parentId === undefined
	)
		throw error(400, 'Nothing to update');

	if (name !== undefined) {
		if (!name?.trim()) throw error(400, 'name cannot be empty');
		if (name.trim().length > 50) throw error(400, 'name must be 50 characters or fewer');
	}
	if (color !== undefined && !COLOR_RE.test(color))
		throw error(400, 'color must be a valid hex color (e.g. #f97316)');

	if (parentId !== undefined && parentId !== null) {
		const parent = await db.query.categories.findFirst({
			where: and(eq(categories.id, parentId), eq(categories.workspaceId, workspaceId))
		});
		if (!parent) throw error(400, 'parentId not found in this workspace');
		if (parent.parentId !== null) throw error(400, 'Cannot nest more than one level deep');
	}

	const newName = name !== undefined ? name.trim() : undefined;
	const oldName = existing.name;
	const nameChanged = newName !== undefined && newName !== oldName;

	// Uniqueness check on rename: names are unique per workspace (across levels), matching
	// the DB constraint categories_workspace_name_idx.
	if (nameChanged) {
		const duplicate = await db.query.categories.findFirst({
			where: and(eq(categories.workspaceId, workspaceId), eq(categories.name, newName!))
		});
		if (duplicate && duplicate.id !== params.id)
			throw error(409, `A category named "${newName}" already exists`);
	}

	const patch: Record<string, unknown> = {};
	if (newName !== undefined) patch.name = newName;
	if (color !== undefined) patch.color = color;
	if (sortOrder !== undefined) patch.sortOrder = sortOrder;
	if (parentId !== undefined) patch.parentId = parentId;

	// Wrap in a transaction when renaming so propagation is atomic
	const updated = await db.transaction(async (tx) => {
		const [row] = await tx
			.update(categories)
			.set(patch)
			.where(eq(categories.id, params.id))
			.returning();

		if (nameChanged) {
			// Propagate to transactions.category
			await tx.execute(sql`
				UPDATE "core"."transactions" t
				SET "category" = ${newName}
				FROM "core"."bank_accounts" ba
				WHERE t."category" = ${oldName}
				  AND t."bank_account_id" = ba."id"
				  AND ba."workspace_id" = ${workspaceId}
			`);

			// Propagate to transactions.category_override
			await tx.execute(sql`
				UPDATE "core"."transactions" t
				SET "category_override" = ${newName}
				FROM "core"."bank_accounts" ba
				WHERE t."category_override" = ${oldName}
				  AND t."bank_account_id" = ba."id"
				  AND ba."workspace_id" = ${workspaceId}
			`);

			// Propagate to transactions.category_ai
			await tx.execute(sql`
				UPDATE "core"."transactions" t
				SET "category_ai" = ${newName}
				FROM "core"."bank_accounts" ba
				WHERE t."category_ai" = ${oldName}
				  AND t."bank_account_id" = ba."id"
				  AND ba."workspace_id" = ${workspaceId}
			`);

			// Propagate to transaction_overrides.category
			await tx.execute(sql`
				UPDATE "core"."transaction_overrides" tov
				SET "category" = ${newName}
				FROM "core"."transactions" t
				JOIN "core"."bank_accounts" ba ON t."bank_account_id" = ba."id"
				WHERE tov."transaction_id" = t."id"
				  AND tov."category" = ${oldName}
				  AND ba."workspace_id" = ${workspaceId}
			`);
		}

		return row;
	});

	return json(updated);
};

// ─── DELETE /api/settings/categories/[id] ────────────────────────────────────
// Deletes a category. Owner only. Blocked if the category has subcategories.
// Transactions that reference this category by name retain the old text (intended).

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (locals.user.role !== 'owner') throw error(403, 'Owner only');
	if (!locals.user.workspaceId) throw error(403, 'No workspace');

	await getOwnedCategory(params.id, locals.user.workspaceId);

	// Block deletion if subcategories exist
	const [{ childCount }] = await db
		.select({ childCount: count() })
		.from(categories)
		.where(eq(categories.parentId, params.id));

	if (childCount > 0)
		throw error(409, 'Delete or reassign subcategories before deleting this category');

	await db.delete(categories).where(eq(categories.id, params.id));

	return new Response(null, { status: 204 });
};
