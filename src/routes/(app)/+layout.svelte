<script lang="ts">
	import Sidebar from '$lib/components/layout/Sidebar.svelte';
	import BottomNav from '$lib/components/layout/BottomNav.svelte';
	import type { LayoutData } from './$types';

	interface Props {
		data: LayoutData;
		children: import('svelte').Snippet;
	}

	let { data, children }: Props = $props();
</script>

<div class="flex min-h-screen bg-surface-raised">
	<Sidebar user={data.user} />
	<main class="flex-1 pb-20 md:pb-0 min-w-0 overflow-x-hidden">
		{@render children()}
	</main>
	<BottomNav />
</div>
