<script lang="ts">
	import { format } from 'date-fns';
	import { Search, ArrowLeft, ChevronRight } from '@lucide/svelte';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import Amount from '$lib/components/Amount.svelte';
	import type { PairableItem } from '$lib/server/db/queries';

	interface Props {
		txId: string;
		onpick: (item: PairableItem) => void;
		onback: () => void;
	}
	let { txId, onpick, onback }: Props = $props();

	let search = $state('');
	let items = $state<PairableItem[]>([]);
	let loading = $state(false);
	let err = $state<string | null>(null);

	// Debounced fetch: re-query the server whenever the search term settles.
	let debounce: ReturnType<typeof setTimeout>;
	$effect(() => {
		const q = search;
		clearTimeout(debounce);
		debounce = setTimeout(() => void run(q), 220);
		return () => clearTimeout(debounce);
	});

	async function run(q: string) {
		loading = true;
		err = null;
		try {
			const res = await fetch(
				`/api/transactions/${txId}/pairable?q=${encodeURIComponent(q.trim())}`
			);
			if (!res.ok) throw new Error('Could not load transactions');
			const data = await res.json();
			items = data.items ?? [];
		} catch (e) {
			err = e instanceof Error ? e.message : 'Something went wrong';
			items = [];
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-3 py-1">
	<div class="flex items-center gap-2">
		<Button variant="ghost" size="sm" onclick={onback} class="-ml-2 h-8 px-2 text-text-secondary">
			<ArrowLeft size={15} />
			Back
		</Button>
	</div>

	<div class="relative">
		<Search
			size={15}
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-tertiary"
		/>
		<Input
			placeholder="Search by description or notes…"
			bind:value={search}
			class="h-9 pl-9 text-sm"
		/>
	</div>

	<div class="max-h-88 space-y-1.5 overflow-y-auto pr-0.5">
		{#if loading && items.length === 0}
			<p class="py-8 text-center text-sm text-text-tertiary">Loading…</p>
		{:else if err}
			<p class="py-8 text-center text-sm text-danger-600">{err}</p>
		{:else if items.length === 0}
			<p class="py-8 text-center text-sm text-text-tertiary">
				{search.trim()
					? 'No transactions match your search.'
					: 'No transactions in your other accounts to pair with.'}
			</p>
		{:else}
			{#each items as c (c.id)}
				<button
					type="button"
					onclick={() => onpick(c)}
					class="group flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-raised"
				>
					<div class="min-w-0">
						<div class="flex flex-col items-start gap-1">
							{#if c.accountName}
								<span
									class="inline-flex max-w-full items-center truncate rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-secondary uppercase"
								>
									{c.accountName}
								</span>
							{/if}
							<span class="text-[11px] text-text-tertiary tabular-nums">
								{format(c.accountingDate, 'd MMM yyyy')}
							</span>
						</div>
						<p class="mt-1.5 truncate text-sm font-medium text-text-primary">{c.description}</p>
						{#if c.notes}
							<p class="mt-0.5 truncate text-[11px] text-text-tertiary">{c.notes}</p>
						{/if}
					</div>
					<div class="flex shrink-0 items-center gap-2">
						<div class="text-right">
							<Amount value={c.amount} currency={c.currency} size="sm" showSign />
							{#if c.crossCurrency && c.impliedRate != null}
								<p class="font-mono text-[10px] text-text-tertiary tabular-nums">
									&times;{c.impliedRate.toFixed(4)}
								</p>
							{/if}
						</div>
						<ChevronRight
							size={16}
							class="shrink-0 text-text-tertiary transition-colors group-hover:text-text-secondary"
						/>
					</div>
				</button>
			{/each}
		{/if}
	</div>
</div>
