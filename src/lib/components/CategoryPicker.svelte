<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Tag, ChevronsUpDown, Check } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import type { CategoryRow } from '$lib/types';

	interface Props {
		/** Currently selected category name (or null). Bindable — the parent owns
		 *  persistence; this component only edits the value (mirrors CostGroupSelector). */
		value?: string | null;
		categories: CategoryRow[];
		disabled?: boolean;
	}
	let { value = $bindable(null), categories, disabled = false }: Props = $props();

	let open = $state(false);

	const selected = $derived(categories.find((c) => c.name === value) ?? null);

	// Parents with their children, for the indented tree.
	const grouped = $derived(
		categories
			.filter((c) => c.parentId === null)
			.map((p) => ({ ...p, children: categories.filter((c) => c.parentId === p.id) }))
	);

	function select(name: string | null) {
		open = false;
		value = name;
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs outline-none transition-[color,box-shadow]',
			'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
			disabled && 'pointer-events-none opacity-50'
		)}
		{disabled}
	>
		<span class="flex min-w-0 items-center gap-2">
			{#if selected}
				<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {selected.color}"
				></span>
				<span class="truncate text-text-primary">{selected.name}</span>
			{:else if value}
				<!-- Assigned to a name with no registry entry — still show it. -->
				<Tag size={13} class="shrink-0 text-text-tertiary" />
				<span class="truncate text-text-primary">{value}</span>
			{:else}
				<Tag size={13} class="shrink-0 text-text-tertiary" />
				<span class="text-text-tertiary">No category</span>
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
		{#if value}
			<button
				type="button"
				onclick={() => select(null)}
				class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-text-tertiary outline-none hover:bg-surface-sunken"
			>
				<Tag size={13} class="shrink-0" />
				No category
			</button>
			<div class="-mx-1 my-1 h-px bg-border"></div>
		{/if}

		{#each grouped as parent (parent.id)}
			<button
				type="button"
				onclick={() => select(parent.name)}
				class={cn(
					'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-surface-sunken',
					value === parent.name ? 'font-medium text-text-primary' : 'text-text-secondary'
				)}
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {parent.color}"
				></span>
				<span class="min-w-0 flex-1 truncate">{parent.name}</span>
				{#if value === parent.name}
					<Check size={13} class="shrink-0 text-primary-500" />
				{/if}
			</button>
			{#each parent.children as child (child.id)}
				<button
					type="button"
					onclick={() => select(child.name)}
					class={cn(
						'flex w-full items-center gap-2 rounded-md py-1.5 pr-2.5 pl-6 text-left text-xs outline-none hover:bg-surface-sunken',
						value === child.name ? 'font-medium text-text-primary' : 'text-text-secondary'
					)}
				>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {child.color}"
					></span>
					<span class="min-w-0 flex-1 truncate">{child.name}</span>
					{#if value === child.name}
						<Check size={13} class="shrink-0 text-primary-500" />
					{/if}
				</button>
			{/each}
		{/each}

		{#if grouped.length === 0}
			<p class="px-2.5 py-2 text-xs text-text-tertiary">No categories yet. Create them in Settings.</p>
		{/if}
	</Popover.Content>
</Popover.Root>
