<script lang="ts">
	import * as HoverCard from '$lib/components/ui/hover-card';

	interface Props {
		/**
		 * What kind of movement this badge marks:
		 *  - 'transfer'   → same-currency movement between accounts ("T").
		 *  - 'conversion' → cross-currency exchange, EUR ↔ foreign ("C").
		 */
		kind?: 'transfer' | 'conversion';
		/**
		 * Settlement state — drives the badge colour:
		 *  - 'settled'   → linked to a counterpart.
		 *  - 'candidate' → orphan, no counterpart yet (amber — needs attention).
		 */
		status?: 'settled' | 'candidate';
		/** Click handler — opens the pairing dialog. When omitted the badge is inert. */
		onclick?: () => void;
	}
	let { kind = 'transfer', status = 'settled', onclick }: Props = $props();

	// Detect touch devices after mount to avoid SSR hydration mismatches.
	let isTouch = $state(false);
	$effect(() => {
		isTouch = window.matchMedia('(pointer: coarse)').matches;
	});

	const glyph = $derived(kind === 'conversion' ? 'C' : 'T');

	const label = $derived(
		kind === 'conversion'
			? status === 'candidate'
				? 'Currency exchange — tap to find its match'
				: 'Currency conversion — tap to view the pair'
			: status === 'candidate'
				? 'Transfer — tap to find its match'
				: 'Linked transfer — tap to view the pair'
	);

	// Small rounded letter badge. Amber ring when it still needs a counterpart; a settled
	// conversion carries a pink (primary) accent so it reads as distinct from a transfer.
	const triggerClass = $derived(
		[
			'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border text-[9px] font-semibold leading-none outline-none transition-colors',
			status === 'candidate'
				? 'border-amber-300 text-amber-600 hover:bg-amber-50'
				: kind === 'conversion'
					? 'border-primary-200 text-primary-600 hover:bg-primary-50'
					: 'border-border text-text-tertiary hover:text-text-secondary hover:bg-surface-sunken'
		].join(' ')
	);

	function handle(e: Event) {
		e.stopPropagation();
		onclick?.();
	}
</script>

{#if isTouch}
	<!-- Touch: tap is the action; no hover tooltip. -->
	<button type="button" class={triggerClass} aria-label={label} onclick={handle}>{glyph}</button>
{:else}
	<!-- Desktop: hover shows the tooltip, click opens the dialog. -->
	<HoverCard.Root>
		<HoverCard.Trigger class={triggerClass} aria-label={label} onclick={handle}
			>{glyph}</HoverCard.Trigger
		>
		<HoverCard.Content class="max-w-56 text-xs text-text-secondary">{label}</HoverCard.Content>
	</HoverCard.Root>
{/if}
