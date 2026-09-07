<script lang="ts">
	import { cn } from '$lib/utils.js';

	type Dimension = 'category' | 'costGroup';

	interface Props {
		value: Dimension;
		onchange: (d: Dimension) => void;
	}

	let { value, onchange }: Props = $props();

	const options: { label: string; value: Dimension }[] = [
		{ label: 'Category', value: 'category' },
		{ label: 'Cost group', value: 'costGroup' }
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
