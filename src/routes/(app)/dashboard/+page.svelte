<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';

	let { data }: { data: PageData } = $props();
</script>

<div class="flex min-h-screen flex-col items-center justify-center gap-6 bg-surface-raised">
	<div class="rounded-2xl border border-border bg-surface px-8 py-10 shadow-sm">
		<div class="mb-1 flex items-center gap-2.5">
			<div class="h-6 w-6 rounded bg-primary-500"></div>
			<span class="text-xl font-semibold tracking-tight text-primary-600">Clair</span>
		</div>
		<p class="mt-4 text-lg font-semibold text-text-primary">Welcome, {data.user.name}!</p>
		<p class="mt-1 text-sm text-text-secondary">Dashboard coming soon.</p>
		<form method="POST" action="?/signOut" use:enhance class="mt-6">
			<Button variant="outline" type="submit">Sign out</Button>
		</form>
	</div>
</div>
