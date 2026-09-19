<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { format } from 'date-fns';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import CostGroupSelector from '$lib/components/CostGroupSelector.svelte';
	import type { CategoryRow, CostGroupRow } from '$lib/types';

	interface Props {
		/** The cash account the new transaction belongs to. */
		accountId: string;
		currency: string;
		categories?: CategoryRow[];
		costGroups?: CostGroupRow[];
		open?: boolean;
		/** Called after a successful create (in addition to invalidateAll). */
		onsaved?: () => void;
	}

	let {
		accountId,
		currency,
		categories = [],
		costGroups = [],
		open = $bindable(false),
		onsaved
	}: Props = $props();

	let description = $state('');
	let amountInput = $state('');
	let dateInput = $state(format(new Date(), 'yyyy-MM-dd'));
	let categoryOverride = $state<string>('');
	let notes = $state('');
	let costGroup = $state<string | null>(null);
	let submitting = $state(false);
	let fieldError = $state<string | null>(null);

	// Parent categories first, each followed by its children (indented in the label).
	const categoryOptions = $derived(
		categories
			.filter((c) => c.parentId === null)
			.flatMap((parent) => [
				{ name: parent.name, label: parent.name },
				...categories
					.filter((c) => c.parentId === parent.id)
					.map((child) => ({ name: child.name, label: `  ${child.name}` }))
			])
	);

	const parsedAmount = $derived(Number(amountInput.replace(',', '.')));
	const valid = $derived(
		description.trim().length > 0 && Number.isFinite(parsedAmount) && dateInput !== ''
	);

	function reset() {
		description = '';
		amountInput = '';
		dateInput = format(new Date(), 'yyyy-MM-dd');
		categoryOverride = '';
		notes = '';
		costGroup = null;
		fieldError = null;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!valid) return;
		fieldError = null;
		submitting = true;
		try {
			const res = await fetch('/api/transactions', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					bankAccountId: accountId,
					accountingDate: dateInput,
					amount: parsedAmount,
					description: description.trim(),
					categoryOverride: categoryOverride || null,
					notes: notes.trim() || null,
					costGroup
				})
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Something went wrong' }));
				fieldError = data.message ?? 'Something went wrong';
				return;
			}
			await invalidateAll();
			onsaved?.();
			open = false;
			reset();
		} finally {
			submitting = false;
		}
	}

	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) reset();
	}
</script>

<Sheet.Root bind:open onOpenChange={handleOpenChange}>
	<Sheet.Content side="right" class="flex w-full flex-col sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>Add transaction</Sheet.Title>
			<Sheet.Description>Record a cash expense or income by hand.</Sheet.Description>
		</Sheet.Header>

		<form onsubmit={handleSubmit} class="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-2">
			<!-- Description -->
			<div class="grid gap-1.5">
				<Label for="add-description">Description</Label>
				<Input
					id="add-description"
					bind:value={description}
					placeholder="e.g. Coffee, groceries…"
					maxlength={200}
					required
					disabled={submitting}
				/>
			</div>

			<!-- Amount + Date -->
			<div class="grid grid-cols-2 gap-4">
				<div class="grid gap-1.5">
					<Label for="add-amount">Amount ({currency})</Label>
					<Input
						id="add-amount"
						bind:value={amountInput}
						inputmode="decimal"
						placeholder="-12.50"
						required
						disabled={submitting}
						class="font-mono"
					/>
					<p class="text-[10px] text-text-tertiary">Negative for spending, positive for income.</p>
				</div>
				<div class="grid gap-1.5">
					<Label for="add-date">Date</Label>
					<input
						id="add-date"
						type="date"
						bind:value={dateInput}
						required
						disabled={submitting}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					/>
				</div>
			</div>

			<!-- Category -->
			{#if categoryOptions.length > 0}
				<div class="grid gap-1.5">
					<Label for="add-category">Category</Label>
					<select
						id="add-category"
						bind:value={categoryOverride}
						disabled={submitting}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						<option value="">No category</option>
						{#each categoryOptions as opt (opt.name)}
							<option value={opt.name}>{opt.label}</option>
						{/each}
					</select>
				</div>
			{/if}

			<!-- Cost group -->
			{#if costGroups.length > 0}
				<div class="grid gap-1.5">
					<Label>Cost group</Label>
					<CostGroupSelector bind:value={costGroup} {costGroups} disabled={submitting} />
				</div>
			{/if}

			<!-- Notes -->
			<div class="grid gap-1.5">
				<Label for="add-notes">Note</Label>
				<textarea
					id="add-notes"
					bind:value={notes}
					rows={2}
					placeholder="Optional note"
					maxlength={500}
					disabled={submitting}
					class="w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
				></textarea>
			</div>

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
				disabled={submitting || !valid}
			>
				{submitting ? 'Adding…' : 'Add transaction'}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
