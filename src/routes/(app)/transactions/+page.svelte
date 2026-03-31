<script lang="ts">
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { format } from 'date-fns'
	import { DropdownMenu } from 'bits-ui'
	import { Search, ChevronDown, X, ArrowLeftRight, AlertTriangle, ChevronLeft, ChevronRight } from '@lucide/svelte'
	import Amount from '$lib/components/Amount.svelte'
	import { Button } from '$lib/components/ui/button'
	import { Input } from '$lib/components/ui/input'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	// ── Local state ────────────────────────────────────────────────────────────

	let searchInput = $state(data.filters.q)
	let debounceTimer: ReturnType<typeof setTimeout> | undefined

	// Keep search input in sync when navigating via other filters
	$effect(() => {
		searchInput = data.filters.q
	})

	// ── Navigation helpers ─────────────────────────────────────────────────────

	function navigate(params: Record<string, string | null>) {
		const url = new URL(page.url)
		for (const [k, v] of Object.entries(params)) {
			if (!v) {
				url.searchParams.delete(k)
			} else {
				url.searchParams.set(k, v)
			}
		}
		goto(url.toString(), { keepFocus: true })
	}

	function setFilter(filter: string) {
		navigate({ filter: filter === 'all' ? null : filter, page: null })
	}

	function setAccount(accountId: string) {
		navigate({ accountId: accountId || null, page: null })
	}

	function setPage(p: number) {
		navigate({ page: p === 1 ? null : String(p) })
	}

	function clearFilters() {
		goto(page.url.pathname)
	}

	function handleSearch(e: Event) {
		const q = (e.target as HTMLInputElement).value
		searchInput = q
		clearTimeout(debounceTimer)
		debounceTimer = setTimeout(() => {
			navigate({ q: q || null, page: null })
		}, 350)
	}

	// ── Derived state ──────────────────────────────────────────────────────────

	const activeFilter = $derived(data.filters.filter)
	const activeAccountId = $derived(data.filters.accountId)
	const activeAccountName = $derived(
		data.accounts.find((a) => a.id === activeAccountId)?.displayName ?? null
	)
	const hasFilters = $derived(!!(data.filters.q || data.filters.accountId || data.filters.filter !== 'all'))

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)))
	const currentPage = $derived(data.page)
	const showingFrom = $derived((currentPage - 1) * data.limit + 1)
	const showingTo = $derived(Math.min(currentPage * data.limit, data.total))

	// ── Pagination pages ───────────────────────────────────────────────────────

	function getPaginationPages(cur: number, total: number): (number | '…')[] {
		if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
		const pages: (number | '…')[] = [1]
		if (cur > 3) pages.push('…')
		const start = Math.max(2, cur - 1)
		const end = Math.min(total - 1, cur + 1)
		for (let i = start; i <= end; i++) pages.push(i)
		if (cur < total - 2) pages.push('…')
		pages.push(total)
		return pages
	}

	const paginationPages = $derived(getPaginationPages(currentPage, totalPages))

	// ── Tabs config ────────────────────────────────────────────────────────────

	const tabs = $derived([
		{ key: 'all', label: 'All', count: data.counts.all },
		{ key: 'expenses', label: 'Expenses', count: data.counts.expenses },
		{ key: 'transfers', label: 'Transfers', count: data.counts.transfers },
		{ key: 'review', label: 'Review', count: data.counts.review }
	])
</script>

<div>
	<!-- ── Page header ─────────────────────────────────────────────────────────── -->
	<div class="px-4 pt-6 pb-4 md:px-8 md:pt-8 border-b border-border">
		<div class="flex items-start justify-between gap-4 flex-wrap">
			<div>
				<h1 class="text-2xl font-semibold text-text-primary">Transactions</h1>
				<p class="text-xs font-semibold uppercase tracking-widest text-text-tertiary mt-0.5">
					Ledger history
				</p>
			</div>

			<!-- Tab filter pills -->
			<div class="flex items-center gap-1 flex-wrap">
				{#each tabs as tab}
					<button
						onclick={() => setFilter(tab.key)}
						class="relative flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors {activeFilter === tab.key
							? 'bg-primary-500 text-white shadow-sm'
							: 'text-text-secondary hover:text-text-primary hover:bg-surface-sunken border border-border'}"
					>
						{tab.label}
						{#if tab.key === 'review' && tab.count > 0}
							<span
								class="flex items-center justify-center rounded-full text-[10px] font-bold min-w-4 h-4 px-1 {activeFilter === 'review'
									? 'bg-white/25 text-white'
									: 'bg-danger-500 text-white'}"
							>
								{tab.count}
							</span>
						{:else}
							<span
								class="text-xs {activeFilter === tab.key
									? 'text-white/80'
									: 'text-text-tertiary'}"
							>
								({tab.count})
							</span>
						{/if}
					</button>
				{/each}
			</div>
		</div>
	</div>

	<!-- ── Filter bar ─────────────────────────────────────────────────────────── -->
	<div class="px-4 py-3 md:px-8 border-b border-border bg-surface-raised flex items-center gap-2 flex-wrap">
		<!-- Search -->
		<div class="relative flex-1 min-w-48">
			<Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
			<Input
				type="search"
				placeholder="Search transactions…"
				value={searchInput}
				oninput={handleSearch}
				class="pl-8 h-8 text-sm bg-surface"
			/>
		</div>

		<!-- Account filter -->
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						{...props}
						class="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 h-8 text-sm text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors {activeAccountId ? 'border-primary-300 text-primary-600 bg-primary-50' : ''}"
					>
						{activeAccountName ?? 'Account'}
						<ChevronDown size={13} class="text-text-tertiary" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="z-50 min-w-44 rounded-lg border border-border bg-surface shadow-md p-1 text-sm"
				sideOffset={4}
			>
				<DropdownMenu.Item
					class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary hover:bg-surface-sunken cursor-pointer outline-none {!activeAccountId ? 'font-medium' : ''}"
					onclick={() => setAccount('')}
				>
					All accounts
				</DropdownMenu.Item>
				<DropdownMenu.Separator class="my-1 -mx-1 h-px bg-border" />
				{#each data.accounts as account}
					<DropdownMenu.Item
						class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary hover:bg-surface-sunken cursor-pointer outline-none {activeAccountId === account.id ? 'font-medium text-primary-600' : ''}"
						onclick={() => setAccount(account.id)}
					>
						{account.displayName}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>

		<!-- Clear filters -->
		{#if hasFilters}
			<button
				onclick={clearFilters}
				class="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary-500 hover:text-primary-600 transition-colors"
			>
				<X size={12} />
				Clear filters
			</button>
		{/if}
	</div>

	<!-- ── Transactions table ──────────────────────────────────────────────────── -->
	<div class="overflow-x-auto">
		{#if data.rows.length === 0}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center py-24 text-center px-4">
				<p class="text-sm font-medium text-text-primary mb-1">No transactions found</p>
				<p class="text-sm text-text-secondary">
					{hasFilters ? 'Try adjusting your filters.' : 'Upload a CSV to get started.'}
				</p>
				{#if hasFilters}
					<button onclick={clearFilters} class="mt-4 text-sm text-primary-500 hover:underline">
						Clear all filters
					</button>
				{/if}
			</div>
		{:else}
			<table class="w-full text-sm border-collapse">
				<thead>
					<tr class="border-b border-border bg-surface-raised">
						<th class="text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-4 md:px-8 py-2.5 w-32">
							Date
						</th>
						<th class="text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-3 py-2.5">
							Description
						</th>
						<th class="text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-3 py-2.5 w-36 hidden md:table-cell">
							Account
						</th>
						<th class="text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-3 py-2.5 w-36 hidden lg:table-cell">
							Category
						</th>
						<th class="text-right text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-4 md:px-8 py-2.5 w-32">
							Amount
						</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as tx (tx.id)}
						{@const isReview = tx.status === 'review'}
						{@const isTransfer = tx.isTransfer}
						<tr
							class="border-b border-border hover:bg-surface-sunken/60 transition-colors group {isReview ? 'border-l-2 border-l-amber-400' : ''}"
						>
							<!-- Date -->
							<td class="px-4 md:px-8 py-3 text-text-tertiary whitespace-nowrap text-xs tabular-nums {isReview ? 'pl-3.5 md:pl-7.5' : ''}">
								{format(tx.bookingDate, 'd MMM yyyy')}
							</td>

							<!-- Description -->
							<td class="px-3 py-3 text-text-primary max-w-xs">
								<div class="flex items-center gap-2 min-w-0">
									{#if isTransfer}
										<ArrowLeftRight size={13} class="text-text-tertiary shrink-0" />
									{:else if isReview}
										<AlertTriangle size={13} class="text-amber-500 shrink-0" />
									{/if}
									<span class="truncate font-medium">{tx.description}</span>
								</div>
								<!-- Account shown on mobile only -->
								{#if tx.accountName}
									<span class="md:hidden text-[10px] text-text-tertiary mt-0.5 block">{tx.accountName}</span>
								{/if}
							</td>

							<!-- Account (desktop) -->
							<td class="px-3 py-3 hidden md:table-cell">
								{#if tx.accountName}
									<span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-surface-sunken text-text-secondary border border-border">
										{tx.accountName}
									</span>
								{/if}
							</td>

							<!-- Category (desktop) -->
							<td class="px-3 py-3 hidden lg:table-cell">
								{#if isReview}
									<span class="inline-flex items-center gap-1 text-xs text-amber-600">
										<span class="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
										Review Required
									</span>
								{:else if isTransfer}
									<span class="inline-flex items-center gap-1 text-xs text-text-tertiary">
										<span class="w-1.5 h-1.5 rounded-full bg-text-tertiary/40 shrink-0"></span>
										Transfer
									</span>
								{:else if tx.category}
									<span class="inline-flex items-center gap-1 text-xs text-text-secondary">
										<span class="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0"></span>
										{tx.category}
									</span>
								{:else}
									<span class="text-xs text-text-tertiary">—</span>
								{/if}
							</td>

							<!-- Amount -->
							<td class="px-4 md:px-8 py-3 text-right">
								<Amount value={tx.amount} currency={tx.currency} size="sm" />
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>

	<!-- ── Footer / Pagination ────────────────────────────────────────────────── -->
	{#if data.total > 0}
		<div class="px-4 md:px-8 py-3 border-t border-border bg-surface flex items-center justify-between gap-4 flex-wrap">
			<!-- Count label -->
			<p class="text-xs text-text-tertiary">
				Showing {showingFrom}–{showingTo} of {data.total} transaction{data.total === 1 ? '' : 's'}
			</p>

			<!-- Pagination -->
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
							<span class="w-8 text-center text-xs text-text-tertiary">…</span>
						{:else}
							<button
								onclick={() => setPage(p as number)}
								class="w-8 h-8 rounded-md text-sm font-medium transition-colors {p === currentPage
									? 'bg-primary-500 text-white'
									: 'text-text-secondary hover:bg-surface-sunken'}"
							>
								{p}
							</button>
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
