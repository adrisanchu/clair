<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Layers, Check, Plus } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import type { CostGroupRow } from '$lib/types';

	interface Props {
		txId: string;
		/** Currently assigned cost-group label (or null). */
		costGroup: string | null;
		costGroups: CostGroupRow[];
		/** Popover alignment — 'end' when the tag sits at the right of a row, 'start'
		 *  when it sits in a left-hand column (mobile, stacked under the category). */
		align?: 'start' | 'end';
		class?: string;
	}
	let { txId, costGroup, costGroups, align = 'end', class: className = '' }: Props = $props();

	let open = $state(false);
	let pending = $state(false);
	let local = $state(costGroup);

	// Reseed if the underlying data changes (e.g. after a navigation/invalidate).
	$effect(() => {
		local = costGroup;
	});

	const selected = $derived(costGroups.find((c) => c.name === local) ?? null);
	const color = $derived(selected?.color ?? '#6b7280');

	// Persist immediately on pick (optimistic), mirroring the inline CategorySelector.
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
			if (res.ok) local = name;
		} finally {
			pending = false;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			'inline-flex shrink-0 items-center gap-1 rounded-full text-[10px] font-medium outline-none transition',
			'focus-visible:ring-1 focus-visible:ring-primary-400',
			local
				? 'max-w-[10rem] border py-0.5 pr-2 pl-1.5 text-text-secondary hover:brightness-95'
				: // Empty state: a quiet "＋ Group" affordance. On touch (no hover) it stays
					// visible so assignment is reachable; on sm+ it's revealed on row hover / focus
					// so the table stays clean.
					'border border-dashed border-border px-1.5 py-0.5 text-text-tertiary hover:text-text-secondary opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
			open && 'opacity-100',
			pending && 'opacity-50',
			className
		)}
		style={local ? `border-color: ${color}40; background-color: ${color}14;` : ''}
		disabled={pending}
		title={local ? `Cost group: ${local}` : 'Add to a cost group'}
	>
		{#if local}
			<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {color}"></span>
			<span class="truncate">{local}</span>
		{:else}
			<Plus size={11} class="shrink-0" />
			<span>Group</span>
		{/if}
	</Popover.Trigger>

	<Popover.Content
		class="z-50 max-h-72 w-56 gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md"
		{align}
		sideOffset={4}
	>
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
