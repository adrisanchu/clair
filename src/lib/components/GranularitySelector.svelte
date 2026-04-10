<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Granularity } from '$lib/server/db/queries.js';

	interface Props {
		value: Granularity;
		onchange: (g: Granularity) => void;
	}

	let { value, onchange }: Props = $props();

	const options: { label: string; value: Granularity }[] = [
		{ label: 'W', value: 'week' },
		{ label: 'M', value: 'month' },
		{ label: 'Q', value: 'quarter' }
	];
</script>

<div class="flex items-center gap-0.5 rounded-lg border border-border bg-surface-sunken p-0.5">
	{#each options as opt (opt.value)}
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
