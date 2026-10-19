<script lang="ts" module>
	export interface CheckboxListItem {
		id: string;
		label: string;
		/** Optional color dot shown before the label (categories, cost groups). */
		color?: string;
		/** Indented display (e.g. subcategories). */
		indent?: boolean;
		/** Checked and locked because a parent selection already covers it. */
		implied?: boolean;
	}
</script>

<script lang="ts">
	import type { SvelteSet } from 'svelte/reactivity';
	import { cn } from '$lib/utils';

	interface Props {
		title: string;
		items: CheckboxListItem[];
		/** Mutated in place — the caller owns the set. */
		selected: SvelteSet<string>;
		/** Compact rows for use inside popovers. */
		size?: 'default' | 'sm';
		/** Extra classes for the scrollable list (e.g. a max height). */
		listClass?: string;
		class?: string;
	}

	let { title, items, selected, size = 'default', listClass, class: className }: Props = $props();

	const allSelected = $derived(
		items.length > 0 && items.every((i) => i.implied || selected.has(i.id))
	);

	function toggle(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function toggleAll() {
		if (allSelected) for (const i of items) selected.delete(i.id);
		else for (const i of items) selected.add(i.id);
	}
</script>

<div class={cn('overflow-hidden', className)}>
	<div
		class={cn(
			'flex items-center justify-between border-b border-border',
			size === 'sm' ? 'px-3 py-2' : 'px-4 py-3'
		)}
	>
		<span
			class={cn(
				'font-medium text-text-primary',
				size === 'sm' ? 'text-xs tracking-wider text-text-secondary uppercase' : 'text-sm'
			)}
		>
			{title}
		</span>
		{#if items.length > 0}
			<button
				type="button"
				onclick={toggleAll}
				class="text-xs font-medium text-primary-600 hover:text-primary-700"
			>
				{allSelected ? 'Clear all' : 'Select all'}
			</button>
		{/if}
	</div>

	{#if items.length === 0}
		<p class={cn('text-text-tertiary', size === 'sm' ? 'px-3 py-2 text-xs' : 'px-4 py-3 text-sm')}>
			Nothing here yet.
		</p>
	{:else}
		<ul class={listClass}>
			{#each items as item (item.id)}
				<li class={cn(size === 'default' && 'border-b border-border last:border-b-0')}>
					<label
						class={cn(
							'flex items-center hover:bg-surface-sunken',
							item.implied ? 'cursor-default' : 'cursor-pointer',
							size === 'sm' ? 'gap-2.5 px-3 py-1.5' : 'gap-3 px-4 py-3',
							item.indent && (size === 'sm' ? 'pl-8' : 'pl-10')
						)}
					>
						<input
							type="checkbox"
							checked={item.implied || selected.has(item.id)}
							disabled={item.implied}
							onchange={() => toggle(item.id)}
							class="h-4 w-4 shrink-0 accent-primary-500 disabled:opacity-60"
						/>
						{#if item.color}
							<span class="h-2.5 w-2.5 shrink-0 rounded-full" style="background-color: {item.color}"
							></span>
						{/if}
						<span
							class={cn(
								'truncate text-sm text-text-primary',
								item.implied && 'text-text-secondary'
							)}
						>
							{item.label}
						</span>
					</label>
				</li>
			{/each}
		</ul>
	{/if}
</div>
