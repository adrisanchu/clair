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
	class="hidden min-h-screen w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-6 md:flex"
>
	<!-- Logo -->
	<div class="mb-8 flex items-center gap-2.5 px-3">
		<div class="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500">
			<span class="text-xs font-bold text-white">C</span>
		</div>
		<span class="text-lg font-semibold tracking-tight text-text-primary">Clair</span>
	</div>

	<!-- Nav links -->
	<div class="flex flex-1 flex-col gap-0.5">
		{#each links as link}
			{@const active = page.url.pathname.startsWith(link.href)}
			<a
				href={link.href}
				class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors
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
	<div class="flex flex-col gap-0.5 border-t border-border pt-4">
		<a
			href="/settings"
			class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
		>
			<Settings size={18} />
			Settings
		</a>
		<button
			onclick={handleSignOut}
			class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
		>
			<LogOut size={18} />
			Sign out
		</button>

		<!-- User info -->
		<div class="mt-1 flex items-center gap-2.5 px-3 py-2.5">
			<div
				class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700"
			>
				{initials}
			</div>
			<div class="min-w-0">
				<p class="truncate text-sm font-medium text-text-primary">{user.name}</p>
				<p class="text-xs text-text-tertiary">{roleLabel}</p>
			</div>
		</div>
	</div>
</nav>
