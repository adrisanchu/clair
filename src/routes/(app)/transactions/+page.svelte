<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { format } from 'date-fns';
	import { DropdownMenu } from 'bits-ui';
	import {
		Search,
		ChevronDown,
		X,
		ArrowLeftRight,
		AlertTriangle,
		ChevronLeft,
		ChevronRight,
		Info,
		CircleAlert
	} from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import NoteHint from '$lib/components/NoteHint.svelte';
	import { cn } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// ── Local state ────────────────────────────────────────────────────────────

	let searchInput = $state(data.filters.q);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Keep search input in sync when navigating via other filters
	$effect(() => {
		searchInput = data.filters.q;
	});

	// ── Navigation helpers ─────────────────────────────────────────────────────

	function navigate(params: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [k, v] of Object.entries(params)) {
			if (!v) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		goto(url.toString(), { keepFocus: true });
	}

	function setFilter(filter: string) {
		navigate({ filter: filter === 'all' ? null : filter, page: null });
	}

	function setAccount(accountId: string) {
		navigate({ accountId: accountId || null, page: null });
	}

	function setPage(p: number) {
		navigate({ page: p === 1 ? null : String(p) });
	}

	function clearFilters() {
		goto(page.url.pathname);
	}

	function handleSearch(e: Event) {
		const q = (e.target as HTMLInputElement).value;
		searchInput = q;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => navigate({ q: q || null, page: null }), 350);
	}

	// ── Derived state ──────────────────────────────────────────────────────────

	const activeFilter = $derived(data.filters.filter);
	const activeAccountId = $derived(data.filters.accountId);
	const activeAccountName = $derived(
		data.accounts.find((a) => a.id === activeAccountId)?.displayName ?? null
	);
	const hasFilters = $derived(
		!!(data.filters.q || data.filters.accountId || data.filters.filter !== 'all')
	);

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));
	const currentPage = $derived(data.page);
	const showingFrom = $derived((currentPage - 1) * data.limit + 1);
	const showingTo = $derived(Math.min(currentPage * data.limit, data.total));

	// ── Pagination ─────────────────────────────────────────────────────────────

	function getPaginationPages(cur: number, total: number): (number | '…')[] {
		if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
		const pages: (number | '…')[] = [1];
		if (cur > 3) pages.push('…');
		const start = Math.max(2, cur - 1);
		const end = Math.min(total - 1, cur + 1);
		for (let i = start; i <= end; i++) pages.push(i);
		if (cur < total - 2) pages.push('…');
		pages.push(total);
		return pages;
	}

	const paginationPages = $derived(getPaginationPages(currentPage, totalPages));

	// ── Tabs config ────────────────────────────────────────────────────────────

	const tabs = $derived([
		{ key: 'all', label: 'All', count: data.counts.all },
		{ key: 'expenses', label: 'Expenses', count: data.counts.expenses },
		{ key: 'transfers', label: 'Transfers', count: data.counts.transfers },
		{ key: 'review', label: 'Review', count: data.counts.review }
	]);
</script>

<div class="max-w-5xl px-4 py-6 md:px-8 md:py-8">
	<!-- ── Page header ────────────────────────────────────────────────────────── -->
	<div class="border-b border-border pb-4">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold text-text-primary">Transactions</h1>
				<p class="mt-0.5 text-xs font-semibold tracking-widest text-text-tertiary uppercase">
					Ledger history
				</p>
			</div>

			<!-- Tab filter pills — using buttonVariants for consistent base styles -->
			<div class="flex flex-wrap items-center gap-1.5">
				{#each tabs as tab}
					<button
						onclick={() => setFilter(tab.key)}
						class={cn(
							buttonVariants({ size: 'sm' }),
							'gap-1.5 rounded-full',
							activeFilter === tab.key
								? 'border-transparent bg-primary-500 text-white hover:bg-primary-600'
								: 'border-border bg-transparent text-text-secondary hover:bg-surface-sunken hover:text-text-primary'
						)}
					>
						{tab.label}
						{#if tab.key === 'review' && tab.count > 0}
							<span
								class={cn(
									'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
									activeFilter === 'review' ? 'bg-white/25 text-white' : 'bg-danger-500 text-white'
								)}
							>
								{tab.count}
							</span>
						{:else}
							<span class={activeFilter === tab.key ? 'text-white/75' : 'text-text-tertiary'}>
								({tab.count})
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- ── Filter bar ─────────────────────────────────────────────────────────── -->
	<div class="flex flex-wrap items-center gap-2 border-b border-border bg-surface-raised py-3">
		<!-- Search using shadcn Input -->
		<div class="relative min-w-48 flex-1">
			<Search
				size={14}
				class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-tertiary"
			/>
			<Input
				type="search"
				placeholder="Search transactions…"
				value={searchInput}
				oninput={handleSearch}
				class="h-8 pl-8 text-sm"
			/>
		</div>

		<!-- Account filter — bits-ui DropdownMenu with shadcn Button trigger -->
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						variant="outline"
						size="sm"
						{...props}
						class={cn(
							'gap-1.5',
							activeAccountId
								? 'border-primary-300 bg-primary-50 text-primary-600 hover:bg-primary-100'
								: ''
						)}
					>
						{activeAccountName ?? 'Account'}
						<ChevronDown size={13} class="text-muted-foreground" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 text-sm shadow-md"
				sideOffset={4}
			>
				<DropdownMenu.Item
					class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary outline-none hover:bg-surface-sunken {!activeAccountId
						? 'font-medium'
						: ''}"
					onclick={() => setAccount('')}
				>
					All accounts
				</DropdownMenu.Item>
				<DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />
				{#each data.accounts as account}
					<DropdownMenu.Item
						class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary outline-none hover:bg-surface-sunken {activeAccountId ===
						account.id
							? 'font-medium text-primary-600'
							: ''}"
						onclick={() => setAccount(account.id)}
					>
						{account.displayName}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<!-- Clear filters — shadcn Button -->
		{#if hasFilters}
			<Button
				variant="ghost"
				size="sm"
				onclick={clearFilters}
				class="gap-1 text-primary-500 hover:bg-primary-50 hover:text-primary-600"
			>
				<X size={12} />
				Clear filters
			</Button>
		{/if}
	</div>

	<!-- ── Transactions table ──────────────────────────────────────────────────── -->
	<div class="overflow-x-auto">
		{#if data.rows.length === 0}
			<div class="flex flex-col items-center justify-center px-4 py-24 text-center">
				<p class="mb-1 text-sm font-medium text-text-primary">No transactions found</p>
				<p class="text-sm text-text-secondary">
					{hasFilters ? 'Try adjusting your filters.' : 'Upload a CSV to get started.'}
				</p>
				{#if hasFilters}
					<Button variant="link" onclick={clearFilters} class="mt-3 text-primary-500">
						Clear all filters
					</Button>
				{/if}
			</div>
		{:else}
			<table class="w-full border-collapse text-sm">
				<thead>
					<tr class="border-b border-border bg-surface-raised">
						<th
							class="w-36 px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase md:px-4"
						>
							Date
						</th>
						<th
							class="px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
						>
							Description
						</th>
						<th
							class="hidden w-36 px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase md:table-cell"
						>
							Account
						</th>
						<th
							class="hidden w-36 px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase lg:table-cell"
						>
							Category
						</th>
						<th
							class="w-32 px-2 py-2.5 text-right text-[10px] font-semibold tracking-wider text-text-tertiary uppercase md:px-4"
						>
							Amount
						</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as tx (tx.id)}
						{@const isReview = tx.status === 'review'}
						{@const isTransfer = tx.isTransfer}
						{@const isOpening = tx.isOpeningBalance}

						{#if isOpening}
							<!-- Opening balance row — read-only, visually distinct -->
							<tr class="border-b border-border bg-surface-sunken/40 opacity-70">
								<td
									class="px-2 py-3 text-xs whitespace-nowrap text-text-tertiary tabular-nums md:px-4"
								>
									{format(tx.accountingDate, 'd MMM yyyy')}
								</td>
								<td class="max-w-xs px-2 py-3">
									<div class="flex min-w-0 items-center gap-2">
										<span class="truncate text-xs text-text-tertiary italic">{tx.description}</span>
										{#if tx.notes}
											<NoteHint note={tx.notes} />
										{/if}
									</div>
									{#if tx.accountName}
										<span class="mt-0.5 block text-[10px] text-text-tertiary md:hidden">
											{tx.accountName}
										</span>
									{/if}
								</td>
								<td class="hidden px-2 py-3 md:table-cell">
									{#if tx.accountName}
										<span
											class="inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
										>
											{tx.accountName}
										</span>
									{/if}
								</td>
								<td class="hidden px-2 py-3 lg:table-cell">
									<span class="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
										<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong"></span>
										Opening balance
									</span>
								</td>
								<td class="px-2 py-3 text-right md:px-4">
									<Amount value={tx.amount} currency={tx.currency} size="sm" />
								</td>
							</tr>
						{:else}
							<tr
								class={cn(
									'border-b border-border transition-colors hover:bg-surface-sunken/60',
									isReview && 'border-l-2 border-l-amber-400'
								)}
							>
								<!-- Date -->
								<td
									class="px-2 py-3 text-xs whitespace-nowrap text-text-tertiary tabular-nums md:px-4"
								>
									{format(tx.accountingDate, 'd MMM yyyy')}
								</td>

								<!-- Description -->
								<td class="max-w-xs px-2 py-3 text-text-primary">
									<div class="flex min-w-0 items-center gap-2">
										{#if isTransfer}
											<ArrowLeftRight size={13} class="shrink-0 text-text-tertiary" />
										{:else if isReview}
											<AlertTriangle size={13} class="shrink-0 text-amber-500" />
										{/if}
										<span class="truncate font-medium">{tx.description}</span>
										{#if tx.notes}
											<NoteHint note={tx.notes} />
										{/if}
									</div>
									{#if tx.accountName}
										<span class="mt-0.5 block text-[10px] text-text-tertiary md:hidden">
											{tx.accountName}
										</span>
									{/if}
								</td>

								<!-- Account (desktop) -->
								<td class="hidden px-2 py-3 md:table-cell">
									{#if tx.accountName}
										<span
											class="inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-secondary uppercase"
										>
											{tx.accountName}
										</span>
									{/if}
								</td>

								<!-- Category (desktop) -->
								<td class="hidden px-2 py-3 lg:table-cell">
									{#if isReview}
										<span class="inline-flex items-center gap-1.5 text-xs text-amber-600">
											<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"></span>
											Review Required
										</span>
									{:else if isTransfer}
										<span class="inline-flex items-center gap-1.5 text-xs text-text-tertiary">
											<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong"></span>
											Transfer
										</span>
									{:else if tx.category}
										<span class="inline-flex items-center gap-1.5 text-xs text-text-secondary">
											<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400"></span>
											{tx.category}
										</span>
									{:else}
										<span class="text-xs text-text-tertiary">—</span>
									{/if}
								</td>

								<!-- Amount -->
								<td class="px-2 py-3 text-right md:px-4">
									<Amount value={tx.amount} currency={tx.currency} size="sm" />
									{#if tx.currency !== 'EUR'}
										{#if tx.amountEur != null}
											<div class="mt-0.5 font-mono text-[11px] tabular-nums text-text-tertiary">
												<Amount value={tx.amountEur} currency="EUR" size="sm" colorize={false} />
											</div>
										{:else}
											<div class="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-amber-500">
												<CircleAlert size={10} />
												<span class="font-mono">— EUR</span>
											</div>
										{/if}
									{/if}
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<!-- ── Footer / Pagination ────────────────────────────────────────────────── -->
	{#if data.total > 0}
		<div
			class="flex flex-wrap items-center justify-between gap-4 border-t border-border bg-surface py-3 md:px-8"
		>
			<!-- Count label -->
			<p class="text-xs text-text-tertiary">
				Showing {showingFrom}–{showingTo} of {data.total}
				{data.total === 1 ? 'transaction' : 'transactions'}
			</p>

			<!-- Pagination — all using shadcn Button -->
			{#if totalPages > 1}
				<div class="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon-sm"
						disabled={currentPage === 1}
						onclick={() => setPage(currentPage - 1)}
					>
						<ChevronLeft size={14} />
					</Button>

					{#each paginationPages as p}
						{#if p === '…'}
							<span class="w-8 text-center text-xs text-text-tertiary select-none">…</span>
						{:else}
							<Button
								variant={p === currentPage ? 'default' : 'ghost'}
								size="icon-sm"
								onclick={() => setPage(p as number)}
								class={p === currentPage ? 'bg-primary-500 hover:bg-primary-600' : ''}
							>
								{p}
							</Button>
						{/if}
					{/each}

					<Button
						variant="ghost"
						size="icon-sm"
						disabled={currentPage === totalPages}
						onclick={() => setPage(currentPage + 1)}
					>
						<ChevronRight size={14} />
					</Button>
				</div>
			{/if}
		</div>
	{/if}
</div>
