import { error, json } from '@sveltejs/kit';
import { and, count, eq, inArray, isNull, max } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { bankAccounts, csvUploads, transactions } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import { getAllProfiles } from '$lib/server/parsers/index.js';

const VALID_PROFILE_IDS = new Set(getAllProfiles().map((p) => p.bankProfileId));

// ─── GET /api/accounts ────────────────────────────────────────────────────────
// Returns all accounts accessible to the current user (owned + shared),
// enriched with transaction count and last upload date.

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	if (accessibleIds.length === 0) return json([]);

	const rows = await db
		.select({
			id: bankAccounts.id,
			displayName: bankAccounts.displayName,
			institutionName: bankAccounts.institutionName,
			bankProfileId: bankAccounts.bankProfileId,
			ibanLast4: bankAccounts.ibanLast4,
			currency: bankAccounts.currency,
			currentBalance: bankAccounts.currentBalance,
			status: bankAccounts.status,
			ownerUserId: bankAccounts.ownerUserId,
			createdAt: bankAccounts.createdAt,
			txCount: count(transactions.id),
			lastUploadedAt: max(csvUploads.uploadedAt)
		})
		.from(bankAccounts)
		.leftJoin(
			transactions,
			and(eq(transactions.bankAccountId, bankAccounts.id), eq(transactions.isOpeningBalance, false))
		)
		.leftJoin(csvUploads, eq(csvUploads.bankAccountId, bankAccounts.id))
		.where(and(inArray(bankAccounts.id, accessibleIds), isNull(bankAccounts.deletedAt)))
		.groupBy(bankAccounts.id)
		.orderBy(bankAccounts.createdAt);

	return json(
		rows.map((r) => ({
			...r,
			currentBalance: parseFloat(r.currentBalance),
			isOwner: r.ownerUserId === locals.user!.id
		}))
	);
};

// ─── POST /api/accounts ───────────────────────────────────────────────────────
// Creates a new bank account owned by the current user.

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	if (!locals.user.workspaceId) throw error(403, 'No workspace — run the seed script first');

	const body = await request.json();
	const { displayName, bankProfileId, ibanLast4, currency = 'EUR' } = body;

	if (!displayName?.trim()) throw error(400, 'displayName is required');
	if (!bankProfileId) throw error(400, 'bankProfileId is required');
	if (!VALID_PROFILE_IDS.has(bankProfileId))
		throw error(400, `Unknown bankProfileId: ${bankProfileId}`);
	if (!ibanLast4?.trim()) throw error(400, 'ibanLast4 is required');
	if (!/^\d{4}$/.test(ibanLast4.trim())) throw error(400, 'ibanLast4 must be exactly 4 digits');

	const profile = getAllProfiles().find((p) => p.bankProfileId === bankProfileId)!;

	const [account] = await db
		.insert(bankAccounts)
		.values({
			ownerUserId: locals.user.id,
			workspaceId: locals.user.workspaceId,
			displayName: displayName.trim(),
			institutionName: profile.displayName,
			bankProfileId,
			ibanLast4: ibanLast4.trim(),
			currency,
			status: 'no_data'
		})
		.returning();

	return json(account, { status: 201 });
};
