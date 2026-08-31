<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { format } from 'date-fns';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import Amount from '$lib/components/Amount.svelte';
	import type { TxRow } from '$lib/server/db/queries';

	interface Props {
		/** The transaction to view/edit. When set, the sheet opens. */
		tx?: TxRow | null;
		open?: boolean;
		/** Called after a successful save (in addition to invalidateAll). */
		onsaved?: () => void;
	}

	let { tx = null, open = $bindable(false), onsaved }: Props = $props();

	let notes = $state('');
	let isTransfer = $state(false);
	let submitting = $state(false);
	let fieldError = $state<string | null>(null);
	let confirmUnlinkOpen = $state(false);

	// Seed the editable fields whenever a transaction is opened.
	$effect(() => {
		if (open && tx) {
			notes = tx.notes ?? '';
			isTransfer = tx.isTransfer;
			fieldError = null;
		}
	});

	const effectiveCategory = $derived(
		tx ? (tx.categoryOverride ?? tx.category ?? tx.categoryAI ?? '—') : '—'
	);

	// A transfer that is flagged but has no counterpart — un-checking is the fix.
	const isOrphanTransfer = $derived(!!tx && tx.isTransfer && tx.transferCounterpartId === null);

	const dirty = $derived(!!tx && (notes.trim() !== (tx.notes ?? '') || isTransfer !== tx.isTransfer));

	// Turning off the transfer flag on a row that is linked to a counterpart breaks the
	// pair on both sides — a destructive change we confirm before applying (server also
	// unlinks both legs, see PATCH /api/transactions/[id]).
	const willUnlinkPair = $derived(
		!!tx && tx.isTransfer && !isTransfer && tx.transferCounterpartId !== null
	);

	function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!tx) return;
		if (willUnlinkPair) {
			confirmUnlinkOpen = true;
			return;
		}
		void persist();
	}

	async function persist() {
		if (!tx) return;
		fieldError = null;
		submitting = true;
		try {
			const res = await fetch(`/api/transactions/${tx.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ notes: notes.trim() || null, isTransfer })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Something went wrong' }));
				fieldError = data.message ?? 'Something went wrong';
				return;
			}
			await invalidateAll();
			onsaved?.();
			open = false;
		} finally {
			submitting = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Transaction details</Sheet.Title>
			<Sheet.Description>Edit the note or correct the transfer flag.</Sheet.Description>
		</Sheet.Header>

		{#if tx}
			<form onsubmit={handleSubmit} class="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-2">
				<!-- Read-only summary -->
				<div class="flex items-start justify-between gap-4">
					<div class="min-w-0">
						<p class="truncate text-sm font-medium text-text-primary">{tx.description}</p>
						<p class="mt-0.5 text-xs text-text-tertiary">
							{format(tx.accountingDate, 'd MMM yyyy')}
							{#if tx.accountName}· {tx.accountName}{/if}
						</p>
					</div>
					<Amount value={tx.amount} currency={tx.currency} size="sm" struck={tx.status === 'reverted'} />
				</div>

				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
					<dt class="text-text-tertiary">Category</dt>
					<dd class="text-right text-text-secondary">{effectiveCategory}</dd>
					<dt class="text-text-tertiary">Status</dt>
					<dd class="text-right text-text-secondary capitalize">{tx.status}</dd>
					{#if tx.fee > 0}
						<dt class="text-text-tertiary">Fee</dt>
						<dd class="text-right text-text-secondary">
							<Amount value={tx.fee} currency={tx.currency} size="xs" colorize={false} />
						</dd>
					{/if}
				</dl>

				<!-- Notes -->
				<div class="grid gap-1.5">
					<Label for="tx-notes">Note</Label>
					<textarea
						id="tx-notes"
						bind:value={notes}
						rows={3}
						placeholder="Add a note — e.g. split with Ana"
						maxlength={500}
						disabled={submitting}
						class="w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
					></textarea>
				</div>

				<!-- Transfer flag -->
				<label class="flex items-start gap-2.5 text-sm">
					<input
						type="checkbox"
						bind:checked={isTransfer}
						disabled={submitting}
						class="mt-0.5 size-4 shrink-0 rounded border-input accent-primary-500"
					/>
					<span class="min-w-0">
						<span class="font-medium text-text-primary">This is a transfer</span>
						<span class="mt-0.5 block text-xs text-text-tertiary">
							{#if tx.transferCounterpartId}
								Un-checking breaks the link with its paired transaction.
							{:else if isOrphanTransfer}
								Flagged as a transfer but not linked. Un-check if it isn't one.
							{:else}
								Movement between your own accounts, not an expense or income.
							{/if}
						</span>
					</span>
				</label>

				{#if fieldError}
					<p class="text-sm text-danger-600">{fieldError}</p>
				{/if}
			</form>

			<Sheet.Footer class="px-6 pt-2 pb-6">
				<Sheet.Close>
					{#snippet child({ props })}
						<Button variant="outline" {...props} disabled={submitting}>Cancel</Button>
					{/snippet}
				</Sheet.Close>
				<Button
					onclick={(e: MouseEvent) => {
						const form = (e.currentTarget as HTMLElement)
							.closest('[data-slot="sheet-content"]')
							?.querySelector('form');
						form?.requestSubmit();
					}}
					disabled={submitting || !dirty}
				>
					{submitting ? 'Saving…' : 'Save changes'}
				</Button>
			</Sheet.Footer>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root bind:open={confirmUnlinkOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Unlink this transfer?</AlertDialog.Title>
			<AlertDialog.Description>
				This transaction is linked to a paired transaction. Marking it as “not a transfer” will
				unlink both — the counterpart will no longer be paired either. You can re-link them later.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={submitting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => persist()} disabled={submitting}>
				{submitting ? 'Unlinking…' : 'Unlink'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
