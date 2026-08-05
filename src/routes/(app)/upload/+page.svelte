<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import UploadWizard from '$lib/components/upload/UploadWizard.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Upload · Clair</title>
</svelte:head>

<div class="mx-auto w-full max-w-xl px-4 py-8 sm:py-12">
	<div class="mb-6">
		<h1 class="text-xl font-semibold text-text-primary">Upload transactions</h1>
		<p class="mt-1 text-sm text-text-secondary">
			Import a bank statement CSV into any of your accounts.
		</p>
	</div>

	<div
		class="flex min-h-[34rem] flex-col rounded-xl border border-border bg-surface p-5 shadow-xs sm:p-6"
	>
		<UploadWizard
			accounts={data.accounts}
			profiles={data.profiles}
			onImported={() => invalidateAll()}
		/>
	</div>
</div>
