<script lang="ts">
	import { page } from '$app/state';
	import { AlertTriangle, SearchX } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';

	const is404 = $derived(page.status === 404);
</script>

<main class="flex flex-1 flex-col items-center justify-center gap-6 p-8">
	<div class="flex flex-col items-center gap-4 text-center">
		{#if is404}
			<SearchX class="h-12 w-12 text-text-tertiary" />
		{:else}
			<AlertTriangle class="h-12 w-12 text-danger-600" />
		{/if}

		<div class="flex flex-col gap-1">
			<h1 class="text-2xl font-semibold text-text-primary">
				{#if is404}
					Page not found
				{:else}
					Something went wrong
				{/if}
			</h1>
			<p class="text-text-secondary">
				{#if is404}
					The page you're looking for doesn't exist.
				{:else}
					An unexpected error occurred.
				{/if}
			</p>
		</div>

		<div class="flex gap-2">
			{#if !is404}
				<Button variant="outline" onclick={() => window.location.reload()}>Try again</Button>
			{/if}
			<Button href="/dashboard">Go to dashboard</Button>
		</div>
	</div>
</main>
