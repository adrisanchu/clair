import { error } from '@sveltejs/kit';
import { asc, eq, sql } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db/index.js';
import { categories, costGroups } from '$lib/server/db/schema.js';
import { getAccessibleAccountIds } from '$lib/server/db/access.js';
import {
	queryCategoryBreakdown,
	queryBreakdownTimeSeries,
	type Granularity
} from '$lib/server/db/queries.js';
import {
	buildCategoryBreakdown,
	buildCostGroupDetail,
	buildTimeSeries,
	defaultSelectedSeries,
	rangeStart,
	RANGE_KEYS,
	type CategoryLite,
	type RangeKey
} from '$lib/insights.js';

const GRANULARITIES: Granularity[] = ['week', 'month', 'quarter'];
type Dimension = 'category' | 'costGroup';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) error(401);

	const accessibleIds = await getAccessibleAccountIds(locals.user.id);
	const workspaceId = locals.user.workspaceId;

	// ── Parse URL params (all validated against known unions) ──────────────────
	const range = (RANGE_KEYS as string[]).includes(url.searchParams.get('range') ?? '')
		? (url.searchParams.get('range') as RangeKey)
		: '6m';
	const granularity = GRANULARITIES.includes(url.searchParams.get('g') as Granularity)
		? (url.searchParams.get('g') as Granularity)
		: 'month';
	const dimension: Dimension =
		url.searchParams.get('dim') === 'costGroup' ? 'costGroup' : 'category';
	const seriesParam = url.searchParams.get('series');
	const cgParam = url.searchParams.get('cg');

	const start = rangeStart(range);

	// ── Registries (colors, ordering, hierarchy) ──────────────────────────────
	const [cats, groups] = await Promise.all([
		workspaceId
			? db
					.select()
					.from(categories)
					.where(eq(categories.workspaceId, workspaceId))
					.orderBy(
						sql`COALESCE(${categories.parentId}, ${categories.id})`,
						asc(categories.sortOrder),
						asc(categories.name)
					)
			: Promise.resolve([]),
		workspaceId
			? db
					.select()
					.from(costGroups)
					.where(eq(costGroups.workspaceId, workspaceId))
					.orderBy(asc(costGroups.sortOrder), asc(costGroups.name))
			: Promise.resolve([])
	]);

	const catLite: CategoryLite[] = cats;
	const catColor = new Map(cats.map((c) => [c.name, c.color]));
	const groupColor = new Map(groups.map((g) => [g.name, g.color]));
	const groupNames = groups.map((g) => g.name);

	// Default the cost-group detail to the first group so the list isn't empty on first load.
	const selectedCg = cgParam ?? groupNames[0] ?? null;

	// ── Aggregations (parallel) ────────────────────────────────────────────────
	const [donutSums, tsRows, cgSums] = await Promise.all([
		queryCategoryBreakdown(accessibleIds, { start }),
		queryBreakdownTimeSeries(accessibleIds, dimension, granularity, { start }),
		selectedCg
			? queryCategoryBreakdown(accessibleIds, { start, costGroup: selectedCg })
			: Promise.resolve([])
	]);

	// ── Transforms → final render shapes ───────────────────────────────────────
	const donut = buildCategoryBreakdown(donutSums, catLite);

	const colorFor = (name: string) =>
		(dimension === 'costGroup' ? groupColor.get(name) : catColor.get(name)) ?? '#6b7280';
	const timeline = buildTimeSeries(tsRows, dimension, catLite, colorFor);

	const availableNames = new Set(timeline.series.map((s) => s.name));
	const selectedSeries =
		seriesParam !== null
			? seriesParam.split(',').filter((n) => availableNames.has(n))
			: defaultSelectedSeries(timeline.series);

	const costGroupDetail = buildCostGroupDetail(cgSums, catLite);

	return {
		range,
		granularity,
		dimension,
		donut,
		timeline,
		selectedSeries,
		costGroups: groupNames,
		selectedCostGroup: selectedCg,
		costGroupDetail
	};
};
