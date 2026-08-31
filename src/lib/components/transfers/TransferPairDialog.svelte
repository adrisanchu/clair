<script lang="ts">
	import { format } from 'date-fns';
	import { Search, Link2, Unlink, CircleCheck, Info, ListPlus, ArrowLeft } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import Amount from '$lib/components/Amount.svelte';
	import TransferPairCard from './TransferPairCard.svelte';
	import TransferPairPicker from './TransferPairPicker.svelte';
	import type {
		TransferCandidatesResult,
		TransferCandidateItem,
		TransferPair,
		PairableItem
	} from '$lib/server/db/queries';

	interface Props {
		/** The transaction to reconcile. Dialog is open while this is non-null. */
		txId: string | null;
		onclose: () => void;
		/** Fired after a successful link/unlink so the caller can refresh. */
		onchange?: () => void;
	}
	let { txId, onclose, onchange }: Props = $props();

	let open = $state(false);
	let loading = $state(false);
	let data = $state<TransferCandidatesResult | null>(null);
	let err = $state<string | null>(null);
	let search = $state('');
	let busy = $state(false);

	// Manual-pairing wizard: 'main' (settled / auto-candidates) → 'pick' (browse all) →
	// 'confirm' (preview the chosen pair before writing it).
	let step = $state<'main' | 'pick' | 'confirm'>('main');
	let picked = $state<PairableItem | null>(null);

	// Preview pair synthesised from the source + the manually picked transaction,
	// oriented so `out` is the money-out leg — exactly how it will render once linked.
	const previewPair = $derived.by<TransferPair | null>(() => {
		if (!data?.source || !picked) return null;
		const s = data.source;
		const [out, inLeg] = s.amount <= 0 ? [s, picked] : [picked, s];
		return {
			kind: picked.crossCurrency ? 'conversion' : 'transfer',
			conversionId: null,
			exchangeRate: picked.impliedRate,
			confidence: 'manual',
			out,
			in: inLeg
		};
	});

	// Open + (re)load whenever the target transaction changes.
	let loadedFor = $state<string | null>(null);
	$effect(() => {
		if (txId && txId !== loadedFor) {
			open = true;
			loadedFor = txId;
			void load(txId);
		}
	});

	async function load(id: string) {
		loading = true;
		err = null;
		search = '';
		step = 'main';
		picked = null;
		data = null;
		try {
			const res = await fetch(`/api/transactions/${id}/transfer-candidates`);
			if (!res.ok) throw new Error('Could not load candidates');
			data = await res.json();
		} catch (e) {
			err = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			loading = false;
		}
	}

	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) {
			onclose();
			data = null;
			search = '';
			err = null;
			loadedFor = null;
			step = 'main';
			picked = null;
		}
	}

	const filtered = $derived(
		(data?.candidates ?? []).filter((c) => {
			const q = search.trim().toLowerCase();
			if (!q) return true;
			return (
				c.description.toLowerCase().includes(q) ||
				(c.accountName ?? '').toLowerCase().includes(q)
			);
		})
	);

	// Write the link. Cross-currency → a manual conversion; same currency → a transfer pair.
	async function doLink(counterpartId: string, crossCurrency: boolean) {
		const res = crossCurrency
			? await fetch('/api/conversions', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ transactionId: txId, counterpartId })
				})
			: await fetch(`/api/transactions/${txId}/link-transfer`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ counterpartId })
				});
		if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? 'Link failed');
	}

	// Quick-link an auto-detected candidate (main step).
	async function linkTo(c: TransferCandidateItem) {
		if (!txId) return;
		busy = true;
		err = null;
		try {
			await doLink(c.id, c.crossCurrency);
			onchange?.();
			await load(txId);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Link failed';
		} finally {
			busy = false;
		}
	}

	// Commit the manually picked pair from the confirm step.
	async function confirmPick() {
		if (!txId || !picked) return;
		busy = true;
		err = null;
		try {
			await doLink(picked.id, picked.crossCurrency);
			onchange?.();
			await load(txId); // resets to 'main', now showing the settled pair
		} catch (e) {
			err = e instanceof Error ? e.message : 'Link failed';
		} finally {
			busy = false;
		}
	}

	async function unlink() {
		if (!txId || !data?.settled) return;
		busy = true;
		err = null;
		try {
			const res =
				data.settled.kind === 'conversion' && data.settled.conversionId
					? await fetch(`/api/conversions/${data.settled.conversionId}`, { method: 'DELETE' })
					: await fetch(`/api/transactions/${txId}/link-transfer`, { method: 'DELETE' });
			if (!res.ok) throw new Error('Unlink failed');
			onchange?.();
			await load(txId);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Unlink failed';
		} finally {
			busy = false;
		}
	}

	async function confirmRate() {
		if (!data?.settled?.conversionId) return;
		busy = true;
		err = null;
		try {
			const res = await fetch(`/api/conversions/${data.settled.conversionId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'confirm' })
			});
			if (!res.ok) throw new Error('Confirm failed');
			onchange?.();
			if (txId) await load(txId);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Confirm failed';
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>
				{#if step === 'pick'}
					Pair with another transaction
				{:else if step === 'confirm'}
					Confirm the link
				{:else if data?.settled}
					Linked transfer
				{:else}
					Reconcile transfer
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if step === 'pick'}
					Pick a transaction from another account to link with this one.
				{:else if step === 'confirm'}
					Review how these two transactions will be linked, then confirm.
				{:else if data?.settled}
					These two transactions are linked as one movement.
				{:else}
					Find the matching transaction in another account to link them.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if loading}
			<div class="py-10 text-center text-sm text-text-tertiary">Loading…</div>
		{:else if step === 'pick' && txId}
			<!-- ── Pick: browse every unlinked transaction from another account ──── -->
			<TransferPairPicker
				{txId}
				onpick={(item) => {
					picked = item;
					err = null;
					step = 'confirm';
				}}
				onback={() => (step = 'main')}
			/>
		{:else if step === 'confirm' && previewPair}
			<!-- ── Confirm: preview the manual pair before writing it ─────────────── -->
			<div class="space-y-4 py-2">
				<TransferPairCard pair={previewPair} />

				{#if err}
					<p class="text-sm text-danger-600">{err}</p>
				{/if}

				<div class="flex items-center justify-between gap-2">
					<Button
						variant="ghost"
						onclick={() => {
							err = null;
							step = 'pick';
						}}
						disabled={busy}
					>
						<ArrowLeft size={14} />
						Pick another
					</Button>
					<Button onclick={confirmPick} disabled={busy}>
						<Link2 size={14} />
						Confirm link
					</Button>
				</div>
			</div>
		{:else if data?.settled}
			<!-- ── Settled: show the pair + unlink / confirm ─────────────────────── -->
			<div class="space-y-4 py-2">
				<TransferPairCard pair={data.settled} />

				{#if err}
					<p class="text-sm text-danger-600">{err}</p>
				{/if}

				<div class="flex items-center justify-between gap-2">
					<Button variant="ghost" onclick={unlink} disabled={busy} class="text-danger-600">
						<Unlink size={14} />
						Unlink
					</Button>
					{#if data.settled.kind === 'conversion' && data.settled.confidence === 'auto'}
						<Button variant="outline" onclick={confirmRate} disabled={busy}>
							<CircleCheck size={14} />
							Confirm rate
						</Button>
					{/if}
				</div>
			</div>
		{:else if data}
			<!-- ── Orphan: source + candidate search ─────────────────────────────── -->
			<div class="space-y-4 py-2">
				{#if data.source}
					<div class="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
						<p class="text-[10px] font-semibold tracking-wider text-amber-700 uppercase">
							Unmatched
						</p>
						<div class="mt-1 flex items-center justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate text-sm font-medium text-text-primary">{data.source.description}</p>
								<p class="text-[11px] text-text-tertiary">
									{data.source.accountName} · {format(data.source.accountingDate, 'd MMM yyyy')}
								</p>
							</div>
							<Amount value={data.source.amount} currency={data.source.currency} size="md" showSign />
						</div>
					</div>
				{/if}

				{#if data.candidates.length === 0}
					<div class="flex items-start gap-2 rounded-lg border border-border bg-surface-sunken p-3">
						<Info size={15} class="mt-0.5 shrink-0 text-text-tertiary" />
						<p class="text-sm text-text-secondary">
							No matching transaction in your other accounts — this looks like an external transfer.
						</p>
					</div>
				{:else}
					<div class="relative">
						<Search
							size={14}
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-tertiary"
						/>
						<Input placeholder="Search candidates…" bind:value={search} class="h-8 pl-8 text-sm" />
					</div>

					<div class="max-h-72 space-y-1.5 overflow-y-auto">
						{#each filtered as c (c.id)}
							<div
								class="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-2.5 hover:bg-surface-raised"
							>
								<div class="min-w-0">
									<p class="truncate text-sm font-medium text-text-primary">{c.description}</p>
									<p class="text-[11px] text-text-tertiary">
										{c.accountName} · {format(c.accountingDate, 'd MMM yyyy')}
										{#if c.daysDiff > 0}
											· <span class="text-amber-600">{c.daysDiff}d apart</span>
										{/if}
									</p>
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
									<Button size="sm" onclick={() => linkTo(c)} disabled={busy}>
										<Link2 size={13} />
										Link
									</Button>
								</div>
							</div>
						{/each}
						{#if filtered.length === 0}
							<p class="py-4 text-center text-xs text-text-tertiary">No candidates match your search.</p>
						{/if}
					</div>
				{/if}

				<!-- Manual escape hatch: pick ANY transaction from another account. -->
				<Button
					variant="outline"
					class="w-full"
					onclick={() => {
						err = null;
						step = 'pick';
					}}
					disabled={busy}
				>
					<ListPlus size={15} />
					Pair with another transaction
				</Button>

				{#if err}
					<p class="text-sm text-danger-600">{err}</p>
				{/if}
			</div>
		{:else if err}
			<div class="py-8 text-center text-sm text-danger-600">{err}</div>
		{/if}
	</Dialog.Content>
</Dialog.Root>
