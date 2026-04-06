<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { DropdownMenu } from 'bits-ui';
	import { EllipsisVertical, Pencil, Trash2, Plus } from '@lucide/svelte';
	import CategoryFormSheet from './CategoryFormSheet.svelte';
	import type { CategoryRow } from '$lib/types';

	interface Props {
		category: CategoryRow;
		isOwner: boolean;
		/** Indented display for subcategories */
		isChild?: boolean;
		childCount?: number;
	}

	let { category, isOwner, isChild = false, childCount = 0 }: Props = $props();

	let isRenaming = $state(false);
	let renameValue = $state('');
	let editOpen = $state(false);
	let addSubOpen = $state(false);
	let isDeleting = $state(false);

	function startRename() {
		isRenaming = true;
		renameValue = category.name;
	}

	async function submitRename() {
		const trimmed = renameValue.trim();
		isRenaming = false;
		if (!trimmed || trimmed === category.name) return;

		await fetch(`/api/settings/categories/${category.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: trimmed })
		});
		await invalidateAll();
	}

	async function handleDelete() {
		const msg = childCount > 0
			? `"${category.name}" has ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'}. Delete them first.`
			: `Delete "${category.name}"? Transactions using this category will keep the label.`;

		if (childCount > 0) {
			alert(msg);
			return;
		}
		if (!confirm(msg)) return;

		isDeleting = true;
		const res = await fetch(`/api/settings/categories/${category.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const data = await res.json().catch(() => ({ message: 'Error deleting category' }));
			alert(data.message ?? 'Error deleting category');
		} else {
			await invalidateAll();
		}
		isDeleting = false;
	}
</script>

<div
	class="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-sunken {isChild
		? 'ml-6'
		: ''} {isDeleting ? 'opacity-50' : ''}"
>
	<!-- Color dot -->
	<span
		class="h-3 w-3 shrink-0 rounded-full"
		style="background-color: {category.color}"
	></span>

	<!-- Name (or inline rename input) -->
	<div class="min-w-0 flex-1">
		{#if isRenaming}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				type="text"
				bind:value={renameValue}
				onblur={submitRename}
				onkeydown={(e) => {
					if (e.key === 'Enter') submitRename();
					if (e.key === 'Escape') isRenaming = false;
				}}
				class="w-full rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-primary-500/30"
				autofocus
			/>
		{:else}
			<span class="truncate text-sm font-medium text-text-primary">{category.name}</span>
			{#if !isChild && childCount > 0}
				<span class="ml-2 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-xs text-text-tertiary">
					{childCount}
				</span>
			{/if}
		{/if}
	</div>

	<!-- Owner actions -->
	{#if isOwner}
		<div class="flex shrink-0 items-center gap-0.5">
			{#if !isChild}
				<button
					class="rounded p-1 text-text-tertiary transition-colors hover:text-text-secondary"
					onclick={() => (addSubOpen = true)}
					title="Add subcategory"
					type="button"
				>
					<Plus size={13} />
				</button>
			{/if}

			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							class="rounded p-1 text-text-tertiary transition-colors hover:text-text-secondary"
						>
							<EllipsisVertical size={14} />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content
					class="z-50 min-w-36 rounded-lg border border-border bg-surface p-1 text-sm shadow-md"
					sideOffset={4}
				>
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary outline-none hover:bg-surface-sunken"
						onclick={startRename}
					>
						<Pencil size={13} class="text-text-tertiary" />
						Rename
					</DropdownMenu.Item>
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary outline-none hover:bg-surface-sunken"
						onclick={() => (editOpen = true)}
					>
						<Pencil size={13} class="text-text-tertiary" />
						Edit color
					</DropdownMenu.Item>
					<DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-danger-600 outline-none hover:bg-danger-50"
						onclick={handleDelete}
					>
						<Trash2 size={13} />
						Delete
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</div>
	{/if}
</div>

<!-- Edit sheet (color only — name handled by inline rename) -->
<CategoryFormSheet bind:open={editOpen} mode="edit" {category} />

<!-- Add subcategory sheet -->
{#if !isChild}
	<CategoryFormSheet bind:open={addSubOpen} mode="create" parentId={category.id} />
{/if}
