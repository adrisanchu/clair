<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Layers, ChevronsUpDown, Check } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import type { CostGroupRow } from '$lib/types';

	interface Props {
		txId: string;
		/** Currently assigned cost-group label (or null). */
		costGroup: string | null;
		costGroups: CostGroupRow[];
		/** Fired after a successful change with the new label (or null when cleared). */
		onchange?: (value: string | null) => void;
	}
	let { txId, costGroup, costGroups, onchange }: Props = $props();

	let open = $state(false);
	let pending = $state(false);
	let local = $state(costGroup);

	// Reseed when a different transaction is shown (the sheet reuses one instance).
	$effect(() => {
		local = costGroup;
	});

	const selected = $derived(costGroups.find((c) => c.name === local) ?? null);

	async function select(name: string | null) {
		open = false;
		if (name === local) return;
		pending = true;
		try {
			const res = await fetch(`/api/transactions/${txId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ costGroup: name })
			});
			if (res.ok) {
				local = name;
				onchange?.(name);
			}
		} finally {
			pending = false;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none transition-[color,box-shadow]',
			'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
			pending && 'pointer-events-none opacity-50'
		)}
		disabled={pending}
	>
		<span class="flex min-w-0 items-center gap-2">
			{#if selected}
				<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {selected.color}"
				></span>
				<span class="truncate text-text-primary">{selected.name}</span>
			{:else if local}
				<!-- Assigned to a label with no registry entry (orphaned) — still show it. -->
				<Layers size={13} class="shrink-0 text-text-tertiary" />
				<span class="truncate text-text-primary">{local}</span>
			{:else}
				<Layers size={13} class="shrink-0 text-text-tertiary" />
				<span class="text-text-tertiary">No cost group</span>
			{/if}
		</span>
		<ChevronsUpDown size={14} class="shrink-0 text-text-tertiary" />
	</Popover.Trigger>

	<Popover.Content
		class="z-50 max-h-72 w-64 gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md"
		align="start"
		sideOffset={4}
	>
		<!-- Clear option — only when something is assigned -->
		{#if local}
			<button
				onclick={() => select(null)}
				class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-text-tertiary outline-none hover:bg-surface-sunken"
			>
				<Layers size={13} class="shrink-0" />
				No cost group
			</button>
			<div class="-mx-1 my-1 h-px bg-border"></div>
		{/if}

		{#each costGroups as group (group.id)}
			<button
				onclick={() => select(group.name)}
				class={cn(
					'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-surface-sunken',
					local === group.name ? 'font-medium text-text-primary' : 'text-text-secondary'
				)}
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {group.color}"
				></span>
				<span class="min-w-0 flex-1 truncate">{group.name}</span>
				{#if local === group.name}
					<Check size={13} class="shrink-0 text-primary-500" />
				{/if}
			</button>
		{/each}

		{#if costGroups.length === 0}
			<p class="px-2.5 py-2 text-xs text-text-tertiary">
				No cost groups yet. Create them in Settings.
			</p>
		{/if}
	</Popover.Content>
</Popover.Root>
