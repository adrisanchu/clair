<script lang="ts">
	import { page } from '$app/state';
	import { LayoutDashboard, Landmark, ArrowLeftRight, Download } from '@lucide/svelte';

	const tabs = [
		{ href: '/dashboard', label: 'Home', Icon: LayoutDashboard },
		{ href: '/accounts', label: 'Accounts', Icon: Landmark },
		{ href: '/transactions', label: 'Trans.', Icon: ArrowLeftRight },
		{ href: '/export', label: 'Export', Icon: Download }
	];
</script>

<nav
	class="md:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-border flex h-16 z-50 safe-area-bottom"
>
	{#each tabs as tab}
		{@const active = page.url.pathname.startsWith(tab.href)}
		<a
			href={tab.href}
			class="flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors
				{active ? 'text-primary-500' : 'text-text-tertiary'}"
		>
			<tab.Icon size={20} />
			<span class="text-[10px] font-medium">{tab.label}</span>
		</a>
	{/each}
</nav>
