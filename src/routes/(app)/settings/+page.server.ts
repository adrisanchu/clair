import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { categories } from '$lib/server/db/schema.js';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401);
	if (!locals.user.workspaceId) error(403);

	const rows = await db
		.select()
		.from(categories)
		.where(eq(categories.workspaceId, locals.user.workspaceId))
		.orderBy(
			sql`COALESCE(${categories.parentId}, ${categories.id})`,
			asc(categories.sortOrder),
			asc(categories.name)
		);

	return {
		categories: rows,
		isOwner: locals.user.role === 'owner'
	};
};
