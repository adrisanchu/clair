<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { DropdownMenu } from 'bits-ui';
	import { EllipsisVertical, Pencil, Trash2, Plus, GripVertical } from '@lucide/svelte';
	import CategoryFormSheet from './CategoryFormSheet.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { CategoryRow } from '$lib/types';

	interface Props {
		category: CategoryRow;
		isOwner: boolean;
		/** Indented display for subcategories */
		isChild?: boolean;
		childCount?: number;
	}

	let { category, isOwner, isChild = false, childCount = 0 }: Props = $props();

	// Keep clicks on the action buttons from being read as a drag-start by the
	// surrounding svelte-dnd-action zone (the whole row is draggable).
	function stopDrag(e: MouseEvent) {
		e.stopPropagation();
	}

	let isRenaming = $state(false);
	let renameValue = $state('');
	let editOpen = $state(false);
	let addSubOpen = $state(false);
	let deleteOpen = $state(false);
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

	async function confirmDelete() {
		deleteOpen = false;
		isDeleting = true;
		const res = await fetch(`/api/settings/categories/${category.id}`, { method: 'DELETE' });
		if (res.ok) {
			await invalidateAll();
		}
		isDeleting = false;
	}
</script>

<div
	class="flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-sunken {isDeleting
		? 'opacity-50'
		: ''}"
>
	<!-- Drag handle (owner only) — visual affordance; the whole row is draggable -->
	{#if isOwner}
		<span
			class="shrink-0 cursor-grab text-text-tertiary active:cursor-grabbing"
			aria-hidden="true"
		>
			<GripVertical size={14} />
		</span>
	{/if}

	<!-- Color dot -->
	<span class="h-3 w-3 shrink-0 rounded-full" style="background-color: {category.color}"></span>

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
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="flex shrink-0 items-center gap-0.5" onmousedown={stopDrag}>
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
						onclick={() => (deleteOpen = true)}
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

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete "{category.name}"?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if childCount > 0}
					This category has {childCount} subcategor{childCount === 1 ? 'y' : 'ies'}. Delete them
					first before deleting this category.
				{:else}
					Transactions using this category will keep the label. This action cannot be undone.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			{#if childCount === 0}
				<AlertDialog.Action onclick={confirmDelete}>Delete</AlertDialog.Action>
			{/if}
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
