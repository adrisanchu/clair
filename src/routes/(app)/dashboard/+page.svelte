<script lang="ts">
	import Amount from '$lib/components/Amount.svelte';
	import BankLogo from '$lib/components/BankLogo.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import { TrendingUp, Plus, Clock, MoreHorizontal } from '@lucide/svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Static placeholder data — will be replaced with DB queries in a later task
	const accounts = [
		{
			id: '1',
			displayName: 'BBVA Main',
			bankProfileId: 'bbva_es',
			ibanLast4: '1234',
			currentBalance: 4832.5,
			shared: false,
			lastSync: '12m ago'
		},
		{
			id: '2',
			displayName: 'CaixaBank Savings',
			bankProfileId: 'caixabank_es',
			ibanLast4: '5678',
			currentBalance: 1204.0,
			shared: false,
			lastSync: '2h ago'
		},
		{
			id: '3',
			displayName: 'Bankinter Invest',
			bankProfileId: 'bankinter_es',
			ibanLast4: '9012',
			currentBalance: 12500.0,
			shared: true,
			lastSync: '4h ago'
		},
		{
			id: '4',
			displayName: 'Revolut',
			bankProfileId: 'revolut_eu',
			ibanLast4: '3456',
			currentBalance: 340.2,
			shared: false,
			lastSync: '5m ago'
		},
		{
			id: '5',
			displayName: 'MyInvestor Cash',
			bankProfileId: 'myinvestor_es',
			ibanLast4: '7890',
			currentBalance: 8920.0,
			shared: false,
			lastSync: '1d ago'
		}
	];

	const totalBalance = $derived(accounts.reduce((sum, a) => sum + a.currentBalance, 0));

	// Formatted inline for hero display (special sizing outside Amount component)
	const formattedTotal = $derived(
		new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency: 'EUR',
			minimumFractionDigits: 2
		}).format(totalBalance)
	);

	const firstName = $derived(data.user.name.split(' ')[0]);
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
			<span class="font-mono tabular-nums text-5xl md:text-6xl font-bold text-text-primary leading-none">
				{formattedTotal}
			</span>
			<div class="flex items-center gap-1 text-success-600 text-sm font-semibold mb-1">
				<TrendingUp size={15} />
				+2.4%
			</div>
		</div>
	</div>

	<!-- Section heading -->
	<div class="flex items-center justify-between mb-4">
		<h2 class="text-base font-semibold text-text-primary">Accounts</h2>
		<a
			href="/accounts"
			class="text-sm text-primary-600 font-medium hover:text-primary-700 transition-colors"
		>
			View all →
		</a>
	</div>

	<!-- Account cards grid -->
	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
		{#each accounts as account (account.id)}
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
										{#if account.shared}
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
								<span class="h-2 w-2 rounded-full bg-success-500 shrink-0"></span>
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

						<!-- Last sync -->
						<div class="flex items-center gap-1 mt-3 text-xs text-text-tertiary">
							<Clock size={11} />
							<span>last sync: {account.lastSync}</span>
						</div>
					</Card.Content>
				</Card.Root>
			</a>
		{/each}

		<!-- Add Account placeholder -->
		<a
			href="/accounts/new"
			class="rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-text-tertiary hover:text-text-secondary hover:border-border-strong transition-colors min-h-[148px] p-4"
		>
			<div
				class="h-10 w-10 rounded-full border-2 border-dashed border-current flex items-center justify-center"
			>
				<Plus size={18} />
			</div>
			<span class="text-sm font-medium">Add Account</span>
		</a>
	</div>
</div>
