<script lang="ts">
	import { format } from 'date-fns';
	import { AlertCircle, CheckCircle2 } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	interface Props {
		accountId: string;
		accountName: string;
		currency: string;
		unresolvedCount: number;
		earliestDate: Date;
		latestDate: Date;
		onclose: () => void;
		onsuccess: () => void;
	}

	let {
		accountId,
		accountName,
		currency,
		unresolvedCount,
		earliestDate,
		latestDate,
		onclose,
		onsuccess
	}: Props = $props();

	let open = $state(true);
	let rateInput = $state('');
	let loading = $state(false);
	let err = $state<string | null>(null);
	let done = $state(false);
	let affectedCount = $state(0);

	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) onclose();
	}

	async function handleSubmit() {
		const rate = parseFloat(rateInput.replace(',', '.'));
		if (isNaN(rate) || rate <= 0) {
			err = 'Please enter a valid positive exchange rate.';
			return;
		}

		loading = true;
		err = null;

		try {
			const res = await fetch(`/api/accounts/${accountId}/resolve-fx`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					exchangeRate: rate,
					effectiveFrom: earliestDate instanceof Date ? earliestDate.toISOString() : earliestDate
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Failed to apply rate');
			affectedCount = data.affectedCount;
			done = true;
		} catch (e) {
			err = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			loading = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Set conversion rate — {accountName}</Dialog.Title>
		</Dialog.Header>

		{#if done}
			<div class="flex flex-col items-center gap-4 py-6 text-center">
				<div class="bg-success-100 flex h-12 w-12 items-center justify-center rounded-full">
					<CheckCircle2 size={24} class="text-success-600" />
				</div>
				<div>
					<p class="text-sm font-semibold text-text-primary">Rate applied</p>
					<p class="mt-0.5 text-sm text-text-secondary">
						{affectedCount}
						{affectedCount === 1 ? 'transaction' : 'transactions'} updated.
					</p>
				</div>
			</div>

			<Dialog.Footer>
				<div></div>
				<Button onclick={onsuccess}>Done</Button>
			</Dialog.Footer>
		{:else}
			<div class="space-y-4 py-2">
				<p class="text-sm text-text-secondary">
					We couldn't find a matching EUR → {currency} transfer. Enter the exchange rate to apply to these
					transactions:
				</p>

				<div class="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-sunken p-3">
					<div>
						<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							Earliest unresolved
						</p>
						<p class="mt-1 text-sm font-medium text-text-primary">
							{format(earliestDate, 'd MMM yyyy')}
						</p>
					</div>
					<div>
						<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							Latest unresolved
						</p>
						<p class="mt-1 text-sm font-medium text-text-primary">
							{format(latestDate, 'd MMM yyyy')}
						</p>
					</div>
					<div class="col-span-2">
						<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							Transactions
						</p>
						<p class="mt-1 text-sm font-medium text-text-primary">{unresolvedCount}</p>
					</div>
				</div>

				<div>
					<label class="mb-1.5 block text-xs font-medium text-text-primary">
						Rate ({currency} / EUR)
					</label>
					<div class="flex items-center gap-2">
						<Input
							type="text"
							inputmode="decimal"
							placeholder="e.g. 10.91"
							bind:value={rateInput}
							class="font-mono"
						/>
						<span class="shrink-0 text-sm text-text-tertiary">{currency} / EUR</span>
					</div>
					<p class="mt-1 text-xs text-text-tertiary">
						How many {currency} equal 1 EUR? (e.g. if 1 EUR = {currency === 'SEK' ? '10.91' : '1.0'}
						{currency}, enter that value)
					</p>
				</div>
			</div>

			{#if err}
				<div
					class="border-danger-200 flex items-center gap-2 rounded-lg border bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
				>
					<AlertCircle size={14} class="shrink-0" />
					{err}
				</div>
			{/if}

			<Dialog.Footer>
				<Button variant="outline" onclick={onclose}>Cancel</Button>
				<Button onclick={handleSubmit} disabled={loading || !rateInput.trim()}>
					{loading ? 'Applying…' : 'Apply to all'}
				</Button>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
