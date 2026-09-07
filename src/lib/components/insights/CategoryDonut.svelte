<script lang="ts">
	import { PieChart } from 'layerchart';
	import Amount from '$lib/components/Amount.svelte';
	import * as Chart from '$lib/components/ui/chart/index.js';
	import { cn } from '$lib/utils.js';
	import type { CategoryBreakdown } from '$lib/insights.js';

	interface Props {
		breakdown: CategoryBreakdown;
		class?: string;
	}

	let { breakdown, class: cls = '' }: Props = $props();

	// Render the chart only after mount. Gating on `browser` instead would make the first
	// client render (browser === true) diverge from the SSR placeholder, a hydration
	// mismatch that intermittently breaks the layerchart mount. An effect runs *after*
	// hydration, so the first client render still matches the server placeholder.
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
	});

	const entries = $derived(breakdown.entries);
	const colors = $derived(entries.map((e) => e.color));

	// Chart.Container wants a config keyed by series — build one entry per category so
	// the injected CSS vars exist, though we drive slice colors directly via `cRange`.
	const chartConfig = $derived(
		Object.fromEntries(entries.map((e) => [e.name, { label: e.name, color: e.color }]))
	);

	function formatPct(pct: number): string {
		return `${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
	}
</script>

<div class={cn('flex flex-col items-center gap-6 md:flex-row md:items-center', cls)}>
	<!-- Donut -->
	<div class="relative shrink-0">
		<Chart.Container config={chartConfig} class="aspect-square h-52 w-52">
			{#if mounted && entries.length > 0}
				<PieChart
					data={entries}
					key={(d: (typeof entries)[number]) => d.name}
					value={(d: (typeof entries)[number]) => d.amount}
					c={(d: (typeof entries)[number]) => d.name}
					cRange={colors}
					innerRadius={0.62}
					cornerRadius={2}
					padAngle={0.01}
				/>
			{:else}
				<div class="h-full w-full animate-pulse rounded-full bg-surface-sunken"></div>
			{/if}
		</Chart.Container>
		<!-- Center total -->
		<div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
			<span class="text-xs font-medium tracking-wide text-text-tertiary uppercase">Total</span>
			<Amount value={breakdown.total} size="lg" showSign={false} colorize={false} />
		</div>
	</div>

	<!-- Legend -->
	<ul class="w-full min-w-0 flex-1 space-y-1.5">
		{#each entries as e (e.name)}
			<li class="flex items-center gap-2.5 text-sm">
				<span class="size-2.5 shrink-0 rounded-[3px]" style="background-color: {e.color}"></span>
				<span class="min-w-0 flex-1 truncate text-text-secondary">{e.name}</span>
				<span class="w-12 text-right text-xs text-text-tertiary tabular-nums">
					{formatPct(e.pct)}
				</span>
				<Amount
					value={e.amount}
					size="sm"
					showSign={false}
					colorize={false}
					class="w-24 text-right"
				/>
			</li>
		{/each}
	</ul>
</div>
