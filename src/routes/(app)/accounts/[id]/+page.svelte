<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { formatDistanceToNow, format } from 'date-fns';
	import { ArrowLeft, Upload, Trash2, Check, X } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import BankLogo from '$lib/components/BankLogo.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let renaming = $state(false);
	let renameValue = $state(data.account.displayName);
	let renameSubmitting = $state(false);
	let deleteConfirm = $state(false);

	async function submitRename() {
		if (!renameValue.trim() || renameValue === data.account.displayName) {
			renaming = false;
			renameValue = data.account.displayName;
			return;
		}
		renameSubmitting = true;
		await fetch(`/api/accounts/${data.account.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ displayName: renameValue.trim() })
		});
		renaming = false;
		renameSubmitting = false;
		await invalidateAll();
	}

	async function deleteAccount() {
		await fetch(`/api/accounts/${data.account.id}`, { method: 'DELETE' });
		goto('/accounts');
	}

	function formatUploadRange(from: Date | string | null, to: Date | string | null): string {
		if (!from) return '—';
		const f = new Date(from);
		const t = to ? new Date(to) : f;
		if (f.getFullYear() === t.getFullYear() && f.getMonth() === t.getMonth()) {
			return format(f, 'MMM yyyy');
		}
		return `${format(f, 'MMM yyyy')} – ${format(t, 'MMM yyyy')}`;
	}
</script>

<div class="max-w-2xl px-4 py-6 md:px-8 md:py-8">
	<!-- Back -->
	<a
		href="/accounts"
		class="mb-6 inline-flex items-center gap-1.5 text-sm text-text-secondary transition-colors hover:text-text-primary"
	>
		<ArrowLeft size={15} />
		Accounts
	</a>

	<!-- Account header -->
	<div class="mb-8 flex items-center gap-3">
		<BankLogo
			name={data.account.displayName}
			bankProfileId={data.account.bankProfileId}
			size="lg"
		/>
		<div class="min-w-0 flex-1">
			{#if renaming}
				<div class="flex items-center gap-2">
					<Input
						bind:value={renameValue}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter') submitRename();
							if (e.key === 'Escape') {
								renaming = false;
								renameValue = data.account.displayName;
							}
						}}
						class="h-8 text-lg font-semibold"
						autofocus
						disabled={renameSubmitting}
					/>
					<Button size="icon-sm" variant="ghost" onclick={submitRename} disabled={renameSubmitting}>
						<Check size={14} />
					</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						onclick={() => {
							renaming = false;
							renameValue = data.account.displayName;
						}}
					>
						<X size={14} />
					</Button>
				</div>
			{:else}
				<div class="flex items-center gap-2">
					<h1 class="truncate text-xl font-semibold text-text-primary">
						{data.account.displayName}
					</h1>
					{#if data.isOwner}
						<button
							onclick={() => (renaming = true)}
							class="shrink-0 text-xs text-text-tertiary transition-colors hover:text-primary-600"
						>
							Rename
						</button>
					{/if}
				</div>
			{/if}
			<p class="mt-0.5 text-sm text-text-tertiary">
				···{data.account.ibanLast4} · {data.account.currency} ·
				{data.account.institutionName}
			</p>
		</div>
	</div>

	<!-- Balance + status -->
	<div class="mb-8 flex items-end justify-between">
		<div>
			<p class="mb-1 text-xs font-semibold tracking-widest text-text-tertiary uppercase">Balance</p>
			<Amount value={data.account.currentBalance} size="2xl" showSign={false} colorize={false} />
		</div>
		<span
			class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium
			{data.account.status === 'active'
				? 'bg-success-50 text-success-600'
				: 'bg-surface-sunken text-text-tertiary'}"
		>
			<span
				class="h-1.5 w-1.5 rounded-full {data.account.status === 'active'
					? 'bg-success-500'
					: 'bg-text-tertiary'}"
			></span>
			{data.account.status === 'active' ? 'Active' : 'No data'}
		</span>
	</div>

	<!-- Upload history -->
	<Card.Root class="mb-6 border-border bg-surface">
		<Card.Header class="pb-3">
			<div class="flex items-center justify-between">
				<Card.Title class="text-sm font-semibold tracking-widest text-text-tertiary uppercase">
					Upload history
				</Card.Title>
				<Button
					size="sm"
					variant="outline"
					class="gap-1.5 text-xs"
					disabled
					title="Coming in Phase 3d"
				>
					<Upload size={13} />
					Upload CSV
				</Button>
			</div>
		</Card.Header>
		<Card.Content class="pt-0">
			{#if data.uploads.length === 0}
				<p class="py-4 text-center text-sm text-text-tertiary">No uploads yet.</p>
			{:else}
				<div class="divide-y divide-border">
					{#each data.uploads as upload (upload.id)}
						<div class="flex items-center justify-between gap-4 py-3 text-sm">
							<div class="min-w-0">
								<p class="truncate font-medium text-text-primary">{upload.filename}</p>
								<p class="mt-0.5 text-xs text-text-tertiary">
									{formatUploadRange(upload.dateRangeFrom, upload.dateRangeTo)}
								</p>
							</div>
							<div class="shrink-0 text-right text-xs text-text-tertiary">
								<p class="font-medium text-text-secondary">{upload.importedCount} imported</p>
								<p>{formatDistanceToNow(new Date(upload.uploadedAt), { addSuffix: true })}</p>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Danger zone (owner only) -->
	{#if data.isOwner}
		<Card.Root class="border-danger-600/20 bg-surface">
			<Card.Header class="pb-3">
				<Card.Title class="text-sm font-semibold tracking-widest text-text-tertiary uppercase">
					Danger zone
				</Card.Title>
			</Card.Header>
			<Card.Content class="pt-0">
				{#if deleteConfirm}
					<p class="mb-3 text-sm text-text-secondary">
						Are you sure? This will permanently delete <strong>{data.account.displayName}</strong>
						and all its data.
					</p>
					<div class="flex gap-2">
						<Button variant="destructive" size="sm" onclick={deleteAccount}>Yes, delete</Button>
						<Button variant="outline" size="sm" onclick={() => (deleteConfirm = false)}>
							Cancel
						</Button>
					</div>
				{:else}
					<div class="flex items-center justify-between">
						<p class="text-sm text-text-secondary">Remove this account and all its transactions.</p>
						<Button
							variant="destructive"
							size="sm"
							class="shrink-0 gap-1.5"
							onclick={() => (deleteConfirm = true)}
						>
							<Trash2 size={13} />
							Delete account
						</Button>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
