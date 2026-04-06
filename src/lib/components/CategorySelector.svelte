<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';
	import type { CategoryRow } from '$lib/types';

	interface Props {
		txId: string;
		category: string | null;
		categoryOverride: string | null;
		categories: CategoryRow[];
	}
	let { txId, category, categoryOverride, categories }: Props = $props();

	let open = $state(false);
	let pending = $state(false);
	let localOverride = $state(categoryOverride);

	const effective = $derived(localOverride ?? category);

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
			'inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-xs outline-none',
			'hover:bg-surface-sunken focus-visible:ring-1 focus-visible:ring-primary-400',
			pending && 'opacity-50'
		)}
		disabled={pending}
	>
		{#if effectiveCat}
			<span
				class="h-1.5 w-1.5 shrink-0 rounded-full"
				style="background-color: {effectiveCat.color}"
			></span>
			<span class={localOverride ? 'text-text-primary' : 'text-text-secondary'}>
				{effective}
			</span>
		{:else if effective}
			<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400"></span>
			<span class="text-text-secondary">{effective}</span>
		{:else}
			<span class="text-text-tertiary">—</span>
		{/if}
	</Popover.Trigger>

	<Popover.Content
		class="z-50 w-52 rounded-lg border border-border bg-surface p-1 shadow-md"
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
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full"
					style="background-color: {parent.color}"
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
					<span
						class="h-1.5 w-1.5 shrink-0 rounded-full"
						style="background-color: {child.color}"
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
