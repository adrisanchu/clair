<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils';
	import type { CategoryRow } from '$lib/types';

	interface Props {
		txId: string;
		category: string | null; // raw bank-file value
		categoryAI?: string | null; // AI guess
		categoryOverride: string | null; // human decision
		categories: CategoryRow[];
	}
	let { txId, category, categoryAI = null, categoryOverride, categories }: Props = $props();

	let open = $state(false);
	let pending = $state(false);
	let localOverride = $state(categoryOverride);

	const effective = $derived(localOverride ?? category ?? categoryAI);

	const effectiveCat = $derived(categories.find((c) => c.name === effective) ?? null);

	// Build grouped list: parents with their children
	const grouped = $derived(
		categories
			.filter((c) => c.parentId === null)
			.map((p) => ({ ...p, children: categories.filter((c) => c.parentId === p.id) }))
	);

	async function select(name: string | null) {
		open = false;
		if (name === localOverride) return;
		pending = true;
		try {
			const res = await fetch(`/api/transactions/${txId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ categoryOverride: name })
			});
			if (res.ok) {
				localOverride = name;
			}
		} finally {
			pending = false;
		}
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger
		class={cn(
			'group flex w-full cursor-pointer justify-center outline-none',
			'focus-visible:ring-1 focus-visible:ring-primary-400',
			pending && 'opacity-50'
		)}
		disabled={pending}
	>
		{#if effectiveCat}
			<Badge
				class="max-w-full min-w-0 shrink truncate px-1 text-[10px] font-medium transition-opacity group-hover:opacity-70 md:px-2 md:text-[11px]"
				style="background-color: {effectiveCat.color}26; color: {effectiveCat.color}; border-color: {effectiveCat.color}40;"
			>
				{effective}
			</Badge>
		{:else if effective}
			<Badge
				variant="secondary"
				class="max-w-full min-w-0 shrink truncate px-1 text-[10px] font-medium transition-opacity group-hover:opacity-70 md:px-2 md:text-[11px]"
			>
				{effective}
			</Badge>
		{:else}
			<span class="text-text-tertiary transition-colors group-hover:text-text-secondary">—</span>
		{/if}
	</Popover.Trigger>

	<Popover.Content
		class="z-50 max-h-72 w-52 gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md"
		align="start"
		sideOffset={4}
	>
		<!-- Clear option — only shown when there's something to clear -->
		{#if effective}
			<button
				onclick={() => select(null)}
				class="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-text-tertiary outline-none hover:bg-surface-sunken"
			>
				No category
			</button>
			<div class="-mx-1 my-1 h-px bg-border"></div>
		{/if}

		<!-- Category tree -->
		{#each grouped as parent}
			<button
				onclick={() => select(parent.name)}
				class={cn(
					'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-surface-sunken',
					effective === parent.name ? 'font-medium text-text-primary' : 'text-text-secondary'
				)}
			>
				<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {parent.color}"
				></span>
				{parent.name}
			</button>
			{#each parent.children as child}
				<button
					onclick={() => select(child.name)}
					class={cn(
						'flex w-full items-center gap-2 rounded-md py-1.5 pr-2.5 pl-6 text-left text-xs outline-none hover:bg-surface-sunken',
						effective === child.name ? 'font-medium text-text-primary' : 'text-text-secondary'
					)}
				>
					<span class="h-1.5 w-1.5 shrink-0 rounded-full" style="background-color: {child.color}"
					></span>
					{child.name}
				</button>
			{/each}
		{/each}

		{#if grouped.length === 0}
			<p class="px-2.5 py-2 text-xs text-text-tertiary">No categories yet</p>
		{/if}
	</Popover.Content>
</Popover.Root>
