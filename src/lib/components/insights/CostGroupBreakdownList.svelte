<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import * as Select from '$lib/components/ui/select/index.js';
	import { cn } from '$lib/utils.js';
	import type { CostGroupDetail } from '$lib/insights.js';

	interface Props {
		/** Cost-group names available to pick (workspace registry, ordered). */
		costGroups: string[];
		selected: string | null;
		detail: CostGroupDetail;
		onselect: (name: string) => void;
	}

	let { costGroups, selected, detail, onselect }: Props = $props();

	// Which parent rows are expanded (by category name).
	let expanded = $state<Set<string>>(new Set());

	function toggle(name: string) {
		const next = new Set(expanded);
		if (next.has(name)) next.delete(name);
		else next.add(name);
		expanded = next;
	}

	function formatPct(pct: number): string {
		return `${pct.toLocaleString('es-ES', { maximumFractionDigits: 1 })}%`;
	}
</script>

<div class="space-y-4">
	<!-- Cost-group picker -->
	<div class="flex items-center justify-between gap-3">
		<Select.Root type="single" value={selected ?? ''} onValueChange={(v) => v && onselect(v)}>
			<Select.Trigger class="w-[220px]">
				{selected ?? 'Select a cost group'}
			</Select.Trigger>
			<Select.Content>
				{#each costGroups as name (name)}
					<Select.Item value={name} label={name}>{name}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		{#if selected}
			<div class="text-right">
				<span class="text-xs tracking-wide text-text-tertiary uppercase">Total</span>
				<Amount value={detail.total} size="md" showSign={false} colorize={false} class="ml-2" />
			</div>
		{/if}
	</div>

	{#if !selected}
		<p class="py-8 text-center text-sm text-text-tertiary">
			Pick a cost group to see its spend by category.
		</p>
	{:else if detail.entries.length === 0}
		<p class="py-8 text-center text-sm text-text-tertiary">
			No spend recorded for this cost group in the selected period.
		</p>
	{:else}
		<ul class="divide-y divide-border overflow-hidden rounded-lg border border-border">
			{#each detail.entries as entry (entry.name)}
				{@const isOpen = expanded.has(entry.name)}
				{@const hasChildren = entry.children.length > 0}
				<li>
					<!-- Parent row -->
					<button
						type="button"
						onclick={() => hasChildren && toggle(entry.name)}
						class={cn(
							'flex w-full items-center gap-3 px-3 py-2.5 text-left',
							hasChildren ? 'cursor-pointer hover:bg-surface-sunken' : 'cursor-default'
						)}
					>
						<ChevronRight
							size={14}
							class={cn(
								'shrink-0 text-text-tertiary transition-transform',
								hasChildren ? '' : 'invisible',
								isOpen && 'rotate-90'
							)}
						/>
						<span class="size-2.5 shrink-0 rounded-[3px]" style="background-color: {entry.color}"
						></span>
						<span class="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
							{entry.name}
						</span>
						<!-- pct bar -->
						<div class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken sm:block">
							<div
								class="h-full rounded-full"
								style="width: {Math.min(entry.pct, 100)}%; background-color: {entry.color}"
							></div>
						</div>
						<span class="w-12 text-right text-xs text-text-tertiary tabular-nums">
							{formatPct(entry.pct)}
						</span>
						<Amount
							value={entry.amount}
							size="sm"
							showSign={false}
							colorize={false}
							class="w-24 text-right"
						/>
					</button>

					<!-- Subcategory rows -->
					{#if isOpen}
						<ul class="bg-surface-sunken/40">
							{#each entry.children as child (child.name)}
								<li class="flex items-center gap-3 py-2 pr-3 pl-12 text-sm">
									<span
										class="size-2 shrink-0 rounded-[3px]"
										style="background-color: {child.color}"
									></span>
									<span class="min-w-0 flex-1 truncate text-text-secondary">{child.name}</span>
									<!-- pct bar — same as the parent but dimmed to read as a subcategory -->
									<div
										class="hidden h-1.5 w-24 overflow-hidden rounded-full bg-surface-sunken opacity-60 sm:block"
									>
										<div
											class="h-full rounded-full"
											style="width: {Math.min(child.pct, 100)}%; background-color: {child.color}"
										></div>
									</div>
									<span class="w-12 text-right text-xs text-text-tertiary tabular-nums">
										{formatPct(child.pct)}
									</span>
									<Amount
										value={child.amount}
										size="sm"
										showSign={false}
										colorize={false}
										class="w-24 text-right"
									/>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
