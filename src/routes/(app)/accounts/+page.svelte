<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { AlertTriangle, Plus, Landmark } from '@lucide/svelte';
	import ResolveFxDialog from '$lib/components/accounts/ResolveFxDialog.svelte';
	import AddAccountSheet from '$lib/components/accounts/AddAccountSheet.svelte';
	import BankCard from '$lib/components/accounts/BankCard.svelte';
	import UploadCsvDialog from '$lib/components/accounts/UploadCsvDialog.svelte';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let addOpen = $state(false);
	let uploadOpen = $state(false);
	let uploadAccount = $state<(typeof data.accounts)[0] | null>(null);
	let deletingId = $state<string | null>(null);
	let resolveFxAccount = $state<(typeof data.unresolvedFx)[0] | null>(null);

	async function handleRename(id: string, newName: string) {
		await fetch(`/api/accounts/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayName: newName })
		});
		await invalidateAll();
	}

	async function handleDelete(id: string, name: string) {
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
		deletingId = id;
		await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
		deletingId = null;
		await invalidateAll();
	}
</script>

<div class="max-w-5xl px-4 py-6 md:px-8 md:py-8">
	<!-- Unresolved FX banner -->
	{#if data.unresolvedFx.length > 0}
		<div class="mb-6 space-y-2">
			{#each data.unresolvedFx as fx}
				<div
					class="flex items-center justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
				>
					<div class="flex items-start gap-3">
						<AlertTriangle size={16} class="mt-0.5 shrink-0 text-amber-500" />
						<div class="min-w-0">
							<p class="text-sm font-medium text-amber-800">
								{fx.unresolvedCount}
								{fx.unresolvedCount === 1 ? 'transaction' : 'transactions'} in {fx.accountName} have no
								EUR rate.
							</p>
							<p class="mt-0.5 text-xs text-amber-700">
								Upload the matching EUR export or enter a conversion rate manually.
							</p>
						</div>
					</div>
					<button
						onclick={() => (resolveFxAccount = fx)}
						class="shrink-0 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
					>
						Resolve
					</button>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Page header -->
	<div class="mb-8 flex items-center justify-between">
		<h1 class="text-2xl font-semibold text-text-primary">Accounts</h1>
		<Button size="sm" onclick={() => (addOpen = true)}>
			<Plus size={15} />
			Add account
		</Button>
	</div>

	{#if data.accounts.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center px-4 py-24 text-center">
			<div
				class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-sunken text-text-tertiary"
			>
				<Landmark size={24} />
			</div>
			<p class="mb-1 text-sm font-medium text-text-primary">No bank accounts yet</p>
			<p class="mb-6 text-sm text-text-secondary">Add your first account to get started.</p>
			<Button size="sm" onclick={() => (addOpen = true)}>
				<Plus size={15} />
				Add bank account
			</Button>
		</div>
	{:else}
		<!-- Account cards grid -->
		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
			{#each data.accounts as account (account.id)}
				<BankCard
					{account}
					isDeleting={deletingId === account.id}
					onnavigate={() => goto(`/accounts/${account.id}`)}
					onupload={() => {
						uploadAccount = account;
						uploadOpen = true;
					}}
					onrename={(newName) => handleRename(account.id, newName)}
					ondelete={() => handleDelete(account.id, account.displayName)}
				/>
			{/each}

			<!-- Add account card -->
			<button
				onclick={() => (addOpen = true)}
				class="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed
				       border-border p-4 text-text-tertiary transition-colors hover:border-border-strong hover:text-text-secondary"
			>
				<div
					class="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-current"
				>
					<Plus size={18} />
				</div>
				<span class="text-sm font-medium">Add account</span>
			</button>
		</div>
	{/if}
</div>

<AddAccountSheet profiles={data.profiles} bind:open={addOpen} />

{#if uploadAccount}
	<UploadCsvDialog
		bind:open={uploadOpen}
		accountId={uploadAccount.id}
		accountName={uploadAccount.displayName}
		bankProfileId={uploadAccount.bankProfileId}
		currency={uploadAccount.currency}
		isFirstUpload={uploadAccount.txCount === 0}
	/>
{/if}

{#if resolveFxAccount}
	<ResolveFxDialog
		accountId={resolveFxAccount.accountId}
		accountName={resolveFxAccount.accountName}
		currency={resolveFxAccount.currency}
		unresolvedCount={resolveFxAccount.unresolvedCount}
		earliestDate={resolveFxAccount.earliestDate}
		latestDate={resolveFxAccount.latestDate}
		onclose={() => (resolveFxAccount = null)}
		onsuccess={() => {
			resolveFxAccount = null;
			invalidateAll();
		}}
	/>
{/if}
