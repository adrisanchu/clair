<script lang="ts">
	import { Tags } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import CategoryRow from './CategoryRow.svelte';
	import CategoryFormSheet from './CategoryFormSheet.svelte';
	import type { CategoryRow as CategoryRowType } from '$lib/types';

	interface Props {
		categories: CategoryRowType[];
		isOwner: boolean;
	}

	let { categories, isOwner }: Props = $props();

	let addOpen = $state(false);

	interface CategoryGroup {
		parent: CategoryRowType;
		children: CategoryRowType[];
	}

	// Build tree: group subcategories under their parents
	const groups = $derived.by(() => {
		const parents = categories.filter((c) => c.parentId === null);
		const childMap = new Map<string, CategoryRowType[]>();

		for (const c of categories) {
			if (c.parentId !== null) {
				const arr = childMap.get(c.parentId) ?? [];
				arr.push(c);
				childMap.set(c.parentId, arr);
			}
		}

		return parents.map((p): CategoryGroup => ({
			parent: p,
			children: childMap.get(p.id) ?? []
		}));
	});
</script>

<div class="space-y-1">
	{#if groups.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12">
			<Tags size={32} class="text-text-tertiary" />
			<div class="text-center">
				<p class="text-sm font-medium text-text-primary">No categories yet</p>
				<p class="mt-1 text-xs text-text-secondary">Add categories to organise your transactions.</p>
			</div>
			{#if isOwner}
				<Button size="sm" onclick={() => (addOpen = true)}>Add category</Button>
			{/if}
		</div>
	{:else}
		<div class="rounded-xl border border-border bg-surface">
			{#each groups as group, i (group.parent.id)}
				{#if i > 0}
					<div class="mx-3 h-px bg-border"></div>
				{/if}
				<CategoryRow
					category={group.parent}
					{isOwner}
					isChild={false}
					childCount={group.children.length}
				/>
				{#each group.children as child (child.id)}
					<CategoryRow category={child} {isOwner} isChild={true} />
				{/each}
			{/each}
		</div>

		{#if isOwner}
			<div class="pt-2">
				<Button variant="outline" size="sm" onclick={() => (addOpen = true)}>Add category</Button>
			</div>
		{/if}
	{/if}
</div>

<CategoryFormSheet bind:open={addOpen} mode="create" />
