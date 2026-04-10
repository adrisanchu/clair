<script lang="ts">
	import { browser } from '$app/environment';
	import { format, getQuarter, getYear } from 'date-fns';
	import { AreaChart, Area, Spline, LinearGradient } from 'layerchart';
	import { scaleUtc } from 'd3-scale';
	import { curveNatural } from 'd3-shape';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import type { TooltipPayload } from '$lib/components/ui/chart/chart-utils.js';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';
	import { cn } from '$lib/utils.js';
	import type { BalancePoint, Granularity } from '$lib/server/db/queries.js';
	import type { ProjectedPoint } from '$lib/chart-utils.js';

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

	// Prepend the last actual point so the dashed line connects visually
	const splineData = $derived(
		actualData.length > 0 && projectedData.length > 0
			? [actualData[actualData.length - 1], ...projectedData]
			: []
	);

	// Chart.Container config maps the default series key to a label + color
	const chartConfig = {
		default: { label: 'Balance', color: 'var(--color-chart-1)' }
	} satisfies Chart.ChartConfig;

	function formatTick(date: Date): string {
		if (granularity === 'week') return format(date, 'MMM d');
		if (granularity === 'quarter') return `Q${getQuarter(date)} ${getYear(date)}`;
		return format(date, 'MMM yy');
	}

	function formatTooltipLabel(date: Date): string {
		if (granularity === 'week') return format(date, 'd MMM yyyy');
		if (granularity === 'quarter') return `Q${getQuarter(date)} ${getYear(date)}`;
		return format(date, 'MMMM yyyy');
	}

	function formatBalance(v: number): string {
		return new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: PRIMARY_CURRENCY,
			notation: 'compact',
			maximumFractionDigits: 1
		}).format(v);
	}
</script>

{#snippet balanceFormatter({ value }: { value: unknown; name: string; item: TooltipPayload; index: number; payload: TooltipPayload[] })}
	<div class="flex w-full items-center justify-between gap-6">
		<div class="flex items-center gap-1.5">
			<div class="size-2.5 rounded-[2px] bg-[--color-chart-1]"></div>
			<span class="text-muted-foreground">Balance</span>
		</div>
		<span class="font-mono font-medium tabular-nums">{formatBalance(value as number)}</span>
	</div>
{/snippet}

<Chart.Container config={chartConfig} class={cn('h-56 md:h-64', cls)}>
	{#if browser}
		<AreaChart
			data={allData}
			x="date"
			xScale={scaleUtc()}
			y="cumulativeBalance"
			yPadding={[0, 20]}
			props={{
				xAxis: { format: (v: Date) => formatTick(v) },
				yAxis: { format: (v: number) => formatBalance(v) }
			}}
		>
			{#snippet marks()}
				<!-- Actual balance: filled area with vertical gradient -->
				<LinearGradient
					stops={[
						'var(--color-chart-1)',
						'color-mix(in lch, var(--color-chart-1) 5%, transparent)'
					]}
					vertical
				>
					{#snippet children({ gradient })}
						<Area
							data={actualData}
							curve={curveNatural}
							fill={gradient}
							fillOpacity={0.4}
							line={{ class: 'stroke-2 stroke-[--color-chart-1]' }}
						/>
					{/snippet}
				</LinearGradient>

				<!-- Projected trend: dashed line from last actual point to year-end -->
				{#if splineData.length > 1}
					<Spline
						data={splineData}
						curve={curveNatural}
						class="stroke-2 stroke-[--color-chart-2] [stroke-dasharray:4_4]"
					/>
				{/if}
			{/snippet}

			{#snippet tooltip()}
				<Chart.Tooltip
					labelFormatter={(v: Date) => formatTooltipLabel(v)}
					formatter={balanceFormatter}
				/>
			{/snippet}
		</AreaChart>
	{:else}
		<!-- SSR placeholder — same dimensions to avoid layout shift -->
		<div class="h-full w-full animate-pulse rounded-lg bg-surface-sunken"></div>
	{/if}
</Chart.Container>
