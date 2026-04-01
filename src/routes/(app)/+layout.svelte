<script lang="ts">
	import AppSidebar from '$lib/components/layout/AppSidebar.svelte';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import type { LayoutData } from './$types';

	interface Props {
		data: LayoutData;
		children: import('svelte').Snippet;
	}

	let { data, children }: Props = $props();
</script>

<Sidebar.Provider>
	<AppSidebar user={data.user} />

	<Sidebar.Inset class="bg-surface-raised">
		<!-- Top bar: sidebar toggle -->
		<header
			class="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-4"
		>
			<Sidebar.Trigger class="text-text-secondary hover:text-text-primary -ml-1" />
		</header>

		{@render children()}
	</Sidebar.Inset>
</Sidebar.Provider>
