<script lang="ts">
	import * as HoverCard from '$lib/components/ui/hover-card';

	interface Props {
		/**
		 * Settlement state of the transfer. Drives the badge colour:
		 *  - 'settled'   → linked to a counterpart (neutral).
		 *  - 'candidate' → orphan, no counterpart yet (amber — needs attention).
		 */
		status?: 'settled' | 'candidate';
		/** Click handler — opens the pairing dialog. When omitted the badge is inert. */
		onclick?: () => void;
	}
	let { status = 'settled', onclick }: Props = $props();

	// Detect touch devices after mount to avoid SSR hydration mismatches.
	let isTouch = $state(false);
	$effect(() => {
		isTouch = window.matchMedia('(pointer: coarse)').matches;
	});

	const label = $derived(
		status === 'candidate'
			? 'Transfer — tap to find its match'
			: 'Linked transfer — tap to view the pair'
	);

	// Small, subtle rounded "T" badge. Amber ring when it still needs a counterpart.
	const triggerClass = $derived(
		[
			'inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full border text-[9px] font-semibold leading-none outline-none transition-colors',
			status === 'candidate'
				? 'border-amber-300 text-amber-600 hover:bg-amber-50'
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
	<button type="button" class={triggerClass} aria-label={label} onclick={handle}>T</button>
{:else}
	<!-- Desktop: hover shows the tooltip, click opens the dialog. -->
	<HoverCard.Root>
		<HoverCard.Trigger class={triggerClass} aria-label={label} onclick={handle}
			>T</HoverCard.Trigger
		>
		<HoverCard.Content class="max-w-56 text-xs text-text-secondary">{label}</HoverCard.Content>
	</HoverCard.Root>
{/if}
