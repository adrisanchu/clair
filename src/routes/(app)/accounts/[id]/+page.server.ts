import { error } from '@sveltejs/kit';
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { authUser, bankAccounts, csvUploads } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';

export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (!accessibleIds.includes(params.id)) error(404, 'Account not found');

	const account = await db.query.bankAccounts.findFirst({
		where: and(eq(bankAccounts.id, params.id), isNull(bankAccounts.deletedAt))
	});
	if (!account) error(404, 'Account not found');

	const isOwner = account.ownerUserId === locals.user.id;

	const [uploads, partner] = await Promise.all([
		db
			.select()
			.from(csvUploads)
			.where(eq(csvUploads.bankAccountId, params.id))
			.orderBy(desc(csvUploads.uploadedAt))
			.limit(20),

		locals.user.workspaceId
			? db.query.authUser.findFirst({
					where: and(
						eq(authUser.workspaceId, locals.user.workspaceId),
						ne(authUser.id, locals.user.id)
					),
					columns: { id: true, name: true }
				})
			: Promise.resolve(null)
	]);

	return {
		account: { ...account, currentBalance: parseFloat(account.currentBalance) },
		uploads,
		isOwner,
		partner: partner ?? null
	};
};
