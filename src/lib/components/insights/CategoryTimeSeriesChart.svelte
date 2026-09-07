<script lang="ts">
	import { browser } from '$app/environment';
	import { LineChart } from 'layerchart';
	import { scaleUtc } from 'd3-scale';
	// Monotone (not natural/cardinal) — smooth but never overshoots between points, so a
	// line can't dip below a value it never reached (avoids implying costs went negative).
	import { curveMonotoneX } from 'd3-shape';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { formatBucketTick, formatBucketLabel, formatCompactEur } from '$lib/chart-utils.js';
	import { cn } from '$lib/utils.js';
	import type { Granularity } from '$lib/server/db/queries.js';
	import type { SeriesLine } from '$lib/insights.js';

	interface Props {
		buckets: string[];
		series: SeriesLine[]; // already filtered to the selected series
		granularity: Granularity;
		class?: string;
	}

	let { buckets, series, granularity, class: cls = '' }: Props = $props();

	// Wide-format rows: one row per bucket with a column per series, plus a real Date for the x-axis.
	const data = $derived(
		buckets.map((b, i) => {
			const row: Record<string, number | Date> = { date: new Date(b) };
			for (const s of series) row[s.name] = s.points[i]?.value ?? 0;
			return row;
		})
	);

	const seriesConfig = $derived(
		series.map((s) => ({ key: s.name, label: s.name, color: s.color }))
	);

	const chartConfig = $derived(
		Object.fromEntries(series.map((s) => [s.name, { label: s.name, color: s.color }]))
	);

	// One tick per bucket for month/quarter (a tight domain otherwise makes d3 emit
	// several ticks that round to the same "Mar 26" label). Weekly buckets can be many,
	// so fall back to auto tick-spacing that layerchart reduces to fit the width.
	const xTickValues = $derived(data.map((d) => d.date as Date));
	const xTicks = $derived(granularity === 'week' ? undefined : xTickValues);
	const xTickSpacing = $derived(granularity === 'week' ? 70 : undefined);
</script>

<Chart.Container config={chartConfig} class={cn('aspect-auto h-56 md:h-64', cls)}>
	{#if browser && series.length > 0 && buckets.length > 0}
		<LineChart
			{data}
			x="date"
			xScale={scaleUtc()}
			series={seriesConfig}
			legend={false}
			props={{
				xAxis: {
					format: (v: Date) => formatBucketTick(v, granularity),
					ticks: xTicks,
					tickSpacing: xTickSpacing
				},
				yAxis: { format: (v: number) => formatCompactEur(v) },
				spline: { curve: curveMonotoneX, class: 'stroke-2' }
			}}
		>
			{#snippet tooltip()}
				<Chart.Tooltip labelFormatter={(v: Date) => formatBucketLabel(v, granularity)} />
			{/snippet}
		</LineChart>
	{:else}
		<div class="flex h-full w-full items-center justify-center text-sm text-text-tertiary">
			Select at least one series to plot.
		</div>
	{/if}
</Chart.Container>
