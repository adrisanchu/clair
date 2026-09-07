<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { BarChart2 } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import GranularitySelector from '$lib/components/GranularitySelector.svelte';
	import CategoryDonut from '$lib/components/insights/CategoryDonut.svelte';
	import CategoryTimeSeriesChart from '$lib/components/insights/CategoryTimeSeriesChart.svelte';
	import SeriesPicker from '$lib/components/insights/SeriesPicker.svelte';
	import CostGroupBreakdownList from '$lib/components/insights/CostGroupBreakdownList.svelte';
	import DimensionToggle from '$lib/components/insights/DimensionToggle.svelte';
	import RangeSelector from '$lib/components/insights/RangeSelector.svelte';
	import type { RangeKey } from '$lib/insights.js';
	import type { Granularity } from '$lib/server/db/queries.js';
	import type { PageData } from './$types';

	type Dimension = 'category' | 'costGroup';

	let { data }: { data: PageData } = $props();

	// Series actually plotted = selection ∩ available (order preserved by rank).
	const selectedSet = $derived(new Set(data.selectedSeries));
	const shownSeries = $derived(data.timeline.series.filter((s) => selectedSet.has(s.name)));

	const hasData = $derived(data.donut.total > 0 || data.timeline.series.length > 0);

	// ── URL-param navigation ────────────────────────────────────────────────────
	function navigate(params: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [k, v] of Object.entries(params)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		// noScroll keeps the viewport where it is — filters live mid-page, so the default
		// scroll-to-top on navigation would yank the user away from what they were viewing.
		goto(url.toString(), { keepFocus: true, replaceState: true, noScroll: true });
	}

	const setRange = (r: RangeKey) => navigate({ range: r });
	const setGranularity = (g: Granularity) => navigate({ g });
	// Changing the dimension invalidates the series selection (names differ) → reset it.
	const setDimension = (d: Dimension) => navigate({ dim: d, series: null });
	const setCostGroup = (name: string) => navigate({ cg: name });

	function setSeries(names: string[]) {
		// Set explicitly (even when empty) so "none selected" is distinct from the default.
		navigate({ series: names.join(',') });
	}
</script>

<div class="max-w-6xl px-4 py-6 md:px-8 md:py-8">
	<!-- Page header -->
	<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
		<div>
			<p class="mb-1 text-xs font-semibold tracking-widest text-text-tertiary uppercase">Reports</p>
			<h1 class="text-2xl font-semibold text-text-primary">Insights</h1>
		</div>
		<RangeSelector value={data.range} onchange={setRange} />
	</div>

	{#if !hasData}
		<EmptyState
			icon={BarChart2}
			title="No spending to show yet"
			description="Upload transactions and assign categories to see your breakdown here."
		/>
	{:else}
		<!-- Donut: spending by category -->
		<div class="mb-8">
			<Card.Root class="border-border bg-surface shadow-sm">
				<Card.Header class="border-b">
					<Card.Title>Spending by category</Card.Title>
					<Card.Description>
						Net spend per top-level category over the selected period.
					</Card.Description>
				</Card.Header>
				<Card.Content class="pt-6">
					{#if data.donut.entries.length > 0}
						<CategoryDonut breakdown={data.donut} />
					{:else}
						<EmptyState
							icon={BarChart2}
							title="No spending in this period"
							description="Try a wider date range."
							compact
						/>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Timeline: categories / cost groups over time -->
		<div class="mb-8">
			<Card.Root class="border-border bg-surface shadow-sm">
				<Card.Header class="flex flex-row flex-wrap items-center gap-2 space-y-0 border-b">
					<div class="grid flex-1 gap-1 text-start">
						<Card.Title>Trend over time</Card.Title>
						<Card.Description
							>Spending by {data.dimension === 'costGroup' ? 'cost group' : 'category'} per period.</Card.Description
						>
					</div>
					<DimensionToggle value={data.dimension} onchange={setDimension} />
					<GranularitySelector value={data.granularity} onchange={setGranularity} />
				</Card.Header>
				<Card.Content class="space-y-4 pt-4">
					{#if data.timeline.series.length > 0}
						<SeriesPicker
							series={data.timeline.series}
							selected={data.selectedSeries}
							onchange={setSeries}
						/>
						<CategoryTimeSeriesChart
							buckets={data.timeline.buckets}
							series={shownSeries}
							granularity={data.granularity}
						/>
					{:else}
						<EmptyState
							icon={BarChart2}
							title="No data for this dimension"
							description="Assign categories or cost groups to your transactions."
							compact
						/>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Cost-group detail -->
		{#if data.costGroups.length > 0}
			<div class="mb-8">
				<Card.Root class="border-border bg-surface shadow-sm">
					<Card.Header class="border-b">
						<Card.Title>Cost group detail</Card.Title>
						<Card.Description>Spend within a cost group, broken down by category.</Card.Description>
					</Card.Header>
					<Card.Content class="pt-6">
						<CostGroupBreakdownList
							costGroups={data.costGroups}
							selected={data.selectedCostGroup}
							detail={data.costGroupDetail}
							onselect={setCostGroup}
						/>
					</Card.Content>
				</Card.Root>
			</div>
		{/if}
	{/if}
</div>
