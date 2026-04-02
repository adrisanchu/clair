<script lang="ts">
	import { page } from '$app/state';
	import { AlertTriangle, SearchX } from '@lucide/svelte';

	const is404 = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{page.status} — Clair</title>
</svelte:head>

<div
	class="bg-surface text-text-primary flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-sans"
>
	{#if is404}
		<SearchX class="text-text-tertiary h-10 w-10" />
	{:else}
		<AlertTriangle class="text-danger-600 h-10 w-10" />
	{/if}

	<div class="flex flex-col items-center gap-1 text-center">
		<h1 class="text-xl font-semibold">
			{#if is404}
				Page not found
			{:else}
				Something went wrong
			{/if}
		</h1>
		<p class="text-text-secondary text-sm">
			{#if is404}
				The page you're looking for doesn't exist.
			{:else}
				An unexpected error occurred.
			{/if}
		</p>
	</div>

	<a href="/dashboard" class="text-primary-500 text-sm underline underline-offset-4">
		Go to dashboard
	</a>
</div>
