<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { Download, Landmark } from '@lucide/svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import {
		DATE_FORMAT_OPTIONS,
		DEFAULT_DATE_FORMAT_ID,
		type DateFormatId
	} from '$lib/constants/dateFormats';
	import { cn } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// All accounts selected by default.
	let selected = $state<SvelteSet<string>>(new SvelteSet(data.accounts.map((a) => a.id)));

	// Date format for the exported CSV. The value is a date-fns token the parser
	// recognises, so any choice re-imports safely (see $lib/constants/dateFormats).
	let dateFormat = $state<DateFormatId>(DEFAULT_DATE_FORMAT_ID);
	const dateFormatLabel = $derived(
		DATE_FORMAT_OPTIONS.find((o) => o.id === dateFormat)?.label ?? dateFormat
	);

	const allSelected = $derived(data.accounts.length > 0 && selected.size === data.accounts.length);
	const noneSelected = $derived(selected.size === 0);

	function toggle(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}

	function toggleAll() {
		if (allSelected) selected.clear();
		else for (const a of data.accounts) selected.add(a.id);
	}

	// Build the download URL. When every account is selected we omit the params
	// entirely so the endpoint exports all accessible accounts with a clean URL.
	const downloadHref = $derived.by(() => {
		const base = resolve('/api/export');
		const params = new URLSearchParams();
		if (!allSelected) for (const id of selected) params.append('accountId', id);
		if (dateFormat !== DEFAULT_DATE_FORMAT_ID) params.set('dateFormat', dateFormat);
		const query = params.toString();
		return query ? `${base}?${query}` : base;
	});
</script>

<div class="border-b border-border bg-surface px-4 pt-4 pb-3 md:px-8">
	<h1 class="text-2xl font-semibold text-text-primary">Export</h1>
	<p class="mt-1 text-sm text-text-secondary">
		Download your transactions as a CSV. Re-importing the file is safe — duplicates are detected and
		skipped.
	</p>
</div>

<div class="px-4 py-6 md:px-8">
	{#if data.accounts.length === 0}
		<EmptyState
			icon={Landmark}
			title="No accounts to export"
			description="Add a bank account and upload some transactions first."
		/>
	{:else}
		<div class="mx-auto max-w-xl">
			<div class="overflow-hidden rounded-lg border border-border bg-surface">
				<div class="flex items-center justify-between border-b border-border px-4 py-3">
					<span class="text-sm font-medium text-text-primary">Accounts</span>
					<button
						type="button"
						onclick={toggleAll}
						class="text-xs font-medium text-primary-600 hover:text-primary-700"
					>
						{allSelected ? 'Clear all' : 'Select all'}
					</button>
				</div>

				<ul>
					{#each data.accounts as account (account.id)}
						<li class="border-b border-border last:border-b-0">
							<label
								class="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-sunken"
							>
								<input
									type="checkbox"
									checked={selected.has(account.id)}
									onchange={() => toggle(account.id)}
									class="h-4 w-4 shrink-0 accent-primary-500"
								/>
								<span class="text-sm text-text-primary">{account.displayName}</span>
							</label>
						</li>
					{/each}
				</ul>
			</div>

			<div class="mt-4 overflow-hidden rounded-lg border border-border bg-surface">
				<label for="date-format" class="flex items-center justify-between gap-4 px-4 py-3">
					<span class="flex flex-col">
						<span class="text-sm font-medium text-text-primary">Date format</span>
						<span class="text-xs text-text-tertiary">
							How the Date column is written in the CSV.
						</span>
					</span>
					<Select.Root type="single" bind:value={dateFormat}>
						<Select.Trigger id="date-format" class="w-[190px] font-mono">
							{dateFormatLabel}
						</Select.Trigger>
						<Select.Content>
							{#each DATE_FORMAT_OPTIONS as option (option.id)}
								<Select.Item value={option.id} label={option.label} class="font-mono">
									{option.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</label>
			</div>

			<div class="mt-4 flex items-center justify-between">
				<span class="text-xs text-text-tertiary">
					{selected.size} of {data.accounts.length} selected
				</span>

				{#if noneSelected}
					<Button disabled class="gap-2">
						<Download class="size-4" />
						Download CSV
					</Button>
				{:else}
					<!-- downloadHref is built via resolve(); it carries a query string the rule can't verify statically -->
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
					<a href={downloadHref} download class={cn(buttonVariants(), 'gap-2')}>
						<Download class="size-4" />
						Download CSV
					</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
