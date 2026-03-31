<script lang="ts">
	import { invalidateAll } from '$app/navigation'
	import { formatDistanceToNow } from 'date-fns'
	import { DropdownMenu } from 'bits-ui'
	import { Plus, Upload, MoreHorizontal, Pencil, Trash2, Landmark } from '@lucide/svelte'
	import Amount from '$lib/components/Amount.svelte'
	import BankLogo from '$lib/components/BankLogo.svelte'
	import AddAccountSheet from '$lib/components/accounts/AddAccountSheet.svelte'
	import * as Card from '$lib/components/ui/card'
	import { Button } from '$lib/components/ui/button'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	let addOpen = $state(false)
	let renamingId = $state<string | null>(null)
	let renameValue = $state('')
	let deletingId = $state<string | null>(null)

	function startRename(id: string, current: string) {
		renamingId = id
		renameValue = current
	}

	async function submitRename(id: string) {
		if (!renameValue.trim()) return
		await fetch(`/api/accounts/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayName: renameValue.trim() })
		})
		renamingId = null
		await invalidateAll()
	}

	async function deleteAccount(id: string, name: string) {
		if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
		deletingId = id
		await fetch(`/api/accounts/${id}`, { method: 'DELETE' })
		deletingId = null
		await invalidateAll()
	}

	function formatLastUpload(date: string | null): string {
		if (!date) return 'No uploads yet'
		return formatDistanceToNow(new Date(date), { addSuffix: true })
	}
</script>

<div class="px-4 py-6 md:px-8 md:py-8 max-w-5xl">
	<!-- Page header -->
	<div class="flex items-center justify-between mb-8">
		<h1 class="text-2xl font-semibold text-text-primary">Accounts</h1>
		<Button size="sm" onclick={() => (addOpen = true)}>
			<Plus size={15} />
			Add account
		</Button>
	</div>

	{#if data.accounts.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center py-24 text-center px-4">
			<div
				class="w-14 h-14 rounded-full bg-surface-sunken flex items-center justify-center mb-4 text-text-tertiary"
			>
				<Landmark size={24} />
			</div>
			<p class="text-sm font-medium text-text-primary mb-1">No bank accounts yet</p>
			<p class="text-sm text-text-secondary mb-6">Add your first account to get started.</p>
			<Button size="sm" onclick={() => (addOpen = true)}>
				<Plus size={15} />
				Add bank account
			</Button>
		</div>
	{:else}
		<!-- Account cards grid -->
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
			{#each data.accounts as account (account.id)}
				<Card.Root
					class="bg-surface border-border shadow-sm flex flex-col opacity-{deletingId === account.id ? '50' : '100'} transition-opacity"
				>
					<Card.Content class="p-4 flex-1">
						<!-- Header row -->
						<div class="flex items-start justify-between mb-4">
							<div class="flex items-center gap-2.5">
								<BankLogo
									name={account.displayName}
									bankProfileId={account.bankProfileId}
								/>
								<div class="min-w-0">
									{#if renamingId === account.id}
										<input
											type="text"
											bind:value={renameValue}
											onblur={() => submitRename(account.id)}
											onkeydown={(e) => {
												if (e.key === 'Enter') submitRename(account.id)
												if (e.key === 'Escape') (renamingId = null)
											}}
											class="text-sm font-medium text-text-primary bg-surface-sunken rounded px-1.5 py-0.5 border border-border w-full outline-none focus:ring-2 focus:ring-primary-500/30"
											autofocus
										/>
									{:else}
										<p class="text-sm font-medium text-text-primary leading-tight truncate">
											{account.displayName}
										</p>
									{/if}
									<p class="text-xs text-text-tertiary mt-0.5">
										···{account.ibanLast4} · {account.currency}
									</p>
								</div>
							</div>

							<!-- Status dot + actions menu -->
							<div class="flex items-center gap-1 mt-0.5 shrink-0">
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
													class="text-text-tertiary hover:text-text-secondary transition-colors rounded p-0.5 -mr-0.5"
												>
													<MoreHorizontal size={15} />
												</button>
											{/snippet}
										</DropdownMenu.Trigger>
										<DropdownMenu.Content
											class="z-50 min-w-36 rounded-lg border border-border bg-surface shadow-md p-1 text-sm"
											sideOffset={4}
										>
											<DropdownMenu.Item
												class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary hover:bg-surface-sunken cursor-pointer outline-none"
												onclick={() => startRename(account.id, account.displayName)}
											>
												<Pencil size={13} class="text-text-tertiary" />
												Rename
											</DropdownMenu.Item>
											<DropdownMenu.Separator class="my-1 -mx-1 h-px bg-border" />
											<DropdownMenu.Item
												class="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-danger-600 hover:bg-danger-50 cursor-pointer outline-none"
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
					<div class="px-4 pb-4 pt-0 flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							class="flex-1 gap-1.5 text-xs"
							disabled
							title="Upload — coming in next phase"
						>
							<Upload size={13} />
							Upload CSV
						</Button>
					</div>

					<!-- Coming soon strip -->
					<div
						class="bg-surface-sunken border-t border-border text-xs text-text-tertiary px-4 py-2 rounded-b-xl flex items-center gap-1.5"
					>
						<span>🔒</span>
						<span>Automatic sync — Coming soon</span>
					</div>
				</Card.Root>
			{/each}

			<!-- Add account card -->
			<button
				onclick={() => (addOpen = true)}
				class="rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-2
				       text-text-tertiary hover:text-text-secondary hover:border-border-strong transition-colors min-h-48 p-4"
			>
				<div
					class="h-10 w-10 rounded-full border-2 border-dashed border-current flex items-center justify-center"
				>
					<Plus size={18} />
				</div>
				<span class="text-sm font-medium">Add account</span>
			</button>
		</div>
	{/if}
</div>

<AddAccountSheet profiles={data.profiles} bind:open={addOpen} />
