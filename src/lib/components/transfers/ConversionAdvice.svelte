<script lang="ts">
	import { format } from 'date-fns';
	import { Lightbulb } from '@lucide/svelte';
	import type { OrphanAdvice } from '$lib/server/db/queries';

	interface Props {
		advice: OrphanAdvice;
	}
	let { advice }: Props = $props();

	const range = $derived(
		`${format(advice.windowStart, 'd MMM')} – ${format(advice.windowEnd, 'd MMM yyyy')}`
	);
</script>

<!-- Subtle advisor line: why this conversion can't reconcile, and what to do. Kept grayscale
     (amber is reserved for "Needs attention") and secondary to the transaction itself. -->
<p class="flex items-start gap-1.5 text-[11px] leading-snug text-text-tertiary">
	<Lightbulb size={12} class="mt-px shrink-0" />
	<span>
		{#if advice.expectedCurrency == null}
			Its foreign-currency leg isn't in your accounts yet — import the source account or link it
			manually.
		{:else if !advice.hasAccount}
			No <span class="font-medium text-text-secondary">{advice.expectedCurrency}</span> account yet —
			import one covering
			<span class="font-medium text-text-secondary">{range}</span> to match this.
		{:else}
			No <span class="font-medium text-text-secondary">{advice.expectedCurrency}</span> transaction
			found between <span class="font-medium text-text-secondary">{range}</span> — import that
			statement or link it manually.
		{/if}
	</span>
</p>
