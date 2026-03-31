<script lang="ts">
	import { formatDistanceToNow } from 'date-fns'
	import Amount from '$lib/components/Amount.svelte'
	import BankLogo from '$lib/components/BankLogo.svelte'
	import { Badge } from '$lib/components/ui/badge'
	import * as Card from '$lib/components/ui/card'
	import { Button } from '$lib/components/ui/button'
	import { TrendingUp, TrendingDown, Plus, Clock, MoreHorizontal, Landmark } from '@lucide/svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const totalBalance = $derived(data.accounts.reduce((sum, a) => sum + a.currentBalance, 0))

	const formattedTotal = $derived(
		new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2
		}).format(totalBalance)
	)

	const firstName = $derived(data.user.name.split(' ')[0])

	function formatLastUpdated(date: Date | string | null): string {
		if (!date) return 'No uploads yet'
		return formatDistanceToNow(new Date(date), { addSuffix: true })
	}

	function formatTrend(value: number): string {
		const sign = value >= 0 ? '+' : ''
		return `${sign}${value.toFixed(1)}%`
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8 max-w-6xl">
	<!-- Page header -->
	<div class="mb-8">
		<p class="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-1">
			Welcome back
		</p>
		<h1 class="text-2xl font-semibold text-text-primary">{firstName}</h1>
	</div>

	<!-- Total Net Liquidity hero -->
	<div class="mb-10">
		<p class="text-xs font-semibold tracking-widest text-text-tertiary uppercase mb-3">
			Total Net Liquidity
		</p>
		<div class="flex items-end gap-4 flex-wrap">
			<span
				class="font-mono tabular-nums text-5xl md:text-6xl font-bold text-text-primary leading-none"
			>
				{formattedTotal}
			</span>
			{#if data.trendPercent !== null}
				{#if data.trendPercent >= 0}
					<Badge class="mb-1 gap-1 border-0 bg-success-50 text-success-600 font-semibold">
						<TrendingUp size={12} />
						{formatTrend(data.trendPercent)}
					</Badge>
				{:else}
					<Badge class="mb-1 gap-1 border-0 bg-danger-50 text-danger-600 font-semibold">
						<TrendingDown size={12} />
						{formatTrend(data.trendPercent)}
					</Badge>
				{/if}
			{/if}
		</div>
	</div>

	<!-- Section heading -->
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-base font-semibold text-text-primary">Accounts</h2>
		{#if data.accounts.length > 0}
			<a
				href="/accounts"
				class="text-sm text-primary-600 font-medium hover:text-primary-700 transition-colors"
			>
				View all →
			</a>
		{/if}
	</div>

	{#if data.accounts.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-24 text-center px-4">
			<div
				class="w-14 h-14 rounded-full bg-surface-sunken flex items-center justify-center mb-4 text-text-tertiary"
			>
				<Landmark size={24} />
			</div>
			<p class="text-sm font-medium text-text-primary mb-1">No bank accounts yet</p>
			<p class="text-sm text-text-secondary mb-6">Add your first account to get started.</p>
			<Button size="sm" href="/accounts">
				<Plus size={15} />
				Add bank account
			</Button>
		</div>
	{:else}
		<!-- Account cards grid -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
			{#each data.accounts as account (account.id)}
				<a href="/accounts/{account.id}" class="block group">
					<Card.Root
						class="bg-surface border-border shadow-sm group-hover:shadow-md transition-shadow h-full"
					>
						<Card.Content class="p-4">
							<!-- Card header: logo + name + status -->
							<div class="flex items-start justify-between mb-4">
								<div class="flex items-center gap-2.5">
									<BankLogo name={account.displayName} bankProfileId={account.bankProfileId} />
									<div>
										<div class="flex items-center gap-1.5 flex-wrap">
											<p class="text-sm font-medium text-text-primary leading-tight">
												{account.displayName}
											</p>
											{#if !account.isOwner}
												<Badge
													class="text-[10px] px-1.5 py-0 h-4 bg-primary-100 text-primary-700 border-0 font-medium rounded-sm"
												>
													Shared
												</Badge>
											{/if}
										</div>
										<p class="text-xs text-text-tertiary mt-0.5">···{account.ibanLast4}</p>
									</div>
								</div>
								<div class="flex items-center gap-1.5 mt-0.5">
									<span
										class="h-2 w-2 rounded-full {account.status === 'active'
											? 'bg-success-500'
											: 'bg-border-strong'} shrink-0"
									></span>
									<button
										class="text-text-tertiary hover:text-text-secondary transition-colors rounded p-0.5"
										onclick={(e) => e.preventDefault()}
									>
										<MoreHorizontal size={15} />
									</button>
								</div>
							</div>

							<!-- Balance -->
							<Amount value={account.currentBalance} size="lg" showSign={false} />

							<!-- Last updated -->
							<div class="flex items-center gap-1 mt-3 text-xs text-text-tertiary">
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
				class="rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-text-tertiary hover:text-text-secondary hover:border-border-strong transition-colors min-h-37 p-4"
			>
				<div
					class="h-10 w-10 rounded-full border-2 border-dashed border-current flex items-center justify-center"
				>
					<Plus size={18} />
				</div>
				<span class="text-sm font-medium">Add Account</span>
			</a>
		</div>
	{/if}
</div>
