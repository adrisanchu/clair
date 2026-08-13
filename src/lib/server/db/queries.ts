import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from './index.js';
import { transactions, bankAccounts, currencyConversions } from './schema.js';
import { PRIMARY_CURRENCY } from '$lib/currencies.js';

export const TX_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Rolling balance query
// ---------------------------------------------------------------------------

export type Granularity = 'week' | 'month' | 'quarter';

export interface BalancePoint {
	bucket: string; // ISO date string — start of the period bucket
	netChange: number;
	cumulativeBalance: number;
}

export interface RollingBalanceResult {
	points: BalancePoint[];
	windowStart: string; // ISO string — serialisable across SSR boundary
	windowEnd: string;
}

export async function queryRollingBalance(
	accessibleIds: string[],
	granularity: Granularity = 'month'
): Promise<RollingBalanceResult> {
	const now = new Date();
	const windowEnd = now.toISOString();

	const threeMonthsAgo = new Date(now);
	threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

	// Find the earliest posted non-transfer non-opening-balance transaction
	const [earliest] = await db
		.select({ minDate: sql<string>`MIN(${transactions.accountingDate})::text` })
		.from(transactions)
		.where(
			and(
				inArray(transactions.bankAccountId, accessibleIds),
				eq(transactions.isTransfer, false),
				eq(transactions.isOpeningBalance, false),
				eq(transactions.status, 'posted')
			)
		);

	if (!earliest?.minDate) {
		return { points: [], windowStart: threeMonthsAgo.toISOString(), windowEnd };
	}

	const earliestDate = new Date(earliest.minDate);
	const windowStart = earliestDate < threeMonthsAgo ? threeMonthsAgo : earliestDate;

	// safe — granularity is a validated union type, never user-controlled input
	const unit = sql.raw(`'${granularity}'`);
	const bucketExpr = sql<string>`DATE_TRUNC(${unit}, ${transactions.accountingDate}::timestamp)::date::text`;

	const buckets = await db
		.select({
			bucket: bucketExpr,
			netChange: sql<string>`SUM(CASE WHEN ${transactions.currency} = ${PRIMARY_CURRENCY} THEN ${transactions.amount}::numeric ELSE ${transactions.amountEur}::numeric END)`
		})
		.from(transactions)
		.where(
			and(
				inArray(transactions.bankAccountId, accessibleIds),
				eq(transactions.isTransfer, false),
				eq(transactions.isOpeningBalance, false),
				eq(transactions.status, 'posted'),
				gte(transactions.accountingDate, windowStart)
			)
		)
		.groupBy(bucketExpr)
		.orderBy(bucketExpr);

	// Compute running cumulative sum in JS — dataset is tiny (≤52 weekly buckets)
	let running = 0;
	const points: BalancePoint[] = buckets.map((b) => {
		running += parseFloat(b.netChange ?? '0');
		return {
			bucket: b.bucket,
			netChange: parseFloat(b.netChange ?? '0'),
			cumulativeBalance: running
		};
	});

	return { points, windowStart: windowStart.toISOString(), windowEnd };
}

export type TxFilter = 'all' | 'expenses' | 'transfers' | 'review';

export interface TxQueryParams {
	accessibleIds: string[];
	q?: string;
	accountId?: string;
	filter?: TxFilter;
	page?: number;
}

export interface TxRow {
	id: string;
	accountingDate: Date;
	description: string;
	amount: number; // net (gross − fee)
	fee: number; // fee portion, non-negative, in `currency`
	currency: string;
	amountEur: number | null;
	exchangeRate: number | null;
	conversionId: string | null;
	status: 'pending' | 'posted' | 'review' | 'reverted';
	isTransfer: boolean;
	transferCounterpartId: string | null;
	isFxCandidate: boolean;
	isOpeningBalance: boolean;
	notes: string | null;
	category: string | null; // raw bank-file value
	categoryAI: string | null; // AI guess
	categoryOverride: string | null; // human decision
	bankAccountId: string;
	accountName: string | null;
	bankProfileId: string | null;
}

export interface TxQueryResult {
	rows: TxRow[];
	total: number;
	counts: { all: number; expenses: number; transfers: number; review: number };
	page: number;
	limit: number;
}

// ---------------------------------------------------------------------------
// Export query (no pagination) — round-trip-safe subset for CSV download
// ---------------------------------------------------------------------------

export interface ExportTxRow {
	id: string; // internal transaction id — emitted as the optional Id column for exact round-trip
	accountingDate: Date;
	amount: number;
	description: string;
	currency: string;
	accountName: string | null;
	category: string | null; // raw bank-file value
	categoryAI: string | null; // AI guess
	categoryOverride: string | null; // human decision (takes precedence on export)
	isTransfer: boolean; // transfer facet — emitted as the Type column, orthogonal to category
	notes: string | null;
	city: string | null;
}

/**
 * Fetch every accessible transaction for CSV export.
 *
 * No pagination. Ordered accountingDate ASC then originalOrder ASC so a re-import
 * lands rows in their original file sequence. Opening-balance rows are synthetic
 * and excluded — they are not real transactions and would re-import oddly.
 *
 * @param accessibleIds account IDs the user may view (from getFullAccessAccountIds)
 * @param accountIds optional subset to export; ignored entries outside accessibleIds
 */
export async function queryTransactionsForExport(
	accessibleIds: string[],
	accountIds?: string[]
): Promise<ExportTxRow[]> {
	if (accessibleIds.length === 0) return [];

	// Intersect the requested subset with what the user is actually allowed to see.
	const requested = accountIds?.length
		? accountIds.filter((id) => accessibleIds.includes(id))
		: accessibleIds;
	if (requested.length === 0) return [];

	const rows = await db
		.select({
			id: transactions.id,
			accountingDate: transactions.accountingDate,
			amount: transactions.amount,
			description: transactions.description,
			currency: transactions.currency,
			accountName: bankAccounts.displayName,
			category: transactions.category,
			categoryAI: transactions.categoryAI,
			categoryOverride: transactions.categoryOverride,
			isTransfer: transactions.isTransfer,
			notes: transactions.notes,
			city: transactions.city
		})
		.from(transactions)
		.leftJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(inArray(transactions.bankAccountId, requested), eq(transactions.isOpeningBalance, false))
		)
		.orderBy(asc(transactions.accountingDate), asc(transactions.originalOrder));

	return rows.map((r) => ({
		...r,
		amount: parseFloat(r.amount as string)
	}));
}

export async function queryTransactions(params: TxQueryParams): Promise<TxQueryResult> {
	const { accessibleIds, q = '', accountId = '', filter = 'all', page = 1 } = params;
	const limit = TX_PAGE_SIZE;
	const offset = (page - 1) * limit;

	if (accessibleIds.length === 0) {
		return {
			rows: [],
			total: 0,
			counts: { all: 0, expenses: 0, transfers: 0, review: 0 },
			page: 1,
			limit
		};
	}

	const baseWhere = and(inArray(transactions.bankAccountId, accessibleIds));

	// Opening balance is only visible in the 'all' tab.
	// For 'expenses' we must explicitly exclude it (it could have a negative amount).
	// For 'transfers' and 'review' it is naturally excluded by those conditions.
	const filterCondition =
		filter === 'expenses'
			? and(
					sql`${transactions.amount}::numeric < 0`,
					eq(transactions.isTransfer, false),
					eq(transactions.isOpeningBalance, false),
					eq(transactions.status, 'posted')
				)
			: filter === 'transfers'
				? eq(transactions.isTransfer, true)
				: filter === 'review'
					? eq(transactions.status, 'review')
					: undefined;

	const searchCondition = q.trim() ? ilike(transactions.description, `%${q.trim()}%`) : undefined;
	const accountCondition = accountId ? eq(transactions.bankAccountId, accountId) : undefined;

	const fullWhere = and(baseWhere, filterCondition, searchCondition, accountCondition);
	const countWhere = and(baseWhere, searchCondition, accountCondition);

	const [rows, countsResult] = await Promise.all([
		db
			.select({
				id: transactions.id,
				accountingDate: transactions.accountingDate,
				description: transactions.description,
				amount: transactions.amount,
				fee: transactions.fee,
				currency: transactions.currency,
				amountEur: transactions.amountEur,
				exchangeRate: transactions.exchangeRate,
				conversionId: transactions.conversionId,
				status: transactions.status,
				isTransfer: transactions.isTransfer,
				transferCounterpartId: transactions.transferCounterpartId,
				isFxCandidate: transactions.isFxCandidate,
				isOpeningBalance: transactions.isOpeningBalance,
				notes: transactions.notes,
				category: transactions.category,
				categoryAI: transactions.categoryAI,
				categoryOverride: transactions.categoryOverride,
				bankAccountId: transactions.bankAccountId,
				accountName: bankAccounts.displayName,
				bankProfileId: bankAccounts.bankProfileId
			})
			.from(transactions)
			.leftJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
			.where(fullWhere)
			.orderBy(desc(transactions.accountingDate), desc(transactions.createdAt))
			.limit(limit)
			.offset(offset),

		db
			.select({
				// Tab badge counts never include the opening balance row
				all: sql<number>`COUNT(*) FILTER (WHERE NOT ${transactions.isOpeningBalance})::int`,
				allWithOpening: sql<number>`COUNT(*)::int`,
				expenses: sql<number>`COUNT(*) FILTER (WHERE ${transactions.amount}::numeric < 0 AND NOT ${transactions.isTransfer} AND NOT ${transactions.isOpeningBalance} AND ${transactions.status} = 'posted')::int`,
				transfers: sql<number>`COUNT(*) FILTER (WHERE ${transactions.isTransfer})::int`,
				review: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'review')::int`
			})
			.from(transactions)
			.where(countWhere)
	]);

	const counts = {
		all: countsResult[0]?.all ?? 0,
		expenses: countsResult[0]?.expenses ?? 0,
		transfers: countsResult[0]?.transfers ?? 0,
		review: countsResult[0]?.review ?? 0
	};

	// For 'all', use allWithOpening so pagination math is accurate when the
	// opening balance row is visible in the table.
	const total =
		filter === 'all'
			? (countsResult[0]?.allWithOpening ?? 0)
			: filter === 'expenses'
				? counts.expenses
				: filter === 'transfers'
					? counts.transfers
					: counts.review;

	return {
		rows: rows.map((r) => ({
			...r,
			amount: parseFloat(r.amount as string),
			fee: parseFloat(r.fee as string),
			amountEur:
				r.currency === PRIMARY_CURRENCY
					? parseFloat(r.amount as string)
					: r.amountEur != null
						? parseFloat(r.amountEur as string)
						: null,
			exchangeRate: r.exchangeRate != null ? parseFloat(r.exchangeRate as string) : null,
			status: r.status as 'pending' | 'posted' | 'review' | 'reverted',
			isOpeningBalance: r.isOpeningBalance ?? false
		})),
		total,
		counts,
		page,
		limit
	};
}

// ---------------------------------------------------------------------------
// Transfer / conversion pairs — for the /transfers visualizer and reconciliation
// ---------------------------------------------------------------------------

/**
 * One leg of a related pair (a transfer counterpart or a conversion leg).
 * `amountEur` is normalised the same way the ledger does: EUR rows report their
 * own amount, foreign rows report the stored `amountEur` (may be null).
 */
export interface TxLeg {
	id: string;
	description: string;
	accountingDate: Date;
	amount: number;
	currency: string;
	amountEur: number | null;
	bankAccountId: string;
	accountName: string | null;
}

/**
 * A settled relationship. `out` is the money-out leg (negative), `in` the
 * money-in leg (positive), regardless of how the underlying record is oriented.
 */
export interface TransferPair {
	kind: 'transfer' | 'conversion';
	conversionId: string | null;
	exchangeRate: number | null; // foreign-per-EUR, conversions only
	confidence: 'auto' | 'confirmed' | 'manual' | null;
	out: TxLeg;
	in: TxLeg;
}

/**
 * An unsettled transfer/FX candidate that HAS at least one plausible counterpart
 * in another accessible account — i.e. actually reconcilable (not an external P2P
 * transfer with no in-app match). `kind` distinguishes a same-currency transfer
 * from a cross-currency FX candidate.
 */
export interface OrphanTransfer {
	tx: TxLeg;
	kind: 'transfer' | 'conversion';
	candidateCount: number;
}

export interface TransferPairsResult {
	settled: TransferPair[];
	orphans: OrphanTransfer[];
}

interface RawLeg {
	id: string;
	description: string;
	accountingDate: Date;
	amount: string;
	currency: string;
	amountEur: string | null;
	accountCurrency: string;
	bankAccountId: string;
	accountName: string | null;
	isTransfer: boolean;
	transferCounterpartId: string | null;
	isFxCandidate: boolean;
	isOpeningBalance: boolean;
}

function toLeg(r: RawLeg): TxLeg {
	return {
		id: r.id,
		description: r.description,
		accountingDate: r.accountingDate as unknown as Date,
		amount: parseFloat(r.amount),
		currency: r.currency,
		amountEur:
			r.currency === PRIMARY_CURRENCY
				? parseFloat(r.amount)
				: r.amountEur != null
					? parseFloat(r.amountEur)
					: null,
		bankAccountId: r.bankAccountId,
		accountName: r.accountName
	};
}

/** Whole-day difference between two dates, ignoring time-of-day. */
function dayDiff(a: Date, b: Date): number {
	const ms = Math.abs(
		Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
			Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
	);
	return Math.round(ms / 86_400_000);
}

async function fetchAccessibleLegs(accessibleIds: string[]): Promise<RawLeg[]> {
	if (accessibleIds.length === 0) return [];
	return db
		.select({
			id: transactions.id,
			description: transactions.description,
			accountingDate: transactions.accountingDate,
			amount: transactions.amount,
			currency: transactions.currency,
			amountEur: transactions.amountEur,
			accountCurrency: bankAccounts.currency,
			bankAccountId: transactions.bankAccountId,
			accountName: bankAccounts.displayName,
			isTransfer: transactions.isTransfer,
			transferCounterpartId: transactions.transferCounterpartId,
			isFxCandidate: transactions.isFxCandidate,
			isOpeningBalance: transactions.isOpeningBalance
		})
		.from(transactions)
		.innerJoin(bankAccounts, eq(transactions.bankAccountId, bankAccounts.id))
		.where(
			and(inArray(transactions.bankAccountId, accessibleIds), eq(transactions.isOpeningBalance, false))
		) as unknown as Promise<RawLeg[]>;
}

/**
 * Orphans that are actually reconcilable — each has ≥1 plausible counterpart in a
 * different accessible account. Powers the dashboard "needs attention" surface and
 * the /transfers attention filter. Runs entirely in memory (two-user scale).
 */
export async function findActionableOrphans(accessibleIds: string[]): Promise<OrphanTransfer[]> {
	if (accessibleIds.length === 0) return [];

	const [legs, convLegs] = await Promise.all([
		fetchAccessibleLegs(accessibleIds),
		db
			.select({
				fromTransactionId: currencyConversions.fromTransactionId,
				toTransactionId: currencyConversions.toTransactionId
			})
			.from(currencyConversions)
	]);

	const claimed = new Set<string>();
	for (const c of convLegs) {
		if (c.fromTransactionId) claimed.add(c.fromTransactionId);
		if (c.toTransactionId) claimed.add(c.toTransactionId);
	}

	const parsed = legs.map((r) => ({ raw: r, amount: parseFloat(r.amount) }));
	const orphans: OrphanTransfer[] = [];

	for (const { raw, amount } of parsed) {
		const isFxOrphan = raw.isFxCandidate && !claimed.has(raw.id);
		const isTransferOrphan = raw.isTransfer && raw.transferCounterpartId === null;
		if (!isFxOrphan && !isTransferOrphan) continue;

		const date = raw.accountingDate as unknown as Date;
		let candidateCount = 0;

		if (isFxOrphan) {
			// Cross-currency counterpart: opposite sign, opposite currency-class, ±3 days,
			// itself an unclaimed FX candidate in another account.
			const selfPrimary = raw.accountCurrency === PRIMARY_CURRENCY;
			candidateCount = parsed.filter(({ raw: c, amount: ca }) => {
				if (c.id === raw.id || c.bankAccountId === raw.bankAccountId) return false;
				if (!c.isFxCandidate || claimed.has(c.id)) return false;
				if (ca > 0 === amount > 0 || ca === 0 || amount === 0) return false;
				if ((c.accountCurrency === PRIMARY_CURRENCY) === selfPrimary) return false;
				return dayDiff(date, c.accountingDate as unknown as Date) <= 3;
			}).length;
		} else {
			// Same-currency transfer counterpart: mirror amount, opposite sign, ±3 days, unlinked.
			candidateCount = parsed.filter(({ raw: c, amount: ca }) => {
				if (c.id === raw.id || c.bankAccountId === raw.bankAccountId) return false;
				if (c.transferCounterpartId !== null) return false;
				if (c.currency !== raw.currency) return false;
				if (Math.abs(ca) !== Math.abs(amount) || ca > 0 === amount > 0) return false;
				return dayDiff(date, c.accountingDate as unknown as Date) <= 3;
			}).length;
		}

		if (candidateCount > 0) {
			orphans.push({ tx: toLeg(raw), kind: isFxOrphan ? 'conversion' : 'transfer', candidateCount });
		}
	}

	// Most recent first.
	orphans.sort((a, b) => b.tx.accountingDate.getTime() - a.tx.accountingDate.getTime());
	return orphans;
}

/**
 * Full dataset for the /transfers page: every settled pair (same-currency transfers
 * + cross-currency conversions) plus the actionable orphans. Genuine pairs are read
 * from `transfer_counterpart_id` and `currency_conversions.from/to_transaction_id` —
 * never from `transactions.conversion_id`, which is an overloaded rate-window tag.
 */
export async function queryTransferPairs(accessibleIds: string[]): Promise<TransferPairsResult> {
	if (accessibleIds.length === 0) return { settled: [], orphans: [] };

	const [legs, conversions, orphans] = await Promise.all([
		fetchAccessibleLegs(accessibleIds),
		db
			.select()
			.from(currencyConversions)
			.where(
				and(
					isNotNull(currencyConversions.fromTransactionId),
					isNotNull(currencyConversions.toTransactionId)
				)
			),
		findActionableOrphans(accessibleIds)
	]);

	const byId = new Map<string, RawLeg>(legs.map((l) => [l.id, l]));
	const orient = (a: TxLeg, b: TxLeg): { out: TxLeg; in: TxLeg } =>
		a.amount <= 0 ? { out: a, in: b } : { out: b, in: a };

	const settled: TransferPair[] = [];

	// Conversion pairs.
	for (const conv of conversions) {
		const from = conv.fromTransactionId ? byId.get(conv.fromTransactionId) : undefined;
		const to = conv.toTransactionId ? byId.get(conv.toTransactionId) : undefined;
		if (!from || !to) continue; // a leg outside the user's accessible accounts
		settled.push({
			kind: 'conversion',
			conversionId: conv.id,
			exchangeRate: parseFloat(conv.exchangeRate as unknown as string),
			confidence: conv.confidence as 'auto' | 'confirmed' | 'manual',
			...orient(toLeg(from), toLeg(to))
		});
	}

	// Same-currency transfer pairs (dedup the A↔B mirror by keeping id < counterpart).
	for (const leg of legs) {
		const cp = leg.transferCounterpartId;
		if (!cp || leg.id >= cp) continue;
		const counterpart = byId.get(cp);
		if (!counterpart) continue;
		settled.push({
			kind: 'transfer',
			conversionId: null,
			exchangeRate: null,
			confidence: null,
			...orient(toLeg(leg), toLeg(counterpart))
		});
	}

	settled.sort((a, b) => b.out.accountingDate.getTime() - a.out.accountingDate.getTime());
	return { settled, orphans };
}

export interface TransferCandidateItem extends TxLeg {
	crossCurrency: boolean;
	impliedRate: number | null; // foreign-per-EUR, cross-currency candidates only
	daysDiff: number;
}

export interface TransferCandidatesResult {
	source: TxLeg | null;
	mode: 'transfer' | 'conversion';
	/** Set when the source is already linked — the dialog shows the pair instead of candidates. */
	settled: TransferPair | null;
	candidates: TransferCandidateItem[];
}

/**
 * Everything the pairing dialog needs for `txId` in one round-trip: the settled pair
 * if already linked, otherwise the candidate counterparts. Mode is inferred from the
 * source — an FX candidate looks for a cross-currency, opposite-sign leg (→ create a
 * conversion); anything else looks for a same-currency mirror amount (→ link-transfer).
 * Window is a generous ±7 days for manual reconciliation.
 */
export async function queryTransferCandidates(
	accessibleIds: string[],
	txId: string
): Promise<TransferCandidatesResult> {
	if (accessibleIds.length === 0)
		return { source: null, mode: 'transfer', settled: null, candidates: [] };

	const [legs, conversions] = await Promise.all([
		fetchAccessibleLegs(accessibleIds),
		db.select().from(currencyConversions)
	]);

	const source = legs.find((l) => l.id === txId);
	if (!source) return { source: null, mode: 'transfer', settled: null, candidates: [] };

	const byId = new Map<string, RawLeg>(legs.map((l) => [l.id, l]));
	const orient = (a: TxLeg, b: TxLeg): { out: TxLeg; in: TxLeg } =>
		a.amount <= 0 ? { out: a, in: b } : { out: b, in: a };

	const claimed = new Set<string>();
	for (const c of conversions) {
		if (c.fromTransactionId) claimed.add(c.fromTransactionId);
		if (c.toTransactionId) claimed.add(c.toTransactionId);
	}

	// Already linked? Return the pair and skip candidate search.
	const asConvLeg = conversions.find(
		(c) => c.fromTransactionId === txId || c.toTransactionId === txId
	);
	if (asConvLeg) {
		const from = asConvLeg.fromTransactionId ? byId.get(asConvLeg.fromTransactionId) : undefined;
		const to = asConvLeg.toTransactionId ? byId.get(asConvLeg.toTransactionId) : undefined;
		if (from && to) {
			return {
				source: toLeg(source),
				mode: 'conversion',
				settled: {
					kind: 'conversion',
					conversionId: asConvLeg.id,
					exchangeRate: parseFloat(asConvLeg.exchangeRate as unknown as string),
					confidence: asConvLeg.confidence as 'auto' | 'confirmed' | 'manual',
					...orient(toLeg(from), toLeg(to))
				},
				candidates: []
			};
		}
	}
	if (source.transferCounterpartId) {
		const counterpart = byId.get(source.transferCounterpartId);
		if (counterpart) {
			return {
				source: toLeg(source),
				mode: 'transfer',
				settled: {
					kind: 'transfer',
					conversionId: null,
					exchangeRate: null,
					confidence: null,
					...orient(toLeg(source), toLeg(counterpart))
				},
				candidates: []
			};
		}
	}

	const srcAmount = parseFloat(source.amount);
	const srcDate = source.accountingDate as unknown as Date;
	const srcPrimary = source.accountCurrency === PRIMARY_CURRENCY;
	const mode: 'transfer' | 'conversion' = source.isFxCandidate ? 'conversion' : 'transfer';

	const candidates: TransferCandidateItem[] = [];
	for (const c of legs) {
		if (c.id === source.id || c.bankAccountId === source.bankAccountId) continue;
		const cAmount = parseFloat(c.amount);
		if (cAmount === 0 || srcAmount === 0 || cAmount > 0 === srcAmount > 0) continue; // opposite sign
		const days = dayDiff(srcDate, c.accountingDate as unknown as Date);
		if (days > 7) continue;

		if (mode === 'conversion') {
			if (!c.isFxCandidate || claimed.has(c.id)) continue;
			if ((c.accountCurrency === PRIMARY_CURRENCY) === srcPrimary) continue; // must be opposite class
			const eurAmt = srcPrimary ? Math.abs(srcAmount) : Math.abs(cAmount);
			const foreignAmt = srcPrimary ? Math.abs(cAmount) : Math.abs(srcAmount);
			candidates.push({
				...toLeg(c),
				crossCurrency: true,
				impliedRate: eurAmt > 0 ? foreignAmt / eurAmt : null,
				daysDiff: days
			});
		} else {
			if (c.transferCounterpartId !== null) continue;
			if (c.currency !== source.currency) continue;
			if (Math.abs(cAmount) !== Math.abs(srcAmount)) continue;
			candidates.push({ ...toLeg(c), crossCurrency: false, impliedRate: null, daysDiff: days });
		}
	}

	candidates.sort((a, b) => a.daysDiff - b.daysDiff);
	return { source: toLeg(source), mode, settled: null, candidates };
}
