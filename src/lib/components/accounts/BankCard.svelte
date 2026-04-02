<script lang="ts">
	import { formatDistanceToNow } from 'date-fns';
	import { DropdownMenu } from 'bits-ui';
	import { Upload, EllipsisVertical, Pencil, Trash2 } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import BankLogo from '$lib/components/BankLogo.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import type { Account } from '$lib/types';

	interface Props {
		account: Account;
		isDeleting?: boolean;
		onnavigate: () => void;
		onupload: () => void;
		onrename: (newName: string) => void;
		ondelete: () => void;
	}

	let { account, isDeleting = false, onnavigate, onupload, onrename, ondelete }: Props = $props();

	let isRenaming = $state(false);
	let renameValue = $state('');

	function startRename() {
		isRenaming = true;
		renameValue = account.displayName;
	}

	function submitRename() {
		const trimmed = renameValue.trim();
		isRenaming = false;
		if (trimmed && trimmed !== account.displayName) {
			onrename(trimmed);
		}
	}

	function handleCardClick(e: MouseEvent) {
		// Navigate only when the click didn't originate from an interactive element
		if (!(e.target as HTMLElement).closest('button, input, a, [role="menuitem"]')) {
			onnavigate();
		}
	}

	function formatLastUpload(date: Date | string | null): string {
		if (!date) return 'No uploads yet';
		return formatDistanceToNow(new Date(date), { addSuffix: true });
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="group block cursor-pointer"
	role="link"
	tabindex="0"
	onclick={handleCardClick}
	onkeydown={(e) => { if (e.key === 'Enter') onnavigate(); }}
>
	<Card.Root
		class="flex h-full flex-col gap-0 border-border bg-surface py-0 shadow-sm transition group-hover:shadow-md {isDeleting
			? 'opacity-50'
			: 'opacity-100'}"
	>
		<Card.Content class="flex-1 p-4">
			<!-- Header row -->
			<div class="mb-4 flex items-start justify-between">
				<div class="flex items-center gap-2.5">
					<BankLogo name={account.displayName} bankProfileId={account.bankProfileId ?? undefined} />
					<div class="min-w-0">
						{#if isRenaming}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="text"
								bind:value={renameValue}
								onblur={submitRename}
								onkeydown={(e) => {
									if (e.key === 'Enter') submitRename();
									if (e.key === 'Escape') (isRenaming = false);
								}}
								class="w-full rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-sm font-medium text-text-primary outline-none focus:ring-2 focus:ring-primary-500/30"
								autofocus
							/>
						{:else}
							<p class="truncate text-sm font-medium leading-tight text-text-primary">
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
										<EllipsisVertical size={15} />
									</button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content
								class="z-50 min-w-36 rounded-lg border border-border bg-surface p-1 text-sm shadow-md"
								sideOffset={4}
							>
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-text-primary outline-none hover:bg-surface-sunken"
									onclick={startRename}
								>
									<Pencil size={13} class="text-text-tertiary" />
									Rename
								</DropdownMenu.Item>
								<DropdownMenu.Separator class="-mx-1 my-1 h-px bg-border" />
								<DropdownMenu.Item
									class="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-danger-600 outline-none hover:bg-danger-50"
									onclick={ondelete}
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
			<Button variant="outline" size="sm" class="flex-1 gap-1.5 text-xs" onclick={onupload}>
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
</div>
