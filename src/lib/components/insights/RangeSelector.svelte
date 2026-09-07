<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { RangeKey } from '$lib/insights.js';

	interface Props {
		value: RangeKey;
		onchange: (r: RangeKey) => void;
	}

	let { value, onchange }: Props = $props();

	const RANGE_OPTIONS: { label: string; value: RangeKey }[] = [
		{ label: '3M', value: '3m' },
		{ label: '6M', value: '6m' },
		{ label: 'YTD', value: 'ytd' },
		{ label: '1Y', value: '1y' },
		{ label: 'All', value: 'all' }
	];
</script>

<div class="flex items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5">
	{#each RANGE_OPTIONS as opt (opt.value)}
		<button
			type="button"
			onclick={() => onchange(opt.value)}
			class={cn(
				'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
				value === opt.value
					? 'bg-surface text-text-primary shadow-sm'
					: 'text-text-tertiary hover:text-text-secondary'
			)}
		>
			{opt.label}
		</button>
	{/each}
</div>
