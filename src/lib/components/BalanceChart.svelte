<script lang="ts">
	import { browser } from '$app/environment';
	import { AreaChart, Area, LinearGradient } from 'layerchart';
	import { scaleUtc } from 'd3-scale';
	import { curveNatural } from 'd3-shape';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import type { TooltipPayload } from '$lib/components/ui/chart/chart-utils.js';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';
	import { cn } from '$lib/utils.js';
	import type { BalancePoint, Granularity } from '$lib/server/db/queries.js';
	import {
		formatBucketTick,
		formatBucketLabel,
		formatCompactEur,
		type ProjectedPoint
	} from '$lib/chart-utils.js';

	interface Props {
		points: BalancePoint[];
		projectedPoints: ProjectedPoint[];
		granularity: Granularity;
		class?: string;
	}

	let { points, projectedPoints, granularity, class: cls = '' }: Props = $props();

	// Add Date objects for the x-axis (scaleUtc needs real Dates, not strings)
	const actualData = $derived(points.map((p) => ({ ...p, date: new Date(p.bucket) })));
	const projectedData = $derived(projectedPoints.map((p) => ({ ...p, date: new Date(p.bucket) })));

	// Merged dataset drives the chart domain (x + y extents)
	const allData = $derived([...actualData, ...projectedData]);

	// Prepend the last actual point so the projected area connects seamlessly
	const projectedAreaData = $derived(
		actualData.length > 0 && projectedData.length > 0
			? [actualData[actualData.length - 1], ...projectedData]
			: []
	);

	// X axis tick strategy per granularity:
	// - quarter: ticks:4 forces d3 to snap to quarterly boundaries (Jan/Apr/Jul/Oct)
	//   avoiding duplicate "Q1 2026 Q1 2026 Q1 2026" that appear with monthly d3 ticks
	// - week/month: tickSpacing only — layerchart auto-reduces ticks to fit the
	//   container width, giving responsive behaviour without JS resize listeners
	const xTicks = $derived(granularity === 'quarter' ? 4 : undefined);
	const xTickSpacing = $derived(granularity === 'week' ? 70 : 80);

	// Chart.Container config maps the default series key to a label + color
	const chartConfig = {
		default: { label: 'Balance', color: 'var(--color-primary-500)' }
	} satisfies Chart.ChartConfig;

	function formatBalance(v: number): string {
		return new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: PRIMARY_CURRENCY,
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(v);
	}

	const lineStyle = 'stroke: var(--color-primary-500); stroke-width: 2px;';
	const dashedLineStyle = `${lineStyle} stroke-dasharray: 4 4;`;
</script>

{#snippet balanceFormatter({
	value
}: {
	value: unknown;
	name: string;
	item: TooltipPayload;
	index: number;
	payload: TooltipPayload[];
})}
	<div class="flex w-full items-center justify-between gap-6">
		<div class="flex items-center gap-1.5">
			<div class="size-2.5 rounded-[2px] bg-[--color-primary-500]"></div>
			<span class="text-muted-foreground">Balance</span>
		</div>
		<span class="font-mono font-medium tabular-nums">{formatBalance(value as number)}</span>
	</div>
{/snippet}

<Chart.Container config={chartConfig} class={cn('aspect-auto h-56 md:h-64', cls)}>
	{#if browser}
		<AreaChart
			data={allData}
			x="date"
			xScale={scaleUtc()}
			y="cumulativeBalance"
			yPadding={[0, 20]}
			props={{
				xAxis: {
					format: (v: Date) => formatBucketTick(v, granularity),
					ticks: xTicks,
					tickSpacing: xTickSpacing
				},
				yAxis: { format: (v: number) => formatCompactEur(v) }
			}}
		>
			{#snippet marks()}
				<LinearGradient
					stops={[
						'var(--color-primary-500)',
						'color-mix(in lch, var(--color-primary-500) 5%, transparent)'
					]}
					vertical
				>
					{#snippet children({ gradient })}
						<!-- Actual balance: solid pink line + gradient fill -->
						<Area
							data={actualData}
							curve={curveNatural}
							fill={gradient}
							fillOpacity={0.4}
							line={{ style: lineStyle }}
						/>

						<!-- Projected trend: same gradient fill, dashed pink line -->
						{#if projectedAreaData.length > 1}
							<Area
								data={projectedAreaData}
								curve={curveNatural}
								fill={gradient}
								fillOpacity={0.4}
								line={{ style: dashedLineStyle }}
							/>
						{/if}
					{/snippet}
				</LinearGradient>
			{/snippet}

			{#snippet tooltip()}
				<Chart.Tooltip
					labelFormatter={(v: Date) => formatBucketLabel(v, granularity)}
					formatter={balanceFormatter}
				/>
			{/snippet}
		</AreaChart>
	{:else}
		<!-- SSR placeholder — same dimensions to avoid layout shift -->
		<div class="h-full w-full animate-pulse rounded-lg bg-surface-sunken"></div>
	{/if}
</Chart.Container>
