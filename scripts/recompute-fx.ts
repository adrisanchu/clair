#!/usr/bin/env tsx
/**
 * Maintenance: recompute the EUR valuation (`amountEur` / `exchangeRate`) of every row on
 * every foreign-currency account, using the CURRENT `propagateRateToAccount`. Also corrects
 * legacy opening-balance rows on foreign accounts that were written in EUR (they are
 * denominated in the account's own currency).
 *
 * Idempotent and SAFE to run against prod (Neon): it never creates, deletes, or re-pairs
 * conversions — it only re-derives values from the conversions already recorded. Use it
 * after deploying a valuation change, or to repair rows that were added without a recompute.
 *
 * Usage — the TSX_TSCONFIG_PATH shim is required (see scripts/redetect-conversions.ts):
 *
 *   TSX_TSCONFIG_PATH=tests/_shims/tsconfig.tsx.json \
 *     DATABASE_URL="<url>" npx tsx scripts/recompute-fx.ts
 */
try {
	(process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile('.env');
} catch {
	/* env may already be set */
}

import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '../src/lib/server/db/index.js';
import { bankAccounts, transactions } from '../src/lib/server/db/schema.js';
import { propagateRateToAccount } from '../src/lib/server/currency-converter.js';
import { PRIMARY_CURRENCY } from '../src/lib/currencies.js';

const foreign = await db
	.select({ id: bankAccounts.id, name: bankAccounts.displayName, currency: bankAccounts.currency })
	.from(bankAccounts)
	.where(and(ne(bankAccounts.currency, PRIMARY_CURRENCY), isNull(bankAccounts.deletedAt)))
	.orderBy(bankAccounts.createdAt);

console.log(`Recomputing ${foreign.length} foreign-currency account(s)…\n`);

for (const acct of foreign) {
	// Opening-balance rows on foreign accounts used to be labelled EUR.
	const relabelled = await db
		.update(transactions)
		.set({ currency: acct.currency })
		.where(
			and(
				eq(transactions.bankAccountId, acct.id),
				eq(transactions.isOpeningBalance, true),
				ne(transactions.currency, acct.currency)
			)
		)
		.returning({ id: transactions.id });

	const updated = await propagateRateToAccount(acct.id);

	const [stats] = await db
		.select({
			unresolved: sql<number>`COUNT(*) FILTER (WHERE ${transactions.amountEur} IS NULL AND NOT ${transactions.isOpeningBalance})::int`,
			balanceEur: sql<string>`COALESCE(SUM(${transactions.amountEur}) FILTER (WHERE ${transactions.status} = 'posted'), 0)`
		})
		.from(transactions)
		.where(eq(transactions.bankAccountId, acct.id));

	console.log(
		`  ${acct.name} (${acct.currency}): updated=${updated} unresolved=${stats.unresolved} ` +
			`balanceEur=${parseFloat(stats.balanceEur).toFixed(2)}` +
			(relabelled.length ? ` openingRelabelled=${relabelled.length}` : '')
	);
}

process.exit(0);
