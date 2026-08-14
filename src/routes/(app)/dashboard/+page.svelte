<script lang="ts">
	import { formatDistanceToNow } from 'date-fns';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';
	import { buildProjection } from '$lib/chart-utils.js';
	import Amount from '$lib/components/Amount.svelte';
	import BankLogo from '$lib/components/BankLogo.svelte';
	import BalanceChart from '$lib/components/BalanceChart.svelte';
	import GranularitySelector from '$lib/components/GranularitySelector.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { TrendingUp, TrendingDown, Plus, Clock, MoreHorizontal, Landmark, BarChart2 } from '@lucide/svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import AttentionList from '$lib/components/transfers/AttentionList.svelte';
	import TransferPairDialog from '$lib/components/transfers/TransferPairDialog.svelte';
	import type { PageData } from './$types';
	import type { Granularity } from '$lib/server/db/queries.js';

	let { data }: { data: PageData } = $props();

	const totalBalance = $derived(data.accounts.reduce((sum, a) => sum + a.currentBalance, 0));
	const totalTxCount = $derived(data.accounts.reduce((sum, a) => sum + a.txCount, 0));

	const formattedTotal = $derived(
		new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: PRIMARY_CURRENCY,
			minimumFractionDigits: 2
		}).format(totalBalance)
	);

	const firstName = $derived(data.user.name.split(' ')[0]);

	// Transaction open in the reconcile dialog (from the attention list).
	let dialogTxId = $state<string | null>(null);

	const projectedPoints = $derived(buildProjection(data.balanceData.points, data.granularity));

	function setGranularity(g: Granularity) {
		const url = new URL(page.url.href);
		url.searchParams.set('g', g);
		goto(url.toString(), { keepFocus: true, replaceState: true });
	}

	function formatLastUpdated(date: Date | string | null): string {
		if (!date) return 'No uploads yet';
		return formatDistanceToNow(new Date(date), { addSuffix: true });
	}

	function formatTrend(value: number): string {
		const sign = value >= 0 ? '+' : '';
		return `${sign}${value.toFixed(1)}%`;
	}
</script>

<div class="max-w-6xl px-4 py-6 md:px-8 md:py-8">
	<!-- Page header -->
	<div class="mb-8">
		<p class="mb-1 text-xs font-semibold tracking-widest text-text-tertiary uppercase">
			Welcome back
		</p>
		<h1 class="text-2xl font-semibold text-text-primary">{firstName}</h1>
	</div>

	<!-- Needs your attention: unmatched transfers/conversions to reconcile -->
	<AttentionList orphans={data.orphans} onreconcile={(id) => (dialogTxId = id)} />

	<!-- Total Net Liquidity hero -->
	<div class="mb-10">
		<p class="mb-3 text-xs font-semibold tracking-widest text-text-tertiary uppercase">
			Total Net Liquidity
		</p>
		<div class="flex flex-wrap items-end gap-4">
			<span
				class="font-mono text-5xl leading-none font-bold text-text-primary tabular-nums md:text-6xl"
			>
				{formattedTotal}
			</span>
			{#if data.trendPercent !== null}
				{#if data.trendPercent >= 0}
					<Badge class="mb-1 gap-1 border-0 bg-success-50 font-semibold text-success-600">
						<TrendingUp size={12} />
						{formatTrend(data.trendPercent)}
					</Badge>
				{:else}
					<Badge class="mb-1 gap-1 border-0 bg-danger-50 font-semibold text-danger-600">
						<TrendingDown size={12} />
						{formatTrend(data.trendPercent)}
					</Badge>
				{/if}
			{/if}
		</div>
		{#if data.accounts.length > 0 && totalTxCount === 0}
			<p class="mt-3 text-sm text-text-secondary">
				Upload a CSV to see your spending summary.
			</p>
		{/if}
	</div>

	<!-- Rolling balance chart -->
	<div class="mb-10">
		<Card.Root class="gap-2 border-border bg-surface px-2 py-4 shadow-sm">
			<Card.Header class="flex flex-row items-center gap-2 space-y-0 border-b">
				<div class="grid flex-1 gap-1 text-start">
					<Card.Title>Rolling Balance</Card.Title>
					<Card.Description>Showing the last 3 months</Card.Description>
				</div>
				{#if data.balanceData.points.length > 0}
					<GranularitySelector value={data.granularity} onchange={setGranularity} />
				{/if}
			</Card.Header>
			<Card.Content>
				{#if data.balanceData.points.length > 0}
					<BalanceChart
						points={data.balanceData.points}
						{projectedPoints}
						granularity={data.granularity}
					/>
				{:else}
					<EmptyState
						icon={BarChart2}
						title="No data yet"
						description="Upload your first bank statement to see your balance history."
						compact
					/>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<!-- Section heading -->
	<div class="mb-4 flex items-center justify-between">
		<h2 class="text-base font-semibold text-text-primary">Accounts</h2>
		{#if data.accounts.length > 0}
			<a
				href="/accounts"
				class="text-sm font-medium text-primary-600 transition-colors hover:text-primary-700"
			>
				View all →
			</a>
		{/if}
	</div>

	{#if data.accounts.length === 0}
		<!-- Empty state -->
		<EmptyState
			icon={Landmark}
			title="No bank accounts yet"
			description="Add your first account to get started."
		>
			<Button size="sm" href="/accounts">
				<Plus size={15} />
				Add bank account
			</Button>
		</EmptyState>
	{:else}
		<!-- Account cards grid -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
			{#each data.accounts as account (account.id)}
				<a href="/accounts/{account.id}" class="group block">
					<Card.Root
						class="h-full border-border bg-surface shadow-sm transition-shadow group-hover:shadow-md"
					>
						<Card.Content class="p-4">
							<!-- Card header: logo + name + status -->
							<div class="mb-4 flex items-start justify-between">
								<div class="flex items-center gap-2.5">
									<BankLogo name={account.displayName} bankProfileId={account.bankProfileId} />
									<div>
										<div class="flex flex-wrap items-center gap-1.5">
											<p class="text-sm leading-tight font-medium text-text-primary">
												{account.displayName}
											</p>
											{#if !account.isOwner}
												<Badge
													class="h-4 rounded-sm border-0 bg-primary-100 px-1.5 py-0 text-[10px] font-medium text-primary-700"
												>
													Shared
												</Badge>
											{/if}
										</div>
										<p class="mt-0.5 text-xs text-text-tertiary">···{account.ibanLast4}</p>
									</div>
								</div>
								<div class="mt-0.5 flex items-center gap-1.5">
									<span
										class="h-2 w-2 rounded-full {account.status === 'active'
											? 'bg-success-500'
											: 'bg-border-strong'} shrink-0"
									></span>
									<button
										class="rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
										onclick={(e) => e.preventDefault()}
									>
										<MoreHorizontal size={15} />
									</button>
								</div>
							</div>

							<!-- Balance -->
							<Amount value={account.currentBalance} size="lg" showSign={false} />

							<!-- Last updated -->
							<div class="mt-3 flex items-center gap-1 text-xs text-text-tertiary">
								<Clock size={11} />
								<span>last updated: {formatLastUpdated(account.lastUploadedAt)}</span>
							</div>
						</Card.Content>
					</Card.Root>
				</a>
			{/each}

			<!-- Add Account placeholder -->
			<a
				href="/accounts"
				class="flex min-h-37 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-4 text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
			>
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-current"
				>
					<Plus size={18} />
				</div>
				<span class="text-sm font-medium">Add Account</span>
			</a>
		</div>
	{/if}
</div>

<TransferPairDialog
	txId={dialogTxId}
	onclose={() => (dialogTxId = null)}
	onchange={() => invalidateAll()}
/>
