<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { format } from 'date-fns';
	import { Link2, Repeat, Trash2 } from '@lucide/svelte';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import Amount from '$lib/components/Amount.svelte';
	import CostGroupSelector from '$lib/components/CostGroupSelector.svelte';
	import type { TxRow } from '$lib/server/db/queries';
	import type { CostGroupRow } from '$lib/types';

	interface Props {
		/** The transaction to view/edit. When set, the sheet opens. */
		tx?: TxRow | null;
		open?: boolean;
		/** Workspace cost groups, for the assignment selector. */
		costGroups?: CostGroupRow[];
		/** Called after a successful save (in addition to invalidateAll). */
		onsaved?: () => void;
		/** Open the reconcile dialog for this transaction (manual transfer/conversion link). */
		onlink?: (txId: string) => void;
	}

	let { tx = null, open = $bindable(false), costGroups = [], onsaved, onlink }: Props = $props();

	let notes = $state('');
	let isTransfer = $state(false);
	let costGroup = $state<string | null>(null);
	let submitting = $state(false);
	let fieldError = $state<string | null>(null);
	let confirmUnlinkOpen = $state(false);
	let confirmDeleteOpen = $state(false);
	let deleting = $state(false);

	// Cash-account rows are manually managed — description, amount and date are editable
	// (and the row is deletable). Bank rows keep these immutable (dedup anchor, see #42).
	const isCash = $derived(tx?.accountType === 'cash');

	let description = $state('');
	let amountInput = $state('');
	let dateInput = $state('');

	// Seed the editable fields whenever a transaction is opened.
	$effect(() => {
		if (open && tx) {
			notes = tx.notes ?? '';
			isTransfer = tx.isTransfer;
			costGroup = tx.costGroup ?? null;
			description = tx.description;
			amountInput = String(tx.amount);
			dateInput = format(tx.accountingDate, 'yyyy-MM-dd');
			fieldError = null;
		}
	});

	const effectiveCategory = $derived(
		tx ? (tx.categoryOverride ?? tx.category ?? tx.categoryAI ?? '—') : '—'
	);

	// Parsed amount for cash edits — NaN when the field is left blank/invalid.
	const parsedAmount = $derived(Number(amountInput.replace(',', '.')));
	const cashFieldsValid = $derived(
		!isCash || (description.trim().length > 0 && Number.isFinite(parsedAmount) && dateInput !== '')
	);
	const cashDirty = $derived(
		!!tx &&
			isCash &&
			(description.trim() !== tx.description ||
				(Number.isFinite(parsedAmount) && parsedAmount !== tx.amount) ||
				dateInput !== format(tx.accountingDate, 'yyyy-MM-dd'))
	);

	// A transfer that is flagged but has no counterpart — un-checking is the fix.
	const isOrphanTransfer = $derived(!!tx && tx.isTransfer && tx.transferCounterpartId === null);

	const dirty = $derived(
		!!tx &&
			(notes.trim() !== (tx.notes ?? '') ||
				isTransfer !== tx.isTransfer ||
				costGroup !== (tx.costGroup ?? null) ||
				cashDirty)
	);

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
			const payload: Record<string, unknown> = { notes: notes.trim() || null, isTransfer, costGroup };
			// Cash rows can also edit the bank-authored fields.
			if (isCash) {
				payload.description = description.trim();
				payload.amount = parsedAmount;
				payload.accountingDate = dateInput;
			}
			const res = await fetch(`/api/transactions/${tx.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
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

	async function del() {
		if (!tx) return;
		fieldError = null;
		deleting = true;
		try {
			const res = await fetch(`/api/transactions/${tx.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Something went wrong' }));
				fieldError = data.message ?? 'Something went wrong';
				confirmDeleteOpen = false;
				return;
			}
			await invalidateAll();
			onsaved?.();
			confirmDeleteOpen = false;
			open = false;
		} finally {
			deleting = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Transaction details</Sheet.Title>
			<Sheet.Description>Edit the note, or link this as a transfer or conversion.</Sheet.Description>
		</Sheet.Header>

		{#if tx}
			<form onsubmit={handleSubmit} class="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-2">
				{#if isCash}
					<!-- Editable summary — cash accounts allow editing description, amount and date. -->
					<div class="grid gap-1.5">
						<Label for="tx-description">Description</Label>
						<textarea
							id="tx-description"
							bind:value={description}
							rows={2}
							placeholder="e.g. Coffee, groceries…"
							maxlength={200}
							disabled={submitting}
							class="w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
						></textarea>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-1.5">
							<Label for="tx-amount">Amount ({tx.currency})</Label>
							<input
								id="tx-amount"
								bind:value={amountInput}
								inputmode="decimal"
								placeholder="-12.50"
								disabled={submitting}
								class="w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 font-mono text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
							/>
							<p class="text-[10px] text-text-tertiary">Negative for spending, positive for income.</p>
						</div>
						<div class="grid gap-1.5">
							<Label for="tx-date">Date</Label>
							<input
								id="tx-date"
								type="date"
								bind:value={dateInput}
								disabled={submitting}
								class="w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
							/>
						</div>
					</div>
				{:else}
					<!-- Read-only summary -->
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0">
							<p class="truncate text-sm font-medium text-text-primary">{tx.description}</p>
							<p class="mt-0.5 text-xs text-text-tertiary">
								{format(tx.accountingDate, 'd MMM yyyy')}
								{#if tx.accountName}· {tx.accountName}{/if}
							</p>
						</div>
						<Amount
							value={tx.amount}
							currency={tx.currency}
							size="sm"
							struck={tx.status === 'reverted'}
						/>
					</div>
				{/if}

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

				<!-- Cost group — a cross-cutting bucket (e.g. a trip) spanning categories.
				     Edited here (not in the crowded table); saved with the Save button
				     alongside notes / transfer flag. -->
				<div class="grid gap-1.5">
					<Label for="tx-cost-group">Cost group</Label>
					<CostGroupSelector bind:value={costGroup} {costGroups} disabled={submitting} />
					<p class="text-xs text-text-tertiary">
						Group this transaction with others across categories — a trip, a project, a shared cost.
					</p>
				</div>

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

				{#if tx.isConversionLeg}
					<!-- Currency conversion — a cross-currency exchange, established by linking two
					     legs (not a same-currency transfer). Surface the state; the dialog owns the
					     rate, the paired leg, and unlink. -->
					<div class="grid gap-1.5">
						<span
							class="inline-flex w-fit items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-600"
						>
							<Repeat size={12} />
							Currency conversion
						</span>
						<p class="text-xs text-text-tertiary">
							Linked with a transaction in another account (EUR ↔ foreign). Open it to see the
							rate and paired leg, or to unlink.
						</p>
						{#if onlink}
							<Button
								type="button"
								variant="outline"
								class="mt-1 w-full"
								disabled={submitting}
								onclick={() => {
									if (tx) onlink(tx.id);
									open = false;
								}}
							>
								<Repeat size={14} />
								View conversion
							</Button>
						{/if}
					</div>
				{:else}
					<!-- Transfer flag (same-currency movement between your own accounts) -->
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

					<!-- Manual link — the universal entry point to pair this transaction with one in
					     another account, as either a same-currency transfer or a cross-currency
					     conversion. Works regardless of whether the parser flagged it. -->
					{#if onlink}
						<div class="grid gap-1.5">
							<Button
								type="button"
								variant="outline"
								class="w-full"
								disabled={submitting}
								onclick={() => {
									if (tx) onlink(tx.id);
									open = false;
								}}
							>
								<Link2 size={14} />
								Link transfer or conversion…
							</Button>
							<p class="text-xs text-text-tertiary">
								Pair this with a transaction in another account — a transfer (same currency) or a
								currency conversion (EUR ↔ foreign).
							</p>
						</div>
					{/if}
				{/if}

				{#if fieldError}
					<p class="text-sm text-danger-600">{fieldError}</p>
				{/if}
			</form>

			<Sheet.Footer class="px-6 pt-2 pb-6 sm:justify-between">
				{#if isCash}
					<Button
						type="button"
						variant="ghost"
						class="text-danger-600 hover:bg-danger-50 hover:text-danger-700"
						disabled={submitting || deleting}
						onclick={() => (confirmDeleteOpen = true)}
					>
						<Trash2 size={14} />
						Delete
					</Button>
				{/if}
				<div class="flex gap-2">
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
						disabled={submitting || !dirty || !cashFieldsValid}
					>
						{submitting ? 'Saving…' : 'Save changes'}
					</Button>
				</div>
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

<AlertDialog.Root bind:open={confirmDeleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this transaction?</AlertDialog.Title>
			<AlertDialog.Description>
				This permanently removes the transaction and updates the account balance. If it's linked as a
				transfer, the counterpart will be unlinked (not deleted). This can't be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => del()}
				disabled={deleting}
				class="bg-danger-600 text-white hover:bg-danger-700"
			>
				{deleting ? 'Deleting…' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
