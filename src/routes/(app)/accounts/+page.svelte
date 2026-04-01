<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDistanceToNow } from 'date-fns';
	import { DropdownMenu } from 'bits-ui';
	import { Plus, Upload, MoreHorizontal, Pencil, Trash2, Landmark } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import BankLogo from '$lib/components/BankLogo.svelte';
	import AddAccountSheet from '$lib/components/accounts/AddAccountSheet.svelte';
	import UploadCsvDialog from '$lib/components/accounts/UploadCsvDialog.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let addOpen = $state(false);
	let uploadOpen = $state(false);
	let uploadAccount = $state<(typeof data.accounts)[0] | null>(null);
	let renamingId = $state<string | null>(null);
	let renameValue = $state('');
	let deletingId = $state<string | null>(null);

	function startRename(id: string, current: string) {
		renamingId = id;
		renameValue = current;
	}

	async function submitRename(id: string) {
		if (!renameValue.trim()) return;
		await fetch(`/api/accounts/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayName: renameValue.trim() })
		});
		renamingId = null;
		await invalidateAll();
	}

	async function deleteAccount(id: string, name: string) {
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
		deletingId = id;
		await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
		deletingId = null;
		await invalidateAll();
	}

	function formatLastUpload(date: Date | string | null): string {
		if (!date) return 'No uploads yet';
		return formatDistanceToNow(new Date(date), { addSuffix: true });
	}
</script>

<div class="max-w-5xl px-4 py-6 md:px-8 md:py-8">
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
				<Card.Root
					class="flex flex-col border-border bg-surface shadow-sm opacity-{deletingId === account.id
						? '50'
						: '100'} transition-opacity"
				>
					<Card.Content class="flex-1 p-4">
						<!-- Header row -->
						<div class="mb-4 flex items-start justify-between">
							<div class="flex items-center gap-2.5">
								<BankLogo name={account.displayName} bankProfileId={account.bankProfileId} />
								<div class="min-w-0">
									{#if renamingId === account.id}
										<input
											type="text"
											bind:value={renameValue}
											onblur={() => submitRename(account.id)}
											onkeydown={(e) => {
												if (e.key === 'Enter') submitRename(account.id);
												if (e.key === 'Escape') renamingId = null;
											}}
											class="w-full rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-primary-500/30"
											autofocus
										/>
									{:else}
										<p class="truncate text-sm leading-tight font-medium text-text-primary">
											{account.displayName}
										</p>
									{/if}
									<p class="mt-0.5 text-xs text-text-tertiary">
										···{account.ibanLast4} · {account.currency}
									</p>
								</div>
							</div>

							<!-- Status dot + actions menu -->
							<div class="mt-0.5 flex shrink-0 items-center gap-1">
								<span
									class="h-2 w-2 rounded-full {account.status === 'active'
										? 'bg-success-500'
										: 'bg-border-strong'}"
								></span>

								{#if account.isOwner}
									<DropdownMenu.Root>
										<DropdownMenu.Trigger>
											{#snippet child({ props })}
												<button
													{...props}
													class="-mr-0.5 rounded p-0.5 text-text-tertiary transition-colors hover:text-text-secondary"
												>
													<MoreHorizontal size={15} />
												</button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content
											class="z-50 min-w-36 rounded-lg border border-border bg-surface p-1 text-sm shadow-md"
											sideOffset={4}
										>
											<DropdownMenu.Item
												class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary outline-none hover:bg-surface-sunken"
												onclick={() => startRename(account.id, account.displayName)}
											>
												<Pencil size={13} class="text-text-tertiary" />
												Rename
											</DropdownMenu.Item>
											<DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />
											<DropdownMenu.Item
												class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-danger-600 outline-none hover:bg-danger-50"
												onclick={() => deleteAccount(account.id, account.displayName)}
											>
												<Trash2 size={13} />
												Delete
											</DropdownMenu.Item>
										</DropdownMenu.Content>
									</DropdownMenu.Root>
								{/if}
							</div>
						</div>

						<!-- Balance -->
						<Amount value={account.currentBalance} size="lg" showSign={false} />

						<!-- Stats row -->
						<div class="mt-3 flex items-center gap-3 text-xs text-text-tertiary">
							{#if account.txCount > 0}
								<span>{account.txCount} transactions</span>
								<span>·</span>
							{/if}
							<span>{formatLastUpload(account.lastUploadedAt)}</span>
						</div>
					</Card.Content>

					<!-- Action bar -->
					<div class="flex items-center gap-2 px-4 pt-0 pb-4">
						<Button
							variant="outline"
							size="sm"
							class="flex-1 gap-1.5 text-xs"
							onclick={() => {
								uploadAccount = account;
								uploadOpen = true;
							}}
						>
							<Upload size={13} />
							Upload CSV
						</Button>
					</div>

					<!-- Coming soon strip -->
					<div
						class="flex items-center gap-1.5 rounded-b-xl border-t border-border bg-surface-sunken px-4 py-2 text-xs text-text-tertiary"
					>
						<span>🔒</span>
						<span>Automatic sync — Coming soon</span>
					</div>
				</Card.Root>
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
