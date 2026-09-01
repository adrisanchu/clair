<script lang="ts">
	import { Tags } from '@lucide/svelte';
	import { flip } from 'svelte/animate';
	import { dndzone, SOURCES, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
	import { invalidateAll } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import CategoryRow from './CategoryRow.svelte';
	import CategoryFormSheet from './CategoryFormSheet.svelte';
	import type { CategoryRow as CategoryRowType, CategoryReorderItem } from '$lib/types';

	interface Props {
		categories: CategoryRowType[];
		isOwner: boolean;
	}

	let { categories, isOwner }: Props = $props();

	let addOpen = $state(false);
	const flipDurationMs = 150;

	// ─── Local, drag-mutable tree ──────────────────────────────────────────────
	// Seeded from the server `categories` prop; drops mutate these optimistically,
	// then we persist and re-sync via invalidateAll(). Never mutates category names,
	// so transaction labels (which link by name) are unaffected.

	function buildTree(source: CategoryRowType[]) {
		const parents = source.filter((c) => c.parentId === null);
		const map: Record<string, CategoryRowType[]> = {};
		for (const p of parents) map[p.id] = [];
		for (const c of source) {
			if (c.parentId !== null && map[c.parentId]) map[c.parentId].push(c);
		}
		return { parents, map };
	}

	const seed = buildTree(categories);
	let rootItems = $state<CategoryRowType[]>(seed.parents);
	let childMap = $state<Record<string, CategoryRowType[]>>(seed.map);

	// Re-sync whenever the server data changes (initial mount + after invalidateAll).
	// Not tracked during a drag because only rootItems/childMap change then, not `categories`.
	$effect(() => {
		resetFromServer();
	});

	function resetFromServer() {
		const { parents, map } = buildTree(categories);
		rootItems = parents;
		childMap = map;
	}

	// ─── Drag state ────────────────────────────────────────────────────────────
	let dragDisabled = $state(true);
	let isDragging = $state(false);
	let hint = $state('');
	let hintTimer: ReturnType<typeof setTimeout> | undefined;

	function showHint(msg: string) {
		hint = msg;
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => (hint = ''), 4000);
	}

	function startGrab(e: MouseEvent | TouchEvent) {
		if (!isOwner) return;
		e.preventDefault();
		dragDisabled = false;
	}

	function grabKeydown(e: KeyboardEvent) {
		if (!isOwner) return;
		if ((e.key === 'Enter' || e.key === ' ') && dragDisabled) {
			e.preventDefault();
			dragDisabled = false;
		}
	}

	function syncDragState(e: CustomEvent<DndEvent<CategoryRowType>>) {
		isDragging = true;
		const { source, trigger } = e.detail.info;
		if (source === SOURCES.KEYBOARD && trigger === TRIGGERS.DRAG_STOPPED) dragDisabled = true;
	}

	function finishDrag(e: CustomEvent<DndEvent<CategoryRowType>>) {
		isDragging = false;
		if (e.detail.info.source === SOURCES.POINTER) dragDisabled = true;
		scheduleValidateAndPersist();
	}

	// ─── Zone handlers ─────────────────────────────────────────────────────────
	function considerRoot(e: CustomEvent<DndEvent<CategoryRowType>>) {
		rootItems = e.detail.items;
		syncDragState(e);
	}
	function finalizeRoot(e: CustomEvent<DndEvent<CategoryRowType>>) {
		rootItems = e.detail.items;
		finishDrag(e);
	}
	function considerChild(parentId: string, e: CustomEvent<DndEvent<CategoryRowType>>) {
		childMap[parentId] = e.detail.items;
		syncDragState(e);
	}
	function finalizeChild(parentId: string, e: CustomEvent<DndEvent<CategoryRowType>>) {
		childMap[parentId] = e.detail.items;
		finishDrag(e);
	}

	// ─── Persist ───────────────────────────────────────────────────────────────
	// A cross-zone move fires finalize on both source and target zones; coalesce
	// into a single validate + persist pass via a microtask.
	let persistScheduled = false;
	function scheduleValidateAndPersist() {
		if (persistScheduled) return;
		persistScheduled = true;
		queueMicrotask(() => {
			persistScheduled = false;
			validateAndPersist();
		});
	}

	function buildPayload(): CategoryReorderItem[] {
		const out: CategoryReorderItem[] = [];
		rootItems.forEach((p, i) => {
			out.push({ id: p.id, parentId: null, sortOrder: i });
			(childMap[p.id] ?? []).forEach((c, j) => {
				out.push({ id: c.id, parentId: p.id, sortOrder: j });
			});
		});
		return out;
	}

	async function validateAndPersist() {
		// Illegal nesting: a category dropped one level deep that itself has children
		// would create a 3rd level. Block it, revert, and hint.
		for (const p of rootItems) {
			for (const c of childMap[p.id] ?? []) {
				if ((childMap[c.id]?.length ?? 0) > 0) {
					showHint(`"${c.name}" has subcategories — move those out before nesting it.`);
					resetFromServer();
					return;
				}
			}
		}

		const res = await fetch('/api/settings/categories/reorder', {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ items: buildPayload() })
		});

		if (!res.ok) {
			showHint('Could not save the new order — reverted.');
			resetFromServer();
			return;
		}

		await invalidateAll();
	}

	const dropTargetClasses = ['rounded-lg', 'ring-1', 'ring-primary-500/30', 'bg-primary-500/5'];
</script>

<div class="space-y-1">
	{#if rootItems.length === 0}
		<div
			class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12"
		>
			<Tags size={32} class="text-text-tertiary" />
			<div class="text-center">
				<p class="text-sm font-medium text-text-primary">No categories yet</p>
				<p class="mt-1 text-xs text-text-secondary">
					Add categories to organise your transactions.
				</p>
			</div>
			{#if isOwner}
				<Button size="sm" onclick={() => (addOpen = true)}>Add category</Button>
			{/if}
		</div>
	{:else}
		<div class="rounded-xl border border-border bg-surface">
			<div
				use:dndzone={{
					items: rootItems,
					dragDisabled,
					flipDurationMs,
					dropTargetStyle: {},
					dropTargetClasses,
					type: 'categories'
				}}
				onconsider={considerRoot}
				onfinalize={finalizeRoot}
			>
				{#each rootItems as parent, i (parent.id)}
					<div animate:flip={{ duration: flipDurationMs }}>
						{#if i > 0}
							<div class="mx-3 h-px bg-border"></div>
						{/if}
						<CategoryRow
							category={parent}
							{isOwner}
							isChild={false}
							childCount={(childMap[parent.id] ?? []).length}
							{dragDisabled}
							onGrab={startGrab}
							onGrabKeydown={grabKeydown}
						/>

						<!-- Nested child zone: accepts reordering + re-nesting into this parent -->
						<div
							class="ml-6 min-h-2 {isDragging
								? 'my-1 rounded-lg border border-dashed border-border/70'
								: ''}"
							use:dndzone={{
								items: childMap[parent.id] ?? [],
								dragDisabled,
								flipDurationMs,
								dropTargetStyle: {},
								dropTargetClasses,
								type: 'categories'
							}}
							onconsider={(e) => considerChild(parent.id, e)}
							onfinalize={(e) => finalizeChild(parent.id, e)}
						>
							{#each childMap[parent.id] ?? [] as child (child.id)}
								<div animate:flip={{ duration: flipDurationMs }}>
									<CategoryRow
										category={child}
										{isOwner}
										isChild={true}
										{dragDisabled}
										onGrab={startGrab}
										onGrabKeydown={grabKeydown}
									/>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>

		{#if hint}
			<p class="px-1 pt-1 text-xs text-danger-600">{hint}</p>
		{/if}

		{#if isOwner}
			<div class="pt-2">
				<Button variant="outline" size="sm" onclick={() => (addOpen = true)}>Add category</Button>
			</div>
		{/if}
	{/if}
</div>

<CategoryFormSheet bind:open={addOpen} mode="create" />
