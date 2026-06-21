<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';
	import { ArrowRight, Check, Plus, Sparkles } from '@lucide/svelte';
	import type { CategoryRow } from '$lib/types';
	import { CONFIDENCE_HIGH, CONFIDENCE_LOW } from '$lib/constants/ai';

	interface MappingEntry {
		csvCategory: string;
		suggestedMatch: string | null;
		confidence: number;
	}

	interface Props {
		mappings: MappingEntry[];
		workspaceCategories: CategoryRow[];
		decisions: Record<string, string | null>;
	}

	let { mappings, workspaceCategories, decisions = $bindable() }: Props = $props();

	// Track which rows have an open popover
	let openPopovers = $state<Record<string, boolean>>({});

	// Build grouped category list (parents + children)
	const grouped = $derived(
		workspaceCategories
			.filter((c) => c.parentId === null)
			.map((p) => ({
				...p,
				children: workspaceCategories.filter((c) => c.parentId === p.id)
			}))
	);

	function selectCategory(csvCategory: string, categoryName: string | null) {
		decisions[csvCategory] = categoryName;
		openPopovers[csvCategory] = false;
	}

	function confidenceColor(confidence: number): string {
		if (confidence >= CONFIDENCE_HIGH) return 'bg-success-500';
		if (confidence >= CONFIDENCE_LOW) return 'bg-warning-500';
		return 'bg-danger-400';
	}

	function confidenceLabel(confidence: number): string {
		if (confidence >= CONFIDENCE_HIGH) return 'High confidence';
		if (confidence >= CONFIDENCE_LOW) return 'Medium confidence';
		return 'Low confidence';
	}

	// Find the category object for a given name
	function findCategory(name: string | null) {
		if (!name) return null;
		return workspaceCategories.find((c) => c.name === name) ?? null;
	}
</script>

<div>
	<div class="mb-4">
		<div class="mb-1 flex items-center gap-2">
			<Sparkles size={14} class="text-primary-500" />
			<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
				Category mapping
			</p>
		</div>
		<p class="text-xs text-text-secondary">
			We matched your CSV categories to existing ones. Review and adjust before importing.
		</p>
	</div>

	<div class="space-y-1.5">
		{#each mappings as mapping (mapping.csvCategory)}
			{@const chosen = decisions[mapping.csvCategory]}
			{@const chosenCat = findCategory(chosen)}

			<div
				class="flex items-center gap-2 rounded-lg border border-border p-2.5 transition-colors"
			>
				<!-- CSV category name -->
				<div class="min-w-0 flex-1">
					<p class="truncate text-xs font-medium text-text-primary">{mapping.csvCategory}</p>
					{#if mapping.suggestedMatch && mapping.confidence > 0}
						<div class="mt-0.5 flex items-center gap-1.5">
							<span
								class="h-1.5 w-1.5 shrink-0 rounded-full {confidenceColor(mapping.confidence)}"
								title={confidenceLabel(mapping.confidence)}
							></span>
							<span class="text-[10px] text-text-tertiary">
								{Math.round(mapping.confidence * 100)}% match
							</span>
						</div>
					{/if}
				</div>

				<!-- Arrow -->
				<ArrowRight size={12} class="shrink-0 text-text-tertiary" />

				<!-- Category picker -->
				<div class="flex-1">
					<Popover.Root bind:open={openPopovers[mapping.csvCategory]}>
						<Popover.Trigger
							class={cn(
								'flex w-full cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs outline-none transition-colors',
								'border-border hover:border-border-strong focus-visible:ring-1 focus-visible:ring-primary-400'
							)}
						>
							{#if chosenCat}
								<span
									class="h-2 w-2 shrink-0 rounded-full"
									style="background-color: {chosenCat.color}"
								></span>
								<span class="truncate text-text-primary">{chosen}</span>
							{:else if chosen}
								<span class="truncate text-text-primary">{chosen}</span>
							{:else}
								<Plus size={12} class="shrink-0 text-text-tertiary" />
								<span class="text-text-tertiary">Create new</span>
							{/if}
						</Popover.Trigger>

						<Popover.Content
							class="z-50 max-h-60 w-52 gap-1 overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-md"
							align="start"
							sideOffset={4}
						>
							<!-- "Create new" option — keeps the CSV value as-is -->
							<button
								onclick={() => selectCategory(mapping.csvCategory, null)}
								class={cn(
									'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-surface-sunken',
									chosen === null ? 'font-medium text-text-primary' : 'text-text-secondary'
								)}
							>
								<Plus size={12} class="shrink-0" />
								Create new category
							</button>

							<div class="-mx-1 my-1 h-px bg-border"></div>

							<!-- Category tree -->
							{#each grouped as parent}
								<button
									onclick={() => selectCategory(mapping.csvCategory, parent.name)}
									class={cn(
										'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs outline-none hover:bg-surface-sunken',
										chosen === parent.name
											? 'font-medium text-text-primary'
											: 'text-text-secondary'
									)}
								>
									<span
										class="h-1.5 w-1.5 shrink-0 rounded-full"
										style="background-color: {parent.color}"
									></span>
									{parent.name}
									{#if chosen === parent.name}
										<Check size={12} class="ml-auto text-primary-500" />
									{/if}
								</button>
								{#each parent.children as child}
									<button
										onclick={() => selectCategory(mapping.csvCategory, child.name)}
										class={cn(
											'flex w-full items-center gap-2 rounded-md py-1.5 pr-2.5 pl-6 text-left text-xs outline-none hover:bg-surface-sunken',
											chosen === child.name
												? 'font-medium text-text-primary'
												: 'text-text-secondary'
										)}
									>
										<span
											class="h-1.5 w-1.5 shrink-0 rounded-full"
											style="background-color: {child.color}"
										></span>
										{child.name}
										{#if chosen === child.name}
											<Check size={12} class="ml-auto text-primary-500" />
										{/if}
									</button>
								{/each}
							{/each}
						</Popover.Content>
					</Popover.Root>
				</div>
			</div>
		{/each}
	</div>
</div>
