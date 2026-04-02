<script lang="ts">
	import { Info } from '@lucide/svelte';
	import * as HoverCard from '$lib/components/ui/hover-card';
	import * as Popover from '$lib/components/ui/popover';

	interface Props {
		note: string;
	}
	let { note }: Props = $props();

	// Detect touch devices after mount to avoid SSR hydration mismatches.
	// pointer: coarse = touch/stylus; pointer: fine = mouse/trackpad.
	let isTouch = $state(false);
	$effect(() => {
		isTouch = window.matchMedia('(pointer: coarse)').matches;
	});

	const triggerClass =
		'inline-flex shrink-0 cursor-default items-center rounded-full text-text-tertiary outline-none hover:text-text-secondary';
	const contentClass = 'max-w-64 text-xs text-text-secondary';
</script>

{#if isTouch}
	<!-- Touch devices: click-to-open Popover -->
	<Popover.Root>
		<Popover.Trigger class={triggerClass}>
			<Info size={12} />
		</Popover.Trigger>
		<Popover.Content class={contentClass}>
			{note}
		</Popover.Content>
	</Popover.Root>
{:else}
	<!-- Desktop: hover-activated HoverCard -->
	<HoverCard.Root>
		<HoverCard.Trigger class={triggerClass}>
			<Info size={12} />
		</HoverCard.Trigger>
		<HoverCard.Content class={contentClass}>
			{note}
		</HoverCard.Content>
	</HoverCard.Root>
{/if}
