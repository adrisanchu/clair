<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { CURRENCIES, PRIMARY_CURRENCY } from '$lib/currencies.js';

	interface Profile {
		id: string;
		displayName: string;
	}

	interface Props {
		profiles: Profile[];
		open?: boolean;
		onclose?: () => void;
	}

	let { profiles, open = $bindable(false), onclose }: Props = $props();

	let accountType = $state<'bank' | 'cash'>('bank');
	let displayName = $state('');
	let bankProfileId = $state(profiles[0]?.id ?? '');
	let ibanLast4 = $state('');
	let currency = $state(PRIMARY_CURRENCY);
	let submitting = $state(false);
	let fieldError = $state<string | null>(null);

	const isCash = $derived(accountType === 'cash');

	function reset() {
		accountType = 'bank';
		displayName = '';
		bankProfileId = profiles[0]?.id ?? '';
		ibanLast4 = '';
		currency = PRIMARY_CURRENCY;
		fieldError = null;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		fieldError = null;

		// Bank accounts require a valid IBAN last-4; cash accounts have neither profile nor IBAN.
		if (!isCash && (!ibanLast4.trim() || !/^\d{4}$/.test(ibanLast4.trim()))) {
			fieldError = 'IBAN last 4 must be exactly 4 digits';
			return;
		}

		submitting = true;
		try {
			const body = isCash
				? { displayName, accountType: 'cash', currency }
				: { displayName, accountType: 'bank', bankProfileId, ibanLast4: ibanLast4.trim(), currency };
			const res = await fetch('/api/accounts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const { message } = await res.json().catch(() => ({ message: 'Something went wrong' }));
				fieldError = message;
				return;
			}

			await invalidateAll();
			open = false;
			reset();
			onclose?.();
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
			<Sheet.Title>{isCash ? 'Add cash account' : 'Add bank account'}</Sheet.Title>
			<Sheet.Description>
				{isCash
					? 'Track cash expenses by adding, editing and deleting transactions by hand.'
					: 'Connect a bank account to start uploading transactions.'}
			</Sheet.Description>
		</Sheet.Header>

		<form onsubmit={handleSubmit} class="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-2">
			<!-- Account type -->
			<div class="grid gap-1.5">
				<Label>Account type</Label>
				<div class="grid grid-cols-2 gap-2">
					<button
						type="button"
						onclick={() => (accountType = 'bank')}
						disabled={submitting}
						class="rounded-md border px-3 py-2 text-sm transition-colors {accountType === 'bank'
							? 'border-primary-500 bg-primary-50 text-primary-700'
							: 'border-input text-text-secondary hover:bg-surface-sunken'}"
					>
						Bank
					</button>
					<button
						type="button"
						onclick={() => (accountType = 'cash')}
						disabled={submitting}
						class="rounded-md border px-3 py-2 text-sm transition-colors {accountType === 'cash'
							? 'border-primary-500 bg-primary-50 text-primary-700'
							: 'border-input text-text-secondary hover:bg-surface-sunken'}"
					>
						Cash
					</button>
				</div>
				<p class="text-xs text-text-tertiary">
					{isCash
						? 'A manual account for cash spending — rows are fully editable.'
						: 'A CSV-backed account synced from your bank statements.'}
				</p>
			</div>

			<!-- Display name -->
			<div class="grid gap-1.5">
				<Label for="displayName">Account name</Label>
				<Input
					id="displayName"
					bind:value={displayName}
					placeholder={isCash ? 'e.g. Wallet, Cash' : 'e.g. Revolut, BBVA Main'}
					required
					disabled={submitting}
				/>
				<p class="text-xs text-text-tertiary">A friendly name shown in the app.</p>
			</div>

			<!-- Bank profile -->
			{#if !isCash}
				<div class="grid gap-1.5">
					<Label for="bankProfile">Bank</Label>
					<select
						id="bankProfile"
						bind:value={bankProfileId}
						disabled={submitting}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs
						       transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
						       disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#each profiles as p (p.id)}
							<option value={p.id}>{p.displayName}</option>
						{/each}
					</select>
					<p class="text-xs text-text-tertiary">
						This sets the CSV format used when you upload statements.
					</p>
				</div>
			{/if}

			<!-- Currency -->
			<div class="grid gap-1.5">
				<Label for="currency">Primary currency</Label>
				<select
					id="currency"
					bind:value={currency}
					disabled={submitting}
					class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs
					       transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none
					       disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#each CURRENCIES as c (c.code)}
						<option value={c.code}>{c.label}</option>
					{/each}
				</select>
				<p class="text-xs text-text-tertiary">
					The currency this account operates in. Non-EUR accounts will need a conversion rate for
					EUR reporting.
				</p>
			</div>

			<!-- IBAN last 4 -->
			{#if !isCash}
				<div class="grid gap-1.5">
					<Label for="ibanLast4">Last 4 digits of IBAN / card</Label>
					<Input
						id="ibanLast4"
						bind:value={ibanLast4}
						placeholder="1234"
						maxlength={4}
						inputmode="numeric"
						required
						disabled={submitting}
						class="max-w-28 font-mono tracking-widest"
					/>
					<p class="text-xs text-text-tertiary">
						Used to identify the account. Not stored as a full IBAN.
					</p>
				</div>
			{/if}

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
				disabled={submitting || !displayName.trim() || (!isCash && !ibanLast4.trim())}
			>
				{submitting ? 'Adding…' : 'Add account'}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
