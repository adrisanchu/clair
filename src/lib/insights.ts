/**
 * Pure transforms turning raw per-label EUR sums (from `queries.ts`) into the shapes
 * the insights UI renders. Client + server importable (no DB / server-only imports).
 *
 * Conventions across all builders:
 *  - Categories are rolled up to their **top-level** parent (max 1 level of nesting).
 *  - The `Income` category is excluded — the breakdown is about spend.
 *  - Net sums are **sign-flipped** so spend reads positive (raw spend is negative).
 *  - Entries whose flipped amount is ≤ 0 (net inflow) are dropped from donut/list.
 */

import {
	INCOME_CATEGORY,
	UNCATEGORIZED_LABEL,
	TIMELINE_DEFAULT_SERIES
} from '$lib/constants/categories.js';
import type { BreakdownSum, BreakdownTimeSum } from '$lib/server/db/queries.js';

const DEFAULT_COLOR = '#6b7280';

/** Minimal category shape the transforms need (structurally satisfied by DB rows). */
export interface CategoryLite {
	id: string;
	name: string;
	parentId: string | null;
	color: string;
	sortOrder: number;
}

export interface BreakdownEntry {
	name: string;
	color: string;
	amount: number; // positive spend in EUR
	pct: number; // share of the total, 0–100
}

export interface CategoryBreakdown {
	entries: BreakdownEntry[];
	total: number;
}

export interface CostGroupDetailEntry extends BreakdownEntry {
	children: BreakdownEntry[]; // subcategory rows (pct relative to the same total)
}

export interface CostGroupDetail {
	entries: CostGroupDetailEntry[];
	total: number;
}

export interface TimeSeries {
	buckets: string[]; // sorted ISO period starts
	series: SeriesLine[]; // ranked by total spend desc
}

export interface SeriesLine {
	name: string;
	color: string;
	total: number; // total spend across the window (positive)
	points: { bucket: string; value: number }[];
}

interface Resolved {
	topName: string;
	topColor: string;
	topSort: number;
	/** Present only when the label is a subcategory of `topName`. */
	leafName: string | null;
	leafColor: string;
	leafSort: number;
}

function indexCategories(categories: CategoryLite[]) {
	const byName = new Map<string, CategoryLite>();
	const byId = new Map<string, CategoryLite>();
	for (const c of categories) {
		byName.set(c.name, c);
		byId.set(c.id, c);
	}
	return { byName, byId };
}

/** Map an effective label to its top-level category (+ leaf info when it's a subcategory). */
function resolve(
	label: string | null,
	byName: Map<string, CategoryLite>,
	byId: Map<string, CategoryLite>
): Resolved {
	if (label == null) {
		return {
			topName: UNCATEGORIZED_LABEL,
			topColor: DEFAULT_COLOR,
			topSort: Number.MAX_SAFE_INTEGER,
			leafName: null,
			leafColor: DEFAULT_COLOR,
			leafSort: 0
		};
	}
	const rec = byName.get(label);
	if (!rec) {
		// Label with no matching category row — surface it under its own name.
		return {
			topName: label,
			topColor: DEFAULT_COLOR,
			topSort: Number.MAX_SAFE_INTEGER - 1,
			leafName: null,
			leafColor: DEFAULT_COLOR,
			leafSort: 0
		};
	}
	if (rec.parentId) {
		const parent = byId.get(rec.parentId);
		if (parent) {
			return {
				topName: parent.name,
				topColor: parent.color,
				topSort: parent.sortOrder,
				leafName: rec.name,
				leafColor: rec.color,
				leafSort: rec.sortOrder
			};
		}
	}
	return {
		topName: rec.name,
		topColor: rec.color,
		topSort: rec.sortOrder,
		leafName: null,
		leafColor: rec.color,
		leafSort: rec.sortOrder
	};
}

/**
 * Roll raw category sums up to top-level, drop income + net-inflow buckets, flip sign,
 * and rank by the category `sortOrder` (the display order). Powers the donut.
 */
export function buildCategoryBreakdown(
	sums: BreakdownSum[],
	categories: CategoryLite[]
): CategoryBreakdown {
	const { byName, byId } = indexCategories(categories);
	const acc = new Map<string, { color: string; sort: number; net: number }>();

	for (const { label, net } of sums) {
		const r = resolve(label, byName, byId);
		if (r.topName === INCOME_CATEGORY) continue;
		const cur = acc.get(r.topName) ?? { color: r.topColor, sort: r.topSort, net: 0 };
		cur.net += net;
		acc.set(r.topName, cur);
	}

	const entries = [...acc.entries()]
		.map(([name, v]) => ({ name, color: v.color, sort: v.sort, amount: -v.net }))
		.filter((e) => e.amount > 0)
		.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

	const total = entries.reduce((s, e) => s + e.amount, 0);
	return {
		total,
		entries: entries.map((e) => ({
			name: e.name,
			color: e.color,
			amount: e.amount,
			pct: total > 0 ? (e.amount / total) * 100 : 0
		}))
	};
}

/**
 * Like {@link buildCategoryBreakdown} but keeps the subcategory hierarchy: each top-level
 * row carries a `children` array (subcategory spend). Child `pct` is relative to the same
 * grand total, so a parent's children sum to at most the parent (direct-to-parent spend
 * has no child row). Powers the expandable cost-group detail list.
 */
export function buildCostGroupDetail(
	sums: BreakdownSum[],
	categories: CategoryLite[]
): CostGroupDetail {
	const { byName, byId } = indexCategories(categories);
	interface Top {
		color: string;
		sort: number;
		net: number;
		children: Map<string, { color: string; sort: number; net: number }>;
	}
	const acc = new Map<string, Top>();

	for (const { label, net } of sums) {
		const r = resolve(label, byName, byId);
		if (r.topName === INCOME_CATEGORY) continue;
		const top = acc.get(r.topName) ?? {
			color: r.topColor,
			sort: r.topSort,
			net: 0,
			children: new Map()
		};
		top.net += net;
		if (r.leafName) {
			const child = top.children.get(r.leafName) ?? {
				color: r.leafColor,
				sort: r.leafSort,
				net: 0
			};
			child.net += net;
			top.children.set(r.leafName, child);
		}
		acc.set(r.topName, top);
	}

	const tops = [...acc.entries()]
		.map(([name, v]) => ({ name, ...v, amount: -v.net }))
		.filter((e) => e.amount > 0)
		.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

	const total = tops.reduce((s, e) => s + e.amount, 0);
	const pctOf = (amount: number) => (total > 0 ? (amount / total) * 100 : 0);

	return {
		total,
		entries: tops.map((t) => ({
			name: t.name,
			color: t.color,
			amount: t.amount,
			pct: pctOf(t.amount),
			children: [...t.children.entries()]
				.map(([name, c]) => ({ name, color: c.color, sort: c.sort, amount: -c.net }))
				.filter((c) => c.amount > 0)
				.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))
				.map((c) => ({ name: c.name, color: c.color, amount: c.amount, pct: pctOf(c.amount) }))
		}))
	};
}

/**
 * Pivot time-bucketed sums into per-series lines. For `category` the series key is the
 * top-level parent (income excluded); for `costGroup` it is the group label. Values are
 * sign-flipped spend; series are ranked by total spend descending.
 *
 * @param colorFor resolves a series name to its stored color (falls back to gray).
 */
export function buildTimeSeries(
	rows: BreakdownTimeSum[],
	dimension: 'category' | 'costGroup',
	categories: CategoryLite[],
	colorFor: (name: string) => string
): TimeSeries {
	const { byName, byId } = indexCategories(categories);
	const bucketSet = new Set<string>();
	// name -> bucket -> summed net
	const acc = new Map<string, Map<string, number>>();

	for (const { bucket, label, net } of rows) {
		bucketSet.add(bucket);
		let name: string;
		if (dimension === 'costGroup') {
			if (label == null) continue; // unassigned rows aren't a cost-group series
			name = label;
		} else {
			const r = resolve(label, byName, byId);
			if (r.topName === INCOME_CATEGORY) continue;
			name = r.topName;
		}
		const byBucket = acc.get(name) ?? new Map<string, number>();
		byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + net);
		acc.set(name, byBucket);
	}

	const buckets = [...bucketSet].sort();

	const series: SeriesLine[] = [...acc.entries()]
		.map(([name, byBucket]) => {
			const points = buckets.map((b) => ({ bucket: b, value: -(byBucket.get(b) ?? 0) }));
			const total = points.reduce((s, p) => s + p.value, 0);
			return { name, color: colorFor(name), total, points };
		})
		.sort((a, b) => b.total - a.total);

	return { buckets, series };
}

/** Default timeline selection: the top-N series by total spend. */
export function defaultSelectedSeries(series: SeriesLine[]): string[] {
	return series.slice(0, TIMELINE_DEFAULT_SERIES).map((s) => s.name);
}

// ---------------------------------------------------------------------------
// Date-range window (shared by the server load + the RangeSelector component)
// ---------------------------------------------------------------------------

export type RangeKey = '3m' | '6m' | 'ytd' | '1y' | 'all';

export const RANGE_KEYS: RangeKey[] = ['3m', '6m', 'ytd', '1y', 'all'];

/** Resolve a range key to a start date (undefined = no lower bound, i.e. "all time"). */
export function rangeStart(range: RangeKey, now: Date = new Date()): Date | undefined {
	const d = new Date(now);
	switch (range) {
		case '3m':
			d.setMonth(d.getMonth() - 3);
			return d;
		case '6m':
			d.setMonth(d.getMonth() - 6);
			return d;
		case 'ytd':
			return new Date(now.getFullYear(), 0, 1);
		case '1y':
			d.setFullYear(d.getFullYear() - 1);
			return d;
		case 'all':
			return undefined;
	}
}
