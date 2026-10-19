<script lang="ts" module>
	export interface TxFacetSelection {
		accountIds: string[];
		/** Category names as ticked (a parent implies its children server-side). */
		categories: string[];
		/** Cost-group names. */
		costGroups: string[];
	}
</script>

<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { Funnel } from '@lucide/svelte';
	import * as Popover from '$lib/components/ui/popover';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import CheckboxList, { type CheckboxListItem } from '$lib/components/CheckboxList.svelte';
	import { cn } from '$lib/utils';
	import type { CategoryRow, CostGroupRow } from '$lib/types';

	interface Props {
		accounts: { id: string; displayName: string }[];
		categories: CategoryRow[];
		costGroups: CostGroupRow[];
		selected: TxFacetSelection;
		onapply: (next: TxFacetSelection) => void;
	}

	let { accounts, categories, costGroups, selected, onapply }: Props = $props();

	/** Rows shown per list before "Show all". */
	const LIST_LIMIT = 5;

	let open = $state(false);

	// Drafts — reset from the URL-backed selection on every open, so closing without
	// Apply discards changes.
	const draftAccounts = new SvelteSet<string>();
	const draftCategories = new SvelteSet<string>();
	const draftCostGroups = new SvelteSet<string>();

	function resetDrafts(from: TxFacetSelection) {
		draftAccounts.clear();
		draftCategories.clear();
		draftCostGroups.clear();
		for (const id of from.accountIds) draftAccounts.add(id);
		for (const name of from.categories) draftCategories.add(name);
		for (const name of from.costGroups) draftCostGroups.add(name);
	}

	function handleOpenChange(next: boolean) {
		if (next) resetDrafts(selected);
	}

	const parentNameById = $derived(
		new Map(categories.filter((c) => !c.parentId).map((c) => [c.id, c.name]))
	);

	const accountItems = $derived<CheckboxListItem[]>(
		accounts.map((a) => ({ id: a.id, label: a.displayName }))
	);

	// Parent followed by its children, so a flat list with indented children reads as a tree.
	const orderedCategories = $derived(
		categories
			.filter((c) => !c.parentId)
			.flatMap((p) => [p, ...categories.filter((c) => c.parentId === p.id)])
	);

	const categoryItems = $derived<CheckboxListItem[]>(
		orderedCategories.map((c) => {
			const parentName = c.parentId ? parentNameById.get(c.parentId) : undefined;
			return {
				id: c.name,
				label: c.name,
				color: c.color,
				indent: !!c.parentId,
				implied: !!parentName && draftCategories.has(parentName)
			};
		})
	);

	const costGroupItems = $derived<CheckboxListItem[]>(
		costGroups.map((g) => ({ id: g.name, label: g.name, color: g.color }))
	);

	const activeCount = $derived(
		selected.accountIds.length + selected.categories.length + selected.costGroups.length
	);
	const draftCount = $derived(draftAccounts.size + draftCategories.size + draftCostGroups.size);

	function apply() {
		// Drop children already covered by a ticked parent — keeps the URL minimal.
		const cats = categories
			.filter((c) => draftCategories.has(c.name))
			.filter((c) => {
				const parentName = c.parentId ? parentNameById.get(c.parentId) : undefined;
				return !(parentName && draftCategories.has(parentName));
			})
			.map((c) => c.name);

		onapply({
			accountIds: accounts.filter((a) => draftAccounts.has(a.id)).map((a) => a.id),
			categories: cats,
			costGroups: costGroups.filter((g) => draftCostGroups.has(g.name)).map((g) => g.name)
		});
		open = false;
	}
</script>

<Popover.Root bind:open onOpenChange={handleOpenChange}>
	<Popover.Trigger
		class={cn(
			buttonVariants({ variant: 'outline', size: 'sm' }),
			'gap-1.5',
			activeCount > 0 && 'border-primary-300 bg-primary-50 text-primary-600 hover:bg-primary-100'
		)}
	>
		<Funnel size={13} class={activeCount > 0 ? '' : 'text-muted-foreground'} />
		Filters
		{#if activeCount > 0}
			<span
				class="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-bold text-white"
			>
				{activeCount}
			</span>
		{/if}
	</Popover.Trigger>

	<!-- Capped to the room left below the trigger, so the footer (Apply) is always on screen;
	     only the body scrolls. Two columns from sm: short lists left, categories right. -->
	<Popover.Content
		align="end"
		collisionPadding={16}
		class="max-h-[min(36rem,var(--bits-popover-content-available-height))] w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:w-xl"
	>
		<div
			class="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto sm:grid-cols-2 sm:grid-rows-[auto_1fr]"
		>
			<CheckboxList
				title="Accounts"
				items={accountItems}
				selected={draftAccounts}
				size="sm"
				limit={LIST_LIMIT}
				listClass="py-1"
				class="overflow-y-auto border-b border-border sm:col-start-1 sm:row-start-1"
			/>
			<CheckboxList
				title="Categories"
				items={categoryItems}
				selected={draftCategories}
				size="sm"
				limit={LIST_LIMIT}
				listClass="py-1"
				class="overflow-y-auto border-b border-border sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:border-b-0 sm:border-l"
			/>
			<CheckboxList
				title="Cost groups"
				items={costGroupItems}
				selected={draftCostGroups}
				size="sm"
				limit={LIST_LIMIT}
				listClass="py-1"
				class="overflow-y-auto sm:col-start-1 sm:row-start-2"
			/>
		</div>

		<div class="flex shrink-0 items-center justify-between gap-2 border-t border-border px-3 py-2">
			<Button
				variant="ghost"
				size="sm"
				disabled={draftCount === 0}
				onclick={() => resetDrafts({ accountIds: [], categories: [], costGroups: [] })}
			>
				Reset
			</Button>
			<Button size="sm" onclick={apply} class="bg-primary-500 hover:bg-primary-600">Apply</Button>
		</div>
	</Popover.Content>
</Popover.Root>
