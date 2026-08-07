<script lang="ts">
	import * as HoverCard from '$lib/components/ui/hover-card';
	import * as Popover from '$lib/components/ui/popover';

	interface Props {
		/**
		 * Settlement state of the transfer. Drives the badge colour:
		 *  - 'settled'   → linked to a counterpart (neutral).
		 *  - 'candidate' → orphan, no counterpart yet (amber — needs attention).
		 * Defaults to 'settled'; the candidate colour is wired up once #30/#50 land.
		 */
		status?: 'settled' | 'candidate';
	}
	let { status = 'settled' }: Props = $props();

	// Detect touch devices after mount to avoid SSR hydration mismatches.
	let isTouch = $state(false);
	$effect(() => {
		isTouch = window.matchMedia('(pointer: coarse)').matches;
	});

	const label = $derived(
		status === 'candidate'
			? 'Transfer — no matching counterpart found yet'
			: 'This is a transfer between your accounts'
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
	const contentClass = 'max-w-56 text-xs text-text-secondary';
</script>

{#if isTouch}
	<Popover.Root>
		<Popover.Trigger class={triggerClass} aria-label={label}>T</Popover.Trigger>
		<Popover.Content class={contentClass}>{label}</Popover.Content>
	</Popover.Root>
{:else}
	<HoverCard.Root>
		<HoverCard.Trigger class={triggerClass} aria-label={label}>T</HoverCard.Trigger>
		<HoverCard.Content class={contentClass}>{label}</HoverCard.Content>
	</HoverCard.Root>
{/if}
