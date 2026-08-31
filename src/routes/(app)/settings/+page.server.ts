import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { categories, costGroups } from '$lib/server/db/schema.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401);
	if (!locals.user.workspaceId) error(403);

	const workspaceId = locals.user.workspaceId;

	const [rows, costGroupRows] = await Promise.all([
		db
			.select()
			.from(categories)
			.where(eq(categories.workspaceId, workspaceId))
			.orderBy(
				sql`COALESCE(${categories.parentId}, ${categories.id})`,
				asc(categories.sortOrder),
				asc(categories.name)
			),
		db
			.select()
			.from(costGroups)
			.where(eq(costGroups.workspaceId, workspaceId))
			.orderBy(asc(costGroups.sortOrder), asc(costGroups.name))
	]);

	return {
		categories: rows,
		costGroups: costGroupRows,
		isOwner: locals.user.role === 'owner'
	};
};
