import { and, eq, isNull } from 'drizzle-orm';
import { db } from './index.js';
import { bankAccounts, accountShares } from './schema.js';

/**
 * Returns all bank account IDs the given user can access:
 * accounts they own + accounts shared with them (accepted only).
 */
export async function getAccessibleAccountIds(userId: string): Promise<string[]> {
	const [owned, shared] = await Promise.all([
		db
			.select({ id: bankAccounts.id })
			.from(bankAccounts)
			.where(and(eq(bankAccounts.ownerUserId, userId), isNull(bankAccounts.deletedAt))),

		db
			.select({ id: accountShares.bankAccountId })
			.from(accountShares)
			.where(and(eq(accountShares.sharedWithId, userId), eq(accountShares.status, 'accepted')))
	]);

	return [...owned, ...shared].map((r) => r.id);
}
