<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import UploadWizard, { type AccountOption } from '$lib/components/upload/UploadWizard.svelte';

	interface Props {
		open: boolean;
		accountId: string;
		accountName: string;
		bankProfileId: string;
		currency: string;
		isFirstUpload: boolean;
	}

	let {
		open = $bindable(false),
		accountId,
		accountName,
		bankProfileId,
		currency,
		isFirstUpload
	}: Props = $props();

	let imported = $state(false);

	// The wizard resolves account details (name, profile, currency, first-upload) from
	// this single-account list keyed by `accountId`.
	const accounts = $derived<AccountOption[]>([
		{
			id: accountId,
			displayName: accountName,
			bankProfileId,
			currency,
			txCount: isFirstUpload ? 0 : 1
		}
	]);

	function handleOpenChange(v: boolean) {
		open = v;
		if (!v && imported) {
			invalidateAll();
			imported = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex flex-col overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>Import Transactions</Dialog.Title>
		</Dialog.Header>

		{#key open}
			<UploadWizard
				{accountId}
				{accounts}
				onImported={() => (imported = true)}
				onClose={() => (open = false)}
			/>
		{/key}
	</Dialog.Content>
</Dialog.Root>
