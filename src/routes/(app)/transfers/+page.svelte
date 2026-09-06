<script lang="ts">
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { format } from 'date-fns';
	import { Waypoints, AlertTriangle, Search, Link2 } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import TransferPairCard from '$lib/components/transfers/TransferPairCard.svelte';
	import TransferPairDialog from '$lib/components/transfers/TransferPairDialog.svelte';
	import ConversionAdvice from '$lib/components/transfers/ConversionAdvice.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import type { PageData } from './$types';
	import type { OrphanTransfer } from '$lib/server/db/queries';

	let { data }: { data: PageData } = $props();

	type Filter = 'attention' | 'settled' | 'unmatched' | 'all';
	const activeFilter = $derived((page.url.searchParams.get('filter') as Filter) ?? 'all');

	function setFilter(f: Filter) {
		const url = new URL(page.url);
		if (f === 'all') url.searchParams.delete('filter');
		else url.searchParams.set('filter', f);
		goto(url.toString(), { keepFocus: true });
	}

	// The transaction currently open in the reconcile dialog.
	let dialogTxId = $state<string | null>(null);
	async function handleChange() {
		await invalidateAll();
	}

	const needsAttention = $derived(data.orphans.filter((o) => o.candidateCount > 0));
	const unmatched = $derived(data.orphans.filter((o) => o.candidateCount === 0));

	const showAttention = $derived(activeFilter === 'attention' || activeFilter === 'all');
	const showSettled = $derived(activeFilter === 'settled' || activeFilter === 'all');
	const showUnmatched = $derived(activeFilter === 'unmatched' || activeFilter === 'all');

	const tabs = $derived([
		{ key: 'attention' as Filter, label: 'Needs attention', count: needsAttention.length },
		{ key: 'settled' as Filter, label: 'Settled', count: data.settled.length },
		{ key: 'unmatched' as Filter, label: 'Unmatched', count: unmatched.length },
		{ key: 'all' as Filter, label: 'All', count: data.settled.length + data.orphans.length }
	]);

	const isEmpty = $derived(data.orphans.length === 0 && data.settled.length === 0);
</script>

{#snippet orphanRow(orphan: OrphanTransfer, variant: 'attention' | 'unmatched')}
	<div
		class={cn(
			'orphan-card rounded-xl border p-4',
			variant === 'attention' ? 'border-amber-200 bg-amber-50/50' : 'border-border bg-surface'
		)}
	>
		<!-- Meta: account chip + date (top) -->
		<div class="orphan-meta flex flex-col items-start gap-1">
			<span
				class="inline-flex items-center rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-secondary uppercase"
			>
				{orphan.tx.accountName}
			</span>
			<span class="text-[11px] text-text-tertiary tabular-nums">
				{format(orphan.tx.accountingDate, 'd MMM yyyy')}
			</span>
		</div>

		<!-- Action: amount + link button (own line on mobile, right column on desktop) -->
		<div class="orphan-action flex items-center justify-between gap-3">
			<Amount value={orphan.tx.amount} currency={orphan.tx.currency} size="md" showSign />
			<button
				onclick={() => (dialogTxId = orphan.tx.id)}
				class={cn(
					'shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium',
					variant === 'attention'
						? 'border-amber-300 bg-white text-amber-800 hover:bg-amber-50'
						: 'border-border bg-surface text-text-secondary hover:bg-surface-sunken'
				)}
			>
				<span class="flex items-center gap-1.5">
					{#if variant === 'attention'}<Search size={12} /> Find match{:else}<Link2 size={12} /> Link
						manually{/if}
				</span>
			</button>
		</div>

		<!-- Description: full card width, at the bottom -->
		<div class="orphan-desc min-w-0">
			<p class="text-sm font-medium text-text-primary">{orphan.tx.description}</p>
			{#if variant === 'attention'}
				<p class="mt-0.5 text-[11px] text-amber-700">
					{orphan.candidateCount}
					possible {orphan.candidateCount === 1 ? 'match' : 'matches'} in another account
				</p>
			{:else if orphan.kind === 'conversion' && orphan.advice}
				<div class="mt-0.5">
					<ConversionAdvice advice={orphan.advice} />
				</div>
			{:else}
				<p class="mt-0.5 text-[11px] text-text-tertiary">No match in your accounts — likely external</p>
			{/if}
		</div>
	</div>
{/snippet}

<div class="flex h-[calc(100dvh-3rem)] flex-col overflow-hidden">
	<!-- ── Header ─────────────────────────────────────────────────────────────── -->
	<div class="shrink-0 border-b border-border bg-surface px-4 pt-4 pb-3 md:px-8">
		<div class="flex flex-wrap items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-semibold text-text-primary">Transfers</h1>
				<p class="mt-0.5 text-xs font-semibold tracking-widest text-text-tertiary uppercase">
					Related movements
				</p>
			</div>

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
						{#if tab.key === 'attention' && tab.count > 0}
							<span
								class={cn(
									'flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
									activeFilter === 'attention' ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
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

	<!-- ── Body ───────────────────────────────────────────────────────────────── -->
	<div class="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-8">
		{#if isEmpty}
			<div class="flex h-full items-center justify-center">
				<EmptyState
					icon={Waypoints}
					title="No transfers yet"
					description="When you move money between your accounts or convert currencies, the linked pairs show up here."
				/>
			</div>
		{:else}
			<div class="mx-auto max-w-3xl space-y-8">
				<!-- Needs attention -->
				{#if showAttention && needsAttention.length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<AlertTriangle size={15} class="text-amber-500" />
							<h2 class="text-sm font-semibold text-text-primary">Needs attention</h2>
							<span class="text-xs text-text-tertiary">({needsAttention.length})</span>
						</div>
						<div class="space-y-2">
							{#each needsAttention as orphan, i (orphan.tx.id)}
								<div class="reveal" style="animation-delay: {Math.min(i, 12) * 35}ms">
									{@render orphanRow(orphan, 'attention')}
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Settled -->
				{#if showSettled && data.settled.length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<h2 class="text-sm font-semibold text-text-primary">Settled</h2>
							<span class="text-xs text-text-tertiary">({data.settled.length})</span>
						</div>
						<div class="space-y-2">
							{#each data.settled as pair, i (pair.out.id + pair.in.id)}
								<div class="reveal" style="animation-delay: {Math.min(i, 12) * 35}ms">
									<TransferPairCard {pair} onclick={() => (dialogTxId = pair.out.id)} />
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Unmatched (external, no in-app counterpart) -->
				{#if showUnmatched && unmatched.length > 0}
					<section>
						<div class="mb-3 flex items-center gap-2">
							<h2 class="text-sm font-semibold text-text-primary">Unmatched</h2>
							<span class="text-xs text-text-tertiary">({unmatched.length})</span>
						</div>
						<p class="mb-3 text-xs text-text-tertiary">
							Transfers with no matching transaction in your other accounts — usually payments to or
							from someone else.
						</p>
						<div class="space-y-2">
							{#each unmatched as orphan, i (orphan.tx.id)}
								<div class="reveal" style="animation-delay: {Math.min(i, 12) * 35}ms">
									{@render orphanRow(orphan, 'unmatched')}
								</div>
							{/each}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	</div>
</div>

<TransferPairDialog txId={dialogTxId} onclose={() => (dialogTxId = null)} onchange={handleChange} />

<style>
	/*
	 * Orphan card: description spans the full card width at the bottom so long
	 * transaction names never get squeezed by the amount/button. On mobile it stacks
	 * (meta → action → description); on desktop the amount + button move to a right
	 * column, vertically centred against the account/date + description block.
	 */
	.orphan-card {
		display: grid;
		grid-template-columns: 1fr;
		grid-template-areas:
			'meta'
			'action'
			'desc';
		gap: 0.5rem 1rem;
	}
	.orphan-meta {
		grid-area: meta;
	}
	.orphan-action {
		grid-area: action;
	}
	.orphan-desc {
		grid-area: desc;
	}
	@media (min-width: 768px) {
		.orphan-card {
			grid-template-columns: 1fr auto;
			grid-template-areas:
				'meta action'
				'desc action';
		}
		.orphan-action {
			align-self: center;
		}
	}

	.reveal {
		animation: reveal 0.28s ease-out both;
	}
	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.reveal {
			animation: none;
		}
	}
</style>
