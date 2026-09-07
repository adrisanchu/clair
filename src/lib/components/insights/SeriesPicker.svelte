<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { SeriesLine } from '$lib/insights.js';

	interface Props {
		/** All available series, ranked by spend (from `buildTimeSeries`). */
		series: SeriesLine[];
		selected: string[];
		onchange: (names: string[]) => void;
	}

	let { series, selected, onchange }: Props = $props();

	const selectedSet = $derived(new Set(selected));

	function toggle(name: string) {
		const next = new Set(selectedSet);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		// Preserve the ranked order rather than click order.
		onchange(series.filter((s) => next.has(s.name)).map((s) => s.name));
	}
</script>

<div class="flex flex-wrap gap-1.5">
	{#each series as s (s.name)}
		{@const on = selectedSet.has(s.name)}
		<button
			type="button"
			onclick={() => toggle(s.name)}
			class={cn(
				'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
				on
					? 'border-border-strong bg-surface text-text-primary'
					: 'border-border bg-surface-sunken text-text-tertiary hover:text-text-secondary'
			)}
		>
			<span
				class="size-2 shrink-0 rounded-full"
				style="background-color: {on ? s.color : 'var(--color-border-strong)'}"
			></span>
			{s.name}
		</button>
	{/each}
</div>
