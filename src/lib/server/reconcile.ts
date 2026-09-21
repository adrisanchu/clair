import { and, eq, sql } from 'drizzle-orm';
import { db } from './db/index.js';
import { transactions } from './db/schema.js';
import type { NormalizedTransaction } from './parsers/types.js';

/**
 * A stored transaction that falls inside the uploaded file's date window but was not
 * matched by any of the file's rows — i.e. it looks like it was deleted at the bank.
 * This is a UI-only signal: nothing is persisted until the user confirms removal.
 */
export interface PotentialDeletion {
	id: string;
	/** yyyy-MM-dd (UTC) — matches how accountingDate is stored. */
	date: string;
	description: string;
	amount: number;
	currency: string;
	status: 'pending' | 'posted' | 'review' | 'reverted';
	/** True when this row is linked as a transfer or conversion leg — removing it unlinks its counterpart. */
	linkedElsewhere: boolean;
	linkType: 'transfer' | 'conversion' | null;
}

export interface DeletionScan {
	/** The uploaded file's date window (yyyy-MM-dd), or null when the file had no rows. */
	from: string | null;
	to: string | null;
	items: PotentialDeletion[];
}

/** yyyy-MM-dd (UTC) for a `::date` SQL comparison — mirrors dedup.ts's toDateStr. */
function toDateStr(d: Date): string {
	return d.toISOString().split('T')[0];
}

/**
 * Find existing transactions that sit within the uploaded file's date bounds but are absent
 * from it. The file's rows define the window [min(accountingDate), max(accountingDate)];
 * any stored row in that window whose id is not in `matchedExistingIds` (see
 * classifyUpload in dedup.ts) is a deletion candidate.
 *
 * Opening-balance rows are always excluded. Pending/review rows ARE included (per product
 * decision) — a record removed at the bank should surface regardless of its status.
 */
export async function detectPotentialDeletions(
	rows: NormalizedTransaction[],
	bankAccountId: string,
	matchedExistingIds: Set<string>
): Promise<DeletionScan> {
	if (rows.length === 0) return { from: null, to: null, items: [] };

	let min = rows[0].accountingDate;
	let max = rows[0].accountingDate;
	for (const r of rows) {
		if (r.accountingDate < min) min = r.accountingDate;
		if (r.accountingDate > max) max = r.accountingDate;
	}
	const minStr = toDateStr(min);
	const maxStr = toDateStr(max);

	const inWindow = await db
		.select({
			id: transactions.id,
			accountingDate: transactions.accountingDate,
			description: transactions.description,
			amount: transactions.amount,
			currency: transactions.currency,
			status: transactions.status,
			transferCounterpartId: transactions.transferCounterpartId,
			conversionCounterpartId: transactions.conversionCounterpartId
		})
		.from(transactions)
		.where(
			and(
				eq(transactions.bankAccountId, bankAccountId),
				eq(transactions.isOpeningBalance, false),
				sql`${transactions.accountingDate}::date >= ${minStr}::date`,
				sql`${transactions.accountingDate}::date <= ${maxStr}::date`
			)
		);

	const items = inWindow
		.filter((t) => !matchedExistingIds.has(t.id))
		.map((t) => {
			const linkType = t.transferCounterpartId
				? ('transfer' as const)
				: t.conversionCounterpartId
					? ('conversion' as const)
					: null;
			return {
				id: t.id,
				date: toDateStr(t.accountingDate),
				description: t.description,
				amount: Number(t.amount),
				currency: t.currency,
				status: t.status,
				linkedElsewhere: linkType !== null,
				linkType
			};
		});

	return { from: minStr, to: maxStr, items };
}
