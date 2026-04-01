<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import {
		LayoutDashboard,
		Landmark,
		ArrowLeftRight,
		Download,
		Settings,
		LogOut
	} from '@lucide/svelte';

	interface Props {
		user: { name: string; email: string; role?: string | null };
	}

	let { user }: Props = $props();

	const links = [
		{ href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
		{ href: '/accounts', label: 'Accounts', Icon: Landmark },
		{ href: '/transactions', label: 'Transactions', Icon: ArrowLeftRight },
		{ href: '/export', label: 'Export', Icon: Download }
	];

	const initials = $derived(
		user.name
			.split(' ')
			.map((n) => n[0])
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);

	const roleLabel = $derived(user.role === 'owner' ? 'Owner' : 'Member');

	async function handleSignOut() {
		await authClient.signOut();
		goto('/login');
	}
</script>

<nav
	class="hidden md:flex flex-col w-60 min-h-screen shrink-0 border-r border-border bg-surface px-3 py-6"
>
	<!-- Logo -->
	<div class="flex items-center gap-2.5 px-3 mb-8">
		<div class="h-7 w-7 rounded-lg bg-primary-500 flex items-center justify-center">
			<span class="text-white text-xs font-bold">C</span>
		</div>
		<span class="text-lg font-semibold tracking-tight text-text-primary">Clair</span>
	</div>

	<!-- Nav links -->
	<div class="flex flex-col gap-0.5 flex-1">
		{#each links as link}
			{@const active = page.url.pathname.startsWith(link.href)}
			<a
				href={link.href}
				class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
					{active
					? 'bg-primary-50 text-primary-600'
					: 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'}"
			>
				<link.Icon size={18} />
				{link.label}
			</a>
		{/each}
	</div>

	<!-- Bottom section -->
	<div class="border-t border-border pt-4 flex flex-col gap-0.5">
		<a
			href="/settings"
			class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-sunken hover:text-text-primary transition-colors"
		>
			<Settings size={18} />
			Settings
		</a>
		<button
			onclick={handleSignOut}
			class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-sunken hover:text-text-primary transition-colors w-full text-left"
		>
			<LogOut size={18} />
			Sign out
		</button>

		<!-- User info -->
		<div class="flex items-center gap-2.5 px-3 py-2.5 mt-1">
			<div
				class="h-8 w-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-semibold shrink-0"
			>
				{initials}
			</div>
			<div class="min-w-0">
				<p class="text-sm font-medium text-text-primary truncate">{user.name}</p>
				<p class="text-xs text-text-tertiary">{roleLabel}</p>
			</div>
		</div>
	</div>
</nav>
