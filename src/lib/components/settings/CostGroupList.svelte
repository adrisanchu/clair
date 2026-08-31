<script lang="ts">
	import { Layers } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import CostGroupRow from './CostGroupRow.svelte';
	import CostGroupFormSheet from './CostGroupFormSheet.svelte';
	import type { CostGroupRow as CostGroupRowType } from '$lib/types';

	interface Props {
		costGroups: CostGroupRowType[];
		isOwner: boolean;
	}

	let { costGroups, isOwner }: Props = $props();

	let addOpen = $state(false);
</script>

<div class="space-y-1">
	{#if costGroups.length === 0}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12"
		>
			<Layers size={32} class="text-text-tertiary" />
			<div class="text-center">
				<p class="text-sm font-medium text-text-primary">No cost groups yet</p>
				<p class="mt-1 text-xs text-text-secondary">
					Group transactions across categories — e.g. a trip or a shared project.
				</p>
			</div>
			{#if isOwner}
				<Button size="sm" onclick={() => (addOpen = true)}>Add cost group</Button>
			{/if}
		</div>
	{:else}
		<div class="rounded-xl border border-border bg-surface">
			{#each costGroups as costGroup, i (costGroup.id)}
				{#if i > 0}
					<div class="mx-3 h-px bg-border"></div>
				{/if}
				<CostGroupRow {costGroup} {isOwner} />
			{/each}
		</div>

		{#if isOwner}
			<div class="pt-2">
				<Button variant="outline" size="sm" onclick={() => (addOpen = true)}>Add cost group</Button>
			</div>
		{/if}
	{/if}
</div>

<CostGroupFormSheet bind:open={addOpen} mode="create" />
