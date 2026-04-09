<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Check } from '@lucide/svelte';
	import { CATEGORY_PALETTE } from '$lib/constants/colors.js';

	interface Props {
		value?: string;
		onchange?: (hex: string) => void;
	}

	let { value = $bindable('#6b7280'), onchange }: Props = $props();

	const PALETTE = CATEGORY_PALETTE;

	let open = $state(false);

	function select(hex: string) {
		value = hex;
		onchange?.(hex);
		open = false;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				type="button"
				class="h-6 w-6 rounded-full border-2 border-white shadow-sm ring-1 ring-border transition-shadow hover:ring-2 hover:ring-primary-500/50"
				style="background-color: {value}"
				aria-label="Pick color"
			></button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-auto p-3" sideOffset={6}>
		<div class="grid grid-cols-5 gap-1.5">
			{#each PALETTE as hex (hex)}
				<button
					type="button"
					class="relative h-6 w-6 rounded-full transition-transform hover:scale-110"
					style="background-color: {hex}"
					aria-label={hex}
					onclick={() => select(hex)}
				>
					{#if value === hex}
						<Check
							size={12}
							class="absolute inset-0 m-auto text-white drop-shadow-sm"
							strokeWidth={3}
						/>
					{/if}
				</button>
			{/each}
		</div>
	</Popover.Content>
</Popover.Root>
