import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { db } from './index.js';
import { authUser, bankAccounts } from './schema.js';

/**
 * Returns all bank account IDs the given user can access:
 * - All accounts they own (any visibility)
 * - Workspace accounts owned by others where visibility is 'stats_only' or 'full'
 */
export async function getAccessibleAccountIds(userId: string): Promise<string[]> {
	const user = await db.query.authUser.findFirst({
		where: eq(authUser.id, userId),
		columns: { workspaceId: true }
	});
	if (!user?.workspaceId) return [];

	const rows = await db
		.select({ id: bankAccounts.id })
		.from(bankAccounts)
		.where(
			and(
				eq(bankAccounts.workspaceId, user.workspaceId),
				isNull(bankAccounts.deletedAt),
				or(eq(bankAccounts.ownerUserId, userId), ne(bankAccounts.visibility, 'private'))
			)
		);

	return rows.map((r) => r.id);
}

/**
 * Returns account IDs where the user can view individual transactions:
 * - All accounts they own (any visibility)
 * - Workspace accounts with visibility = 'full' (stats_only excluded)
 */
export async function getFullAccessAccountIds(userId: string): Promise<string[]> {
	const user = await db.query.authUser.findFirst({
		where: eq(authUser.id, userId),
		columns: { workspaceId: true }
	});
	if (!user?.workspaceId) return [];

	const rows = await db
		.select({ id: bankAccounts.id })
		.from(bankAccounts)
		.where(
			and(
				eq(bankAccounts.workspaceId, user.workspaceId),
				isNull(bankAccounts.deletedAt),
				or(eq(bankAccounts.ownerUserId, userId), eq(bankAccounts.visibility, 'full'))
			)
		);

	return rows.map((r) => r.id);
}

/**
 * Returns true if the user can upload CSVs to the given account:
 * - They own the account, OR
 * - They are a workspace member and the account has 'full' visibility
 */
export async function canUploadToAccount(userId: string, accountId: string): Promise<boolean> {
	const user = await db.query.authUser.findFirst({
		where: eq(authUser.id, userId),
		columns: { workspaceId: true }
	});
	if (!user?.workspaceId) return false;

	const account = await db.query.bankAccounts.findFirst({
		where: and(eq(bankAccounts.id, accountId), isNull(bankAccounts.deletedAt)),
		columns: { ownerUserId: true, workspaceId: true, visibility: true }
	});
	if (!account) return false;
	if (account.ownerUserId === userId) return true;

	return account.workspaceId === user.workspaceId && account.visibility === 'full';
}
