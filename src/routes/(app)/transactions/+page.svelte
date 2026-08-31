<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
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
		CircleAlert,
		ReceiptText
	} from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';
	import { Badge } from '$lib/components/ui/badge';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import NoteHint from '$lib/components/NoteHint.svelte';
	import TransferHint from '$lib/components/TransferHint.svelte';
	import TransferPairDialog from '$lib/components/transfers/TransferPairDialog.svelte';
	import TransactionDetailSheet from '$lib/components/transactions/TransactionDetailSheet.svelte';
	import CategorySelector from '$lib/components/CategorySelector.svelte';
	import CostGroupTag from '$lib/components/CostGroupTag.svelte';
	import { cn } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/**
	 * Bare number for the "incl. 21,00 fee" hint — no currency code, since the fee is always in
	 * the same currency as the amount shown directly above it (keeps the line short + single-row).
	 */
	function formatFee(value: number): string {
		return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2 }).format(value);
	}

	// ── Local state ────────────────────────────────────────────────────────────

	let searchInput = $state(data.filters.q);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	// Transaction currently open in the transfer-pairing dialog.
	let dialogTxId = $state<string | null>(null);

	// Transaction currently open in the detail sheet (edit note / transfer flag).
	let detailTx = $state<(typeof data.rows)[number] | null>(null);
	let detailOpen = $state(false);

	function openDetail(tx: (typeof data.rows)[number]) {
		detailTx = tx;
		detailOpen = true;
	}

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
	const uploadOutcomeLabel: Record<string, string> = {
		inserted: 'imported by this upload',
		updated: 'updated by this upload',
		duplicate: 'already present (duplicates) in this upload'
	};
	const activeUploadOutcome = $derived(
		data.filters.uploadId && data.filters.uploadOutcome
			? uploadOutcomeLabel[data.filters.uploadOutcome]
			: null
	);
	const hasFilters = $derived(
		!!(
			data.filters.q ||
			data.filters.accountId ||
			data.filters.filter !== 'all' ||
			data.filters.uploadId
		)
	);

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));
	const currentPage = $derived(data.page);
	const showingFrom = $derived((currentPage - 1) * data.limit + 1);
	const showingTo = $derived(Math.min(currentPage * data.limit, data.total));

	const totalBalance = $derived(
		data.rows.reduce((sum, a) => (a.amountEur ? sum + a.amountEur : sum + 0), 0)
	);

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

<div class="flex h-[calc(100dvh-3rem)] flex-col overflow-hidden">
	<!-- ── Page header ────────────────────────────────────────────────────────── -->
	<div class="relative z-20 shrink-0 border-b border-border bg-surface px-4 pt-4 pb-3 md:px-8">
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

		<!-- Main KPIs -->
		<div class="flex items-start gap-4 pt-4">
			<Amount value={totalBalance} currency={PRIMARY_CURRENCY} size="lg" />
		</div>
	</div>

	<!-- ── Filter bar ─────────────────────────────────────────────────────────── -->
	<div
		class="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-3 md:px-8"
	>
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

	<!-- ── Upload-scoped notice ──────────────────────────────────────────────────── -->
	{#if activeUploadOutcome}
		<div
			class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-primary-100 bg-primary-50 px-4 py-2 text-xs text-primary-700 md:px-8"
		>
			<span>Showing only transactions {activeUploadOutcome}.</span>
			<Button
				variant="ghost"
				size="sm"
				onclick={clearFilters}
				class="h-6 gap-1 text-primary-600 hover:bg-primary-100 hover:text-primary-700"
			>
				<X size={12} />
				Show all
			</Button>
		</div>
	{/if}

	<!-- ── Transactions table ──────────────────────────────────────────────────── -->
	<div class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
		{#if data.rows.length === 0}
			<div class="flex h-full items-center justify-center">
				{#if hasFilters}
					<EmptyState
						icon={Search}
						title="No transactions match your filters"
						description="Try adjusting your filters."
					>
						<Button variant="link" onclick={clearFilters} class="text-primary-500">
							Clear all filters
						</Button>
					</EmptyState>
				{:else}
					<EmptyState
						icon={ReceiptText}
						title="No transactions yet"
						description="Upload a CSV from your bank account to get started."
					/>
				{/if}
			</div>
		{:else}
			<div class="px-2 md:px-0">
				<table class="w-full table-fixed border-collapse text-xs md:text-sm">
					<thead class="sticky top-0 z-10 bg-surface-sunken shadow-[0_1px_0_0_var(--border)]">
						<tr>
							<th
								class="w-28 px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase md:w-36 md:px-4"
							>
								Category
							</th>
							<th
								class="hidden w-36 px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase lg:table-cell lg:px-4"
							>
								Date
							</th>
							<th
								class="px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase md:px-4"
							>
								Description
							</th>
							<th
								class="hidden px-2 py-2.5 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase lg:table-cell lg:w-36 lg:px-4"
							>
								Account
							</th>
							<th
								class="w-28 px-2 py-2.5 text-right text-[10px] font-semibold tracking-wider text-text-tertiary uppercase md:w-40 md:px-4"
							>
								Amount
							</th>
						</tr>
					</thead>
					<tbody>
						{#each data.rows as tx (tx.id)}
							{@const isReview = tx.status === 'review'}
							{@const isReverted = tx.status === 'reverted'}
							{@const isPending = tx.status === 'pending'}
							{@const isTransfer = tx.isTransfer}
							{@const showTransferBadge = tx.isTransfer || tx.isFxCandidate}
							{@const transferSettled = !!(
								tx.transferCounterpartId ||
								(tx.isFxCandidate && tx.conversionId)
							)}
							{@const isOpening = tx.isOpeningBalance}

							{#if isOpening}
								<!-- Opening balance row — read-only, visually distinct -->
								<tr class="border-b border-border bg-surface-sunken/40 opacity-70">
									<!-- Category col: opening balance label -->
									<td class="px-2 py-2 md:px-4 md:py-3">
										<Badge
											variant="outline"
											class="max-w-full min-w-0 shrink truncate text-[11px] font-medium text-text-tertiary"
										>
											Opening balance
										</Badge>
									</td>
									<!-- Date col (large screens only) -->
									<td
										class="hidden px-2 py-3 text-xs whitespace-nowrap text-text-tertiary tabular-nums lg:table-cell lg:px-4"
									>
										{format(tx.accountingDate, 'd MMM yyyy')}
									</td>
									<!-- Description col -->
									<td class="px-2 py-2 md:px-4 md:py-3">
										<div class="flex min-w-0 items-center gap-2">
											<span class="truncate text-xs text-text-tertiary italic"
												>{tx.description}</span
											>
											{#if tx.notes}
												<NoteHint note={tx.notes} />
											{/if}
										</div>
										<!-- Compact meta: date + account, shown until the columns appear at lg -->
										<span class="mt-0.5 block text-[10px] text-text-tertiary lg:hidden">
											{format(tx.accountingDate, 'd MMM yyyy')}
											{#if tx.accountName}
												· {tx.accountName}{/if}
										</span>
									</td>
									<!-- Account col (large screens only) -->
									<td class="hidden px-2 py-3 lg:table-cell lg:px-4">
										{#if tx.accountName}
											<span
												class="inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
											>
												{tx.accountName}
											</span>
										{/if}
									</td>
									<!-- Amount col -->
									<td class="px-2 py-2 text-right md:px-4 md:py-3">
										<Amount value={tx.amount} currency={tx.currency} size="xs" class="md:text-sm" />
									</td>
								</tr>
							{:else}
								<tr
									class={cn(
										'group border-b border-border transition-colors hover:bg-surface-sunken/60',
										isReview && 'border-l-2 border-l-amber-400',
										isReverted && 'opacity-60'
									)}
								>
									<!-- Category col: category is always editable. Orthogonal facets show
									     compactly beside it — a "Review Required" chip (needs attention),
									     and a subtle "T" badge marking a transfer (see TransferHint). -->
									<td class="px-2 py-2 md:px-4 md:py-3">
										<div class="flex min-w-0 flex-col items-start gap-1">
											{#if isReview}
												<Badge
													class="max-w-full min-w-0 shrink truncate border-amber-200 bg-amber-100 text-[11px] font-medium text-amber-700"
												>
													Review Required
												</Badge>
											{/if}
											<div class="flex min-w-0 items-center gap-1.5">
												<CategorySelector
													txId={tx.id}
													category={tx.category}
													categoryAI={tx.categoryAI}
													categoryOverride={tx.categoryOverride}
													categories={data.categories}
												/>
												{#if showTransferBadge}
													<TransferHint
														status={transferSettled ? 'settled' : 'candidate'}
														onclick={() => (dialogTxId = tx.id)}
													/>
												{/if}
											</div>
										</div>
									</td>

									<!-- Date col (large screens only) -->
									<td
										class="hidden px-2 py-3 text-xs whitespace-nowrap text-text-tertiary tabular-nums lg:table-cell lg:px-4"
									>
										{format(tx.accountingDate, 'd MMM yyyy')}
									</td>

									<!-- Description col. The cost-group tag sits at the right end (its own
									     inline editor) so it reads as a facet of the row without crowding
									     the description text; date/account meta stack underneath until lg. -->
									<td class="px-2 py-2 text-text-primary md:px-4 md:py-3">
										<div class="flex items-center justify-between gap-2">
											<div class="flex min-w-0 flex-1 items-center gap-2">
												{#if isTransfer}
													<ArrowLeftRight size={13} class="shrink-0 text-text-tertiary" />
												{:else if isReview}
													<AlertTriangle size={13} class="shrink-0 text-amber-500" />
												{/if}
												<button
													type="button"
													onclick={() => openDetail(tx)}
													class="min-w-0 truncate text-left text-xs font-medium hover:underline md:text-sm"
													title="View details"
												>
													{tx.description}
												</button>
												{#if isPending}
													<Badge
														variant="outline"
														class="shrink-0 border-amber-200 bg-amber-50 text-[10px] font-medium text-amber-700"
													>
														Pending
													</Badge>
												{:else if isReverted}
													<Badge
														variant="outline"
														class="shrink-0 text-[10px] font-medium text-text-tertiary"
													>
														Returned
													</Badge>
												{/if}
												{#if tx.notes}
													<NoteHint note={tx.notes} />
												{/if}
											</div>
											<CostGroupTag
												txId={tx.id}
												costGroup={tx.costGroup}
												costGroups={data.costGroups}
											/>
										</div>
										<!-- Compact meta: date + account, shown until the columns appear at lg -->
										<span class="mt-0.5 block text-[10px] text-text-tertiary lg:hidden">
											{format(tx.accountingDate, 'd MMM yyyy')}
											{#if tx.accountName}
												· {tx.accountName}{/if}
										</span>
									</td>

									<!-- Account col (large screens only) -->
									<td class="hidden px-2 py-3 lg:table-cell lg:px-4">
										{#if tx.accountName}
											<span
												class="inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-secondary uppercase"
											>
												{tx.accountName}
											</span>
										{/if}
									</td>

									<!-- Amount col -->
									<td class="px-2 py-2 text-right md:px-4 md:py-3">
										<Amount
											value={tx.amount}
											currency={tx.currency}
											size="xs"
											struck={isReverted}
											class="md:text-sm"
										/>
										{#if tx.fee > 0}
											<div
												class="mt-0.5 truncate text-[10px] whitespace-nowrap text-text-tertiary md:text-xs"
											>
												incl. {formatFee(tx.fee)} fee
											</div>
										{/if}
										{#if tx.currency !== PRIMARY_CURRENCY}
											{#if tx.amountEur != null}
												<div class="mt-0.5 text-text-tertiary">
													<Amount
														value={tx.amountEur}
														currency={PRIMARY_CURRENCY}
														size="xs"
														class="text-[10px] md:text-xs"
														colorize={false}
													/>
												</div>
											{:else}
												<div
													class="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-amber-500"
												>
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
			</div>
		{/if}
	</div>

	<!-- ── Footer / Pagination ────────────────────────────────────────────────── -->
	{#if data.total > 0}
		<div
			class="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-border bg-surface px-4 py-3 md:px-8"
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

<TransferPairDialog
	txId={dialogTxId}
	onclose={() => (dialogTxId = null)}
	onchange={() => invalidateAll()}
/>

<TransactionDetailSheet bind:open={detailOpen} tx={detailTx} costGroups={data.costGroups} />
