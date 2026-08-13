<script lang="ts">
	import { format } from 'date-fns';
	import { AlertTriangle, ArrowRight } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import type { OrphanTransfer } from '$lib/server/db/queries';

	interface Props {
		orphans: OrphanTransfer[];
		/** Open the pairing dialog for a transaction. */
		onreconcile: (txId: string) => void;
		/** How many rows to show before linking to the full list. */
		limit?: number;
	}
	let { orphans, onreconcile, limit = 4 }: Props = $props();

	const shown = $derived(orphans.slice(0, limit));
</script>

{#if orphans.length > 0}
	<section
		class="mb-8 overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50"
		aria-label="Needs your attention"
	>
		<header class="flex items-center gap-2 border-b border-amber-200/70 px-4 py-3">
			<AlertTriangle size={15} class="text-amber-500" />
			<h2 class="text-sm font-semibold text-amber-900">Needs your attention</h2>
			<span
				class="flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white"
			>
				{orphans.length}
			</span>
		</header>

		<ul class="divide-y divide-amber-200/60">
			{#each shown as orphan (orphan.tx.id)}
				<li class="flex items-center justify-between gap-3 px-4 py-2.5">
					<div class="min-w-0">
						<p class="truncate text-sm font-medium text-text-primary">
							{orphan.kind === 'conversion' ? 'Unmatched conversion' : 'Unmatched transfer'}
							<span class="font-normal text-text-tertiary">· {orphan.tx.accountName}</span>
						</p>
						<p class="truncate text-[11px] text-text-tertiary">
							{orphan.tx.description} · {format(orphan.tx.accountingDate, 'd MMM yyyy')}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-3">
						<Amount value={orphan.tx.amount} currency={orphan.tx.currency} size="sm" showSign />
						<button
							onclick={() => onreconcile(orphan.tx.id)}
							class="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50"
						>
							Reconcile
						</button>
					</div>
				</li>
			{/each}
		</ul>

		<footer class="border-t border-amber-200/70 px-4 py-2">
			<a
				href="/transfers?filter=attention"
				class="inline-flex items-center gap-1 text-xs font-medium text-amber-800 hover:text-amber-900"
			>
				View all in Transfers
				<ArrowRight size={12} />
			</a>
		</footer>
	</section>
{/if}
