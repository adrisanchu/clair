import { and, asc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { addDays, subDays } from 'date-fns';
import { db } from './db/index.js';
import { bankAccounts, currencyConversions, transactions } from './db/schema.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';
import {
	FX_ANCHOR_WINDOW_DAYS,
	FX_DESCRIPTION_SQL_PATTERN,
	FX_RATE_TOLERANCE
} from '$lib/constants/transfers.js';
import {
	EUR_AMOUNT_DECIMALS,
	FX_POOL_EPSILON,
	FX_RATE_DECIMALS,
	FX_REVALUE_BATCH_SIZE
} from '$lib/constants/currency.js';

/**
 * A row is an FX leg for detection purposes when it was flagged at parse time
 * (`isFxCandidate`) OR its description names a currency exchange ("Conversión a X",
 * "Exchanged to X", "Cambio de divisa(s) a X"). The description fallback re-enables
 * detection for rows imported before the flag existed, without weakening the
 * downstream rate/exclusion guards.
 */
const fxLegSignal: SQL = or(
	eq(transactions.isFxCandidate, true),
	sql`${transactions.description} ~* ${FX_DESCRIPTION_SQL_PATTERN}`
)!;

/**
 * Converts a Date (or Drizzle date result) to a plain `YYYY-MM-DD` string.
 * When embedded in a `sql` template literal, Drizzle parameterises the value
 * and the pg driver serialises a JS Date via `.toString()` — which PostgreSQL
 * cannot cast to `::date`. Passing an ISO date string instead is always safe.
 */
function toDateStr(d: unknown): string {
	const date = d instanceof Date ? d : new Date(d as string);
	return date.toISOString().split('T')[0];
}

/**
 * Set the symmetric `conversionCounterpartId` self-link on both legs of a conversion
 * (mirrors `transferCounterpartId`). Non-null on a row ⇔ it is a settled conversion leg —
 * the reliable, join-free signal, unlike the overloaded `conversionId` rate tag.
 */
export async function linkConversionLegs(aId: string, bId: string): Promise<void> {
	// A conversion and a same-currency transfer are mutually exclusive facets of a row.
	// Setting the conversion link clears any transfer flag/link on both legs so a leg can
	// never carry both (which mislabels the row's icon and, worse, leaves reporting relying
	// on the overloaded `isTransfer` flag to exclude it). Reporting now excludes conversion
	// legs via `conversionCounterpartId`, so this keeps the two systems from colliding.
	await db
		.update(transactions)
		.set({ conversionCounterpartId: bId, isTransfer: false, transferCounterpartId: null })
		.where(eq(transactions.id, aId));
	await db
		.update(transactions)
		.set({ conversionCounterpartId: aId, isTransfer: false, transferCounterpartId: null })
		.where(eq(transactions.id, bId));
}

/** Clear the `conversionCounterpartId` link on the given legs (on unlink). */
export async function unlinkConversionLegs(ids: (string | null)[]): Promise<void> {
	const valid = ids.filter((x): x is string => !!x);
	if (valid.length === 0) return;
	await db
		.update(transactions)
		.set({ conversionCounterpartId: null })
		.where(inArray(transactions.id, valid));
}

export interface CurrencyConversionResult {
	conversionId: string;
	fromAccountId: string; // EUR source account
	toAccountId: string; // foreign-currency destination account
	fromTransactionId: string;
	toTransactionId: string;
	fromAmount: number; // EUR amount (absolute value)
	toAmount: number; // foreign amount
	exchangeRate: number; // toAmount / fromAmount
	effectiveFrom: Date;
	affectedTxCount: number;
	confidence: 'auto';
	fromAccountName: string;
	fromTransactionDescription: string;
	toAccountName: string;
	toTransactionDescription: string;
}

interface ForeignAnchor {
	id: string;
	amount: string | number;
	accountingDate: unknown;
	bankAccountId: string;
	description: string;
	accountName: string;
	accountCurrency: string;
}

/**
 * Median foreign-per-EUR rate of the conversions already recorded for `currency` in the
 * workspace, or null when none exist yet. Used as the baseline for the rate-plausibility
 * guard so a new auto-match with a wildly off rate (an unrelated EUR leg) is rejected.
 */
async function referenceRateForCurrency(
	workspaceId: string,
	currency: string
): Promise<number | null> {
	const rows = await db
		.select({ rate: currencyConversions.exchangeRate })
		.from(currencyConversions)
		.innerJoin(bankAccounts, eq(currencyConversions.toAccountId, bankAccounts.id))
		.where(
			and(
				eq(currencyConversions.workspaceId, workspaceId),
				eq(bankAccounts.currency, currency)
			)
		);
	const rates = rows
		.map((r) => parseFloat(r.rate as unknown as string))
		.filter((r) => Number.isFinite(r) && r > 0)
		.sort((a, b) => a - b);
	if (rates.length === 0) return null;
	const mid = Math.floor(rates.length / 2);
	return rates.length % 2 === 0 ? (rates[mid - 1] + rates[mid]) / 2 : rates[mid];
}

/**
 * Resolve a single foreign-currency anchor — a flagged FX leg (`isFxCandidate`,
 * e.g. Revolut 'Cambio') on a non-EUR account — to its EUR counterpart leg, and create
 * the `currency_conversions` record. Handles BOTH directions:
 *   - foreign **inbound** (amount > 0, "Conversión a SEK"): EUR is spent to buy foreign,
 *     so match the nearest opposite-sign EUR **outgoing** in `[T − W, T]`.
 *   - foreign **outbound** (amount < 0, "Conversión a EUR"): foreign is sold for EUR,
 *     so match the nearest opposite-sign EUR **incoming** in `[T, T + W]`.
 * (W = `FX_ANCHOR_WINDOW_DAYS`.)
 *
 * Matching strategy: the flagged foreign leg is the **anchor**; the EUR leg is the nearest
 * opposite-sign EUR row in the window that is **itself a flagged FX leg** (`isFxCandidate`).
 * Requiring the EUR leg to be flagged is what stops the matcher inventing nonsense pairs —
 * without it, an anchor bound to whatever EUR row happened to be nearby (a card purchase, an
 * ATM withdrawal), producing a wildly off rate. As a second guard, when earlier conversions
 * already exist for this currency the implied rate must be within `FX_RATE_TOLERANCE` of the
 * median known rate, otherwise the match is rejected and the anchor left for manual linking.
 * Because FX legs cannot be amount-matched across currencies, the flagged-both-sides
 * requirement is what guards against over-pairing.
 *
 * The conversion is stored NORMALISED (`fromAccount = EUR`, `toAccount = foreign`,
 * rate = foreign-per-EUR) regardless of physical direction, so `propagateRateToAccount`
 * always reads `fromAmount` as the EUR side of the foreign leg.
 *
 * Returns the created conversion, or null when no EUR counterpart exists in the window.
 */
async function resolveForeignAnchor(
	fxTx: ForeignAnchor,
	workspaceId: string
): Promise<CurrencyConversionResult | null> {
	const txDate = fxTx.accountingDate as unknown as Date;
	const txDateStr = toDateStr(txDate);
	const fxAmount = parseFloat(fxTx.amount as unknown as string);
	if (fxAmount === 0) return null;

	// Direction: inbound foreign is funded by an earlier EUR outflow; outbound foreign
	// pays out to a later EUR inflow. The EUR leg always has the opposite sign.
	const inbound = fxAmount > 0;
	const eurSignCond = inbound
		? sql`${transactions.amount}::numeric < 0`
		: sql`${transactions.amount}::numeric > 0`;
	const lowerStr = inbound ? toDateStr(subDays(txDate, FX_ANCHOR_WINDOW_DAYS)) : txDateStr;
	const upperStr = inbound ? txDateStr : toDateStr(addDays(txDate, FX_ANCHOR_WINDOW_DAYS));

	const eurCandidates = await db
		.select({
			id: transactions.id,
			amount: transactions.amount,
			accountingDate: transactions.accountingDate,
			bankAccountId: transactions.bankAccountId,
			description: transactions.description,
			accountName: bankAccounts.displayName
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				eq(bankAccounts.currency, PRIMARY_CURRENCY),
				eurSignCond,
				// The EUR leg must itself look like an FX row — the guard against binding an
				// anchor to an unrelated EUR purchase/withdrawal (which yields a garbage rate).
				// Flagged at parse time, or recognisable from its description (see `fxLegSignal`).
				fxLegSignal,
				// A user-excluded EUR leg is off-limits to auto-detection.
				eq(transactions.fxDetectionExcluded, false),
				// An EUR leg already used in a conversion must not fund another. Its own
				// `conversionId` column is never set (propagation only tags the foreign
				// account), so membership is checked against currency_conversions directly —
				// this is the guard that prevents one EUR outflow backing many foreign anchors.
				sql`NOT EXISTS (
					SELECT 1 FROM ${currencyConversions}
					WHERE ${currencyConversions.fromTransactionId} = ${transactions.id}
					   OR ${currencyConversions.toTransactionId} = ${transactions.id}
				)`,
				eq(transactions.isOpeningBalance, false),
				sql`${transactions.accountingDate}::date >= ${lowerStr}::date`,
				sql`${transactions.accountingDate}::date <= ${upperStr}::date`
			)
		)
		// Closest by date (both sides are already flagged FX legs).
		.orderBy(
			// date − date yields an integer day count directly (no EXTRACT needed).
			sql`ABS(${transactions.accountingDate}::date - ${txDateStr}::date)`
		)
		.limit(5);

	if (eurCandidates.length === 0) return null;

	const best = eurCandidates[0];
	const foreignAmount = Math.abs(fxAmount);
	const eurAmount = Math.abs(parseFloat(best.amount as unknown as string));
	if (eurAmount === 0) return null;
	const rate = foreignAmount / eurAmount;

	// Rate-plausibility guard: reject a match whose implied rate is far from the median rate
	// of conversions already recorded for this currency (leaves the anchor for manual linking).
	const reference = await referenceRateForCurrency(workspaceId, fxTx.accountCurrency);
	if (reference !== null && Math.abs(rate - reference) / reference > FX_RATE_TOLERANCE) {
		return null;
	}

	const effectiveFrom = best.accountingDate as unknown as Date;

	const [conversion] = await db
		.insert(currencyConversions)
		.values({
			workspaceId,
			fromAccountId: best.bankAccountId,
			toAccountId: fxTx.bankAccountId,
			fromAmount: eurAmount.toFixed(4),
			toAmount: foreignAmount.toFixed(4),
			exchangeRate: rate.toFixed(6),
			effectiveFrom,
			confidence: 'auto',
			fromTransactionId: best.id,
			toTransactionId: fxTx.id
		})
		.returning({ id: currencyConversions.id });

	await linkConversionLegs(best.id, fxTx.id);
	const count = await propagateRateToAccount(fxTx.bankAccountId);

	return {
		conversionId: conversion.id,
		fromAccountId: best.bankAccountId,
		toAccountId: fxTx.bankAccountId,
		fromTransactionId: best.id,
		toTransactionId: fxTx.id,
		fromAmount: eurAmount,
		toAmount: foreignAmount,
		exchangeRate: rate,
		effectiveFrom,
		affectedTxCount: count,
		confidence: 'auto',
		fromAccountName: best.accountName,
		fromTransactionDescription: best.description,
		toAccountName: fxTx.accountName,
		toTransactionDescription: fxTx.description
	};
}

/**
 * High-confidence FX pairing: match the two legs of a single-provider conversion
 * (e.g. Revolut) that share the **exact same `accountingDate` timestamp**.
 *
 * This is the drift-proof, bidirectional counterpart to `resolveForeignAnchor`.
 * A conversion emits two `isFxCandidate` rows at the identical instant — one on a
 * EUR account, one on the foreign account, with opposite signs. That covers BOTH
 * directions the anchor scan cannot:
 *   - EUR→foreign ("Conversión a SEK"): EUR leg negative, foreign leg positive.
 *   - foreign→EUR ("Conversión a EUR"): foreign leg negative, EUR leg positive.
 *
 * Because the rate is derived from the actual pair (`|foreign| / |eur|`), it is
 * immune to inter-day rate drift — the failure that left a reverse conversion
 * mis-valued by a stale rate window and its legs unpaired.
 *
 * The conversion is stored NORMALISED (`fromAccount = EUR`, `toAccount = foreign`,
 * rate = foreign-per-EUR) regardless of physical direction, so `propagateRateToAccount`
 * always reads `fromAmount` as the EUR side of the foreign leg. Run BEFORE `rescanWorkspaceConversions` so its exact pairs claim the
 * legs first; the anchor scan then handles only the looser cross-bank leftovers.
 *
 * Skips any transaction already recorded as a conversion leg.
 */
export async function detectFxPairs(workspaceId: string): Promise<CurrencyConversionResult[]> {
	// Transactions already committed as a leg of some conversion — never re-pair them.
	const existingLegs = await db
		.select({
			fromTransactionId: currencyConversions.fromTransactionId,
			toTransactionId: currencyConversions.toTransactionId
		})
		.from(currencyConversions)
		.where(eq(currencyConversions.workspaceId, workspaceId));

	const claimed = new Set<string>();
	for (const leg of existingLegs) {
		if (leg.fromTransactionId) claimed.add(leg.fromTransactionId);
		if (leg.toTransactionId) claimed.add(leg.toTransactionId);
	}

	const candidates = await db
		.select({
			id: transactions.id,
			amount: transactions.amount,
			accountingDate: transactions.accountingDate,
			bankAccountId: transactions.bankAccountId,
			description: transactions.description,
			accountCurrency: bankAccounts.currency,
			accountName: bankAccounts.displayName
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				fxLegSignal,
				// Rows the user opted out of auto-detection never take part in exact pairing.
				eq(transactions.fxDetectionExcluded, false),
				eq(transactions.isOpeningBalance, false)
			)
		)
		.orderBy(asc(transactions.accountingDate));

	// Group unclaimed candidates by exact instant so both legs of one conversion land
	// in the same bucket regardless of which account they came from.
	const byInstant = new Map<number, typeof candidates>();
	for (const c of candidates) {
		if (claimed.has(c.id)) continue;
		const instant = (c.accountingDate as unknown as Date).getTime();
		const bucket = byInstant.get(instant) ?? [];
		bucket.push(c);
		byInstant.set(instant, bucket);
	}

	const results: CurrencyConversionResult[] = [];
	const touchedForeignAccounts = new Set<string>();

	for (const bucket of byInstant.values()) {
		const eurLegs = bucket.filter((c) => c.accountCurrency === PRIMARY_CURRENCY);
		const foreignLegs = bucket.filter((c) => c.accountCurrency !== PRIMARY_CURRENCY);
		if (eurLegs.length === 0 || foreignLegs.length === 0) continue;

		const usedEur = new Set<string>();
		for (const foreign of foreignLegs) {
			const fxAmount = parseFloat(foreign.amount as unknown as string);
			// Pair with the first unused EUR leg of opposite sign at the same instant.
			const eur = eurLegs.find((e) => {
				if (usedEur.has(e.id)) return false;
				const eurAmount = parseFloat(e.amount as unknown as string);
				return eurAmount !== 0 && fxAmount !== 0 && fxAmount > 0 !== eurAmount > 0;
			});
			if (!eur) continue;
			usedEur.add(eur.id);

			const eurAmount = Math.abs(parseFloat(eur.amount as unknown as string));
			const foreignAmount = Math.abs(fxAmount);
			const rate = foreignAmount / eurAmount;
			const effectiveFrom = foreign.accountingDate as unknown as Date;

			const [conversion] = await db
				.insert(currencyConversions)
				.values({
					workspaceId,
					fromAccountId: eur.bankAccountId,
					toAccountId: foreign.bankAccountId,
					fromAmount: eurAmount.toFixed(4),
					toAmount: foreignAmount.toFixed(4),
					exchangeRate: rate.toFixed(6),
					effectiveFrom,
					confidence: 'auto',
					fromTransactionId: eur.id,
					toTransactionId: foreign.id
				})
				.returning({ id: currencyConversions.id });

			await linkConversionLegs(eur.id, foreign.id);
			touchedForeignAccounts.add(foreign.bankAccountId);

			results.push({
				conversionId: conversion.id,
				fromAccountId: eur.bankAccountId,
				toAccountId: foreign.bankAccountId,
				fromTransactionId: eur.id,
				toTransactionId: foreign.id,
				fromAmount: eurAmount,
				toAmount: foreignAmount,
				exchangeRate: rate,
				effectiveFrom,
				affectedTxCount: 0,
				confidence: 'auto',
				fromAccountName: eur.accountName,
				fromTransactionDescription: eur.description,
				toAccountName: foreign.accountName,
				toTransactionDescription: foreign.description
			});
		}
	}

	// Re-value each touched foreign account once, after all its new conversions exist.
	for (const accountId of touchedForeignAccounts) {
		const count = await propagateRateToAccount(accountId);
		for (const r of results) {
			if (r.toAccountId === accountId) r.affectedTxCount = count;
		}
	}

	return results;
}

/**
 * Detect cross-currency conversions across the whole workspace by (re)scanning every
 * UNRESOLVED foreign anchor — not just the rows from the current import.
 *
 * Run on every import, this fixes two #30 failure modes at once:
 *   - **Re-upload / late funder:** detection no longer hinges on a non-empty inserted
 *     batch, so a EUR funder imported after the foreign leg (or a plain re-upload)
 *     still links. This was the production silent-failure: a re-upload dedups to zero
 *     inserts, so the old `insertedIds`-gated detector never ran.
 *   - **Cross-bank funding:** the EUR leg no longer has to be flagged (see
 *     `resolveForeignAnchor`), so funding from a non-Revolut EUR account links.
 *
 * The anchor must be a flagged foreign FX leg (`isFxCandidate`) — the reliable signal
 * a parser emits (e.g. Revolut 'Cambio') — of EITHER sign, so both "Conversión a SEK"
 * (foreign inbound) and "Conversión a EUR" (foreign outbound) resolve. Only the EUR leg
 * is matched loosely. Foreign↔foreign conversions (no EUR leg) are intentionally out of
 * scope.
 */
export async function rescanWorkspaceConversions(
	workspaceId: string
): Promise<CurrencyConversionResult[]> {
	const anchors = await db
		.select({
			id: transactions.id,
			amount: transactions.amount,
			accountingDate: transactions.accountingDate,
			bankAccountId: transactions.bankAccountId,
			description: transactions.description,
			accountName: bankAccounts.displayName,
			accountCurrency: bankAccounts.currency
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				ne(bankAccounts.currency, PRIMARY_CURRENCY),
				fxLegSignal,
				// Not yet a settled conversion leg. (`conversionId` is only a display tag for the
				// rate source and is set on every valued row, so it can't signal "unpaired".)
				isNull(transactions.conversionCounterpartId),
				// Anchors the user opted out of auto-detection are skipped (they link manually).
				eq(transactions.fxDetectionExcluded, false),
				eq(transactions.isOpeningBalance, false)
			)
		)
		// Oldest first so earlier conversions are recorded before later anchors are matched.
		.orderBy(asc(transactions.accountingDate));

	const results: CurrencyConversionResult[] = [];
	for (const anchor of anchors) {
		const result = await resolveForeignAnchor(anchor, workspaceId);
		if (result) results.push(result);
	}
	return results;
}

/** A row of a foreign account, as the cost-basis pass needs it. */
interface PoolRow {
	id: string;
	amount: string;
	status: string;
	accountingDate: Date;
	createdAt: Date;
	originalOrder: number | null;
	csvUploadId: string | null;
}

/** Per-row valuation produced by the cost-basis pass. */
interface Valuation {
	id: string;
	amountEur: number | null;
	exchangeRate: number | null;
	conversionId: string | null;
}

/**
 * Chronological order for a foreign account's rows. Ties on `accountingDate` (manual cash
 * rows carry no time unless the user gives one; bank rows can share an instant) break by
 * `createdAt` — the order the rows entered Clair — then by file position. A CSV batch shares
 * one `createdAt`, so file position only ever decides within one upload, and it is read in
 * that file's own direction (some banks export newest-first).
 */
function sortChronologically(rows: PoolRow[]): PoolRow[] {
	// Per upload: does a higher file index mean a later row?
	const direction = new Map<string, 1 | -1>();
	const byUpload = new Map<string, PoolRow[]>();
	for (const r of rows) {
		if (!r.csvUploadId || r.originalOrder === null) continue;
		const list = byUpload.get(r.csvUploadId) ?? [];
		list.push(r);
		byUpload.set(r.csvUploadId, list);
	}
	for (const [uploadId, list] of byUpload) {
		list.sort((a, b) => (a.originalOrder ?? 0) - (b.originalOrder ?? 0));
		const first = list[0].accountingDate.getTime();
		const last = list[list.length - 1].accountingDate.getTime();
		direction.set(uploadId, first > last ? -1 : 1);
	}
	const filePos = (r: PoolRow) =>
		r.originalOrder === null ? 0 : r.originalOrder * (direction.get(r.csvUploadId ?? '') ?? 1);

	return [...rows].sort(
		(a, b) =>
			a.accountingDate.getTime() - b.accountingDate.getTime() ||
			a.createdAt.getTime() - b.createdAt.getTime() ||
			filePos(a) - filePos(b) ||
			a.id.localeCompare(b.id)
	);
}

/**
 * Moving weighted-average cost basis for one foreign account (#66).
 *
 * The account holds a pool of foreign units with a known EUR cost. Walking the rows in
 * chronological order:
 *   - a **top-up** (the foreign leg of a linked conversion, amount > 0) adds its units at
 *     its real EUR cost (`currency_conversions.fromAmount`);
 *   - an **expense** (or an outbound conversion leg) draws units out at the pool's current
 *     average cost, so spending reflects every top-up still in the pool, in order;
 *   - any **other inflow** (refund, positive opening balance) enters at the current average,
 *     so it never moves the average.
 * When the pool can't cover a row (before the first top-up, or after missing top-ups), the
 * shortfall is valued at the manual fallback rate in effect (`resolve-fx`, a rate-only
 * conversion) if there is one; otherwise the row stays unresolved (`amountEur = null`).
 * Units drawn by an unresolved row still leave the pool — that money is physically gone.
 *
 * Non-posted rows (pending/returned) don't move the pool; they are valued at the current
 * average for display only.
 *
 * Pure: everything is recomputed from scratch, so it is idempotent and order changes
 * anywhere (a top-up inserted between existing expenses) re-value every later row.
 */
export function computeCostBasis(
	rows: PoolRow[],
	topUps: Map<string, { conversionId: string; eurCost: number }>,
	fallbackRates: { conversionId: string; effectiveFrom: string; rate: number }[]
): Valuation[] {
	const ordered = sortChronologically(rows);
	const fallbacks = [...fallbackRates].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

	// Costed pool, full precision. `foreign` counts only units with a known EUR cost.
	let foreign = 0;
	let eur = 0;
	let source: string | null = null; // latest top-up feeding the pool — display only

	const fallbackAt = (d: Date) => {
		const day = toDateStr(d);
		let hit: (typeof fallbacks)[number] | null = null;
		for (const f of fallbacks) if (f.effectiveFrom <= day) hit = f;
		return hit;
	};
	const avgCost = () => (foreign >= FX_POOL_EPSILON ? eur / foreign : null); // EUR per foreign unit
	const rateOf = (amount: number, amountEur: number | null) =>
		amountEur !== null && amountEur !== 0 ? Math.abs(amount) / Math.abs(amountEur) : null;

	const out: Valuation[] = [];
	for (const row of ordered) {
		const amount = parseFloat(row.amount);
		const topUp = topUps.get(row.id);
		const fallback = fallbackAt(row.accountingDate);
		const posted = row.status === 'posted';

		if (amount === 0) {
			const avg = avgCost();
			out.push({
				id: row.id,
				amountEur: 0,
				exchangeRate: avg ? 1 / avg : (fallback?.rate ?? null),
				conversionId: source ?? fallback?.conversionId ?? null
			});
			continue;
		}

		if (!posted) {
			// Display-only valuation; the pool is untouched.
			const avg = avgCost();
			const amountEur = avg !== null ? amount * avg : fallback ? amount / fallback.rate : null;
			out.push({
				id: row.id,
				amountEur,
				exchangeRate: rateOf(amount, amountEur),
				conversionId: amountEur === null ? null : avg !== null ? source : fallback!.conversionId
			});
			continue;
		}

		if (topUp && amount > 0 && topUp.eurCost > 0) {
			foreign += amount;
			eur += topUp.eurCost;
			source = topUp.conversionId;
			out.push({
				id: row.id,
				amountEur: topUp.eurCost,
				exchangeRate: amount / topUp.eurCost,
				conversionId: topUp.conversionId
			});
			continue;
		}

		if (amount > 0) {
			// Other inflow: enters at the current average (rate-neutral).
			const avg = avgCost();
			let amountEur: number | null = null;
			let conversionId: string | null = null;
			if (avg !== null) {
				amountEur = amount * avg;
				conversionId = source;
			} else if (fallback) {
				amountEur = amount / fallback.rate;
				conversionId = fallback.conversionId;
			}
			if (amountEur !== null) {
				foreign += amount;
				eur += amountEur;
			}
			out.push({ id: row.id, amountEur, exchangeRate: rateOf(amount, amountEur), conversionId });
			continue;
		}

		// Expense (or outbound conversion leg): draw from the pool at the average cost.
		const spend = -amount;
		const covered = Math.min(spend, foreign);
		const rawShortfall = spend - covered;
		const shortfall = rawShortfall < FX_POOL_EPSILON ? 0 : rawShortfall;
		const avg = avgCost();
		const coveredEur = covered > 0 && avg !== null ? covered * avg : 0;
		if (covered > 0) {
			foreign -= covered;
			eur -= coveredEur;
			if (foreign < FX_POOL_EPSILON) {
				foreign = 0;
				eur = 0;
			}
		}

		let amountEur: number | null;
		let conversionId: string | null;
		if (shortfall === 0) {
			amountEur = -coveredEur;
			conversionId = source;
		} else if (fallback) {
			amountEur = -(coveredEur + shortfall / fallback.rate);
			conversionId = covered > 0 ? source : fallback.conversionId;
		} else {
			amountEur = null; // no cost basis for part of it → unresolved, never a partial value
			conversionId = null;
		}
		out.push({ id: row.id, amountEur, exchangeRate: rateOf(amount, amountEur), conversionId });
	}
	return out;
}

/**
 * Re-values every row of a foreign-currency account with the moving weighted-average cost
 * basis (`computeCostBasis`), from the conversions recorded for it. Fully recomputed on
 * each call, so it is idempotent and safe to trigger after any change to the account.
 *
 * Returns the number of rows written.
 */
export async function propagateRateToAccount(accountId: string): Promise<number> {
	const [rows, conversions] = await Promise.all([
		db
			.select({
				id: transactions.id,
				amount: transactions.amount,
				status: transactions.status,
				accountingDate: transactions.accountingDate,
				createdAt: transactions.createdAt,
				originalOrder: transactions.originalOrder,
				csvUploadId: transactions.csvUploadId
			})
			.from(transactions)
			.where(eq(transactions.bankAccountId, accountId)),
		db
			.select({
				id: currencyConversions.id,
				fromAmount: currencyConversions.fromAmount,
				exchangeRate: currencyConversions.exchangeRate,
				effectiveFrom: currencyConversions.effectiveFrom,
				toTransactionId: currencyConversions.toTransactionId
			})
			.from(currencyConversions)
			.where(eq(currencyConversions.toAccountId, accountId))
	]);
	if (rows.length === 0) return 0;

	const topUps = new Map<string, { conversionId: string; eurCost: number }>();
	const fallbackRates: { conversionId: string; effectiveFrom: string; rate: number }[] = [];
	for (const c of conversions) {
		if (c.toTransactionId) {
			topUps.set(c.toTransactionId, {
				conversionId: c.id,
				eurCost: parseFloat(c.fromAmount as unknown as string)
			});
		} else {
			// Rate-only conversion (manual `resolve-fx`): a fallback rate, not a top-up.
			const rate = parseFloat(c.exchangeRate as unknown as string);
			if (rate > 0) {
				fallbackRates.push({ conversionId: c.id, effectiveFrom: toDateStr(c.effectiveFrom), rate });
			}
		}
	}

	const valuations = computeCostBasis(
		rows.map((r) => ({
			...r,
			amount: r.amount as unknown as string,
			accountingDate: r.accountingDate as unknown as Date,
			createdAt: r.createdAt as unknown as Date
		})),
		topUps,
		fallbackRates
	);

	for (let i = 0; i < valuations.length; i += FX_REVALUE_BATCH_SIZE) {
		const chunk = valuations.slice(i, i + FX_REVALUE_BATCH_SIZE);
		const values = sql.join(
			chunk.map(
				(v) =>
					sql`(${v.id}::text, ${v.amountEur === null ? null : v.amountEur.toFixed(EUR_AMOUNT_DECIMALS)}::numeric, ${v.exchangeRate === null ? null : v.exchangeRate.toFixed(FX_RATE_DECIMALS)}::numeric, ${v.conversionId}::text)`
			),
			sql`, `
		);
		await db.execute(sql`
			UPDATE ${transactions} AS t
			SET amount_eur = v.amount_eur, exchange_rate = v.exchange_rate, conversion_id = v.conversion_id
			FROM (VALUES ${values}) AS v(id, amount_eur, exchange_rate, conversion_id)
			WHERE t.id = v.id
		`);
	}

	return valuations.length;
}

/**
 * Returns the count of transactions on non-EUR accounts in the workspace
 * that have no EUR value yet (amountEur IS NULL).
 * Used to surface the unresolved FX banner on the accounts page.
 */
export async function countUnresolvedFxTransactions(workspaceId: string): Promise<number> {
	const result = await db
		.select({ count: sql<number>`COUNT(*)::int` })
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				ne(bankAccounts.currency, PRIMARY_CURRENCY),
				isNull(transactions.amountEur),
				eq(transactions.isOpeningBalance, false)
			)
		);

	return result[0]?.count ?? 0;
}

/**
 * Returns the list of non-EUR accounts in the workspace that have unresolved
 * transactions, along with the date range of their unresolved transactions.
 */
export interface UnresolvedFxAccount {
	accountId: string;
	accountName: string;
	currency: string;
	unresolvedCount: number;
	earliestDate: Date;
	latestDate: Date;
}

export async function getUnresolvedFxAccounts(workspaceId: string): Promise<UnresolvedFxAccount[]> {
	const rows = await db
		.select({
			accountId: bankAccounts.id,
			accountName: bankAccounts.displayName,
			currency: bankAccounts.currency,
			unresolvedCount: sql<number>`COUNT(${transactions.id})::int`,
			earliestDate: sql<Date>`MIN(${transactions.accountingDate})`,
			latestDate: sql<Date>`MAX(${transactions.accountingDate})`
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(
				eq(bankAccounts.workspaceId, workspaceId),
				ne(bankAccounts.currency, PRIMARY_CURRENCY),
				isNull(transactions.amountEur),
				eq(transactions.isOpeningBalance, false)
			)
		)
		.groupBy(bankAccounts.id, bankAccounts.displayName, bankAccounts.currency)
		.having(sql`COUNT(${transactions.id}) > 0`);

	return rows.map((r) => ({
		accountId: r.accountId,
		accountName: r.accountName,
		currency: r.currency,
		unresolvedCount: r.unresolvedCount,
		earliestDate: r.earliestDate,
		latestDate: r.latestDate
	}));
}
