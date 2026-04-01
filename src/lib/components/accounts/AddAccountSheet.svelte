<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

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

	let displayName = $state('');
	let bankProfileId = $state(profiles[0]?.id ?? '');
	let ibanLast4 = $state('');
	let submitting = $state(false);
	let fieldError = $state<string | null>(null);

	function reset() {
		displayName = '';
		bankProfileId = profiles[0]?.id ?? '';
		ibanLast4 = '';
		fieldError = null;
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		fieldError = null;

		if (!ibanLast4.trim() || !/^\d{4}$/.test(ibanLast4.trim())) {
			fieldError = 'IBAN last 4 must be exactly 4 digits';
			return;
		}

		submitting = true;
		try {
			const res = await fetch('/api/accounts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ displayName, bankProfileId, ibanLast4: ibanLast4.trim() })
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
			<Sheet.Title>Add bank account</Sheet.Title>
			<Sheet.Description>Connect a bank account to start uploading transactions.</Sheet.Description>
		</Sheet.Header>

		<form onsubmit={handleSubmit} class="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-2">
			<!-- Display name -->
			<div class="grid gap-1.5">
				<Label for="displayName">Account name</Label>
				<Input
					id="displayName"
					bind:value={displayName}
					placeholder="e.g. Revolut, BBVA Main"
					required
					disabled={submitting}
				/>
				<p class="text-xs text-text-tertiary">A friendly name shown in the app.</p>
			</div>

			<!-- Bank profile -->
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

			<!-- IBAN last 4 -->
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
				disabled={submitting || !displayName.trim() || !ibanLast4.trim()}
			>
				{submitting ? 'Adding…' : 'Add account'}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
