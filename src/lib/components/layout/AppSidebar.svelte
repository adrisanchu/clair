<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { authClient } from '$lib/auth-client';
	import * as Sidebar from '$lib/components/ui/sidebar';
	import {
		LayoutDashboard,
		Landmark,
		ArrowLeftRight,
		Upload,
		Download,
		Settings,
		LogOut
	} from '@lucide/svelte';

	interface Props {
		user: { name: string; email: string; role?: string | null };
	}

	let { user }: Props = $props();

	const { setOpenMobile, isMobile } = Sidebar.useSidebar();

	function handleNavClick() {
		if (isMobile) setOpenMobile(false);
	}

	const navLinks = [
		{ href: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
		{ href: '/accounts', label: 'Accounts', Icon: Landmark },
		{ href: '/transactions', label: 'Transactions', Icon: ArrowLeftRight },
		{ href: '/upload', label: 'Upload', Icon: Upload },
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

<Sidebar.Root collapsible="icon">
	<!-- Logo / brand header -->
	<Sidebar.Header>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg" class="gap-3" tooltipContent="Clair">
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-sm font-bold text-white"
					>
						C
					</div>
					<span class="truncate text-base font-semibold tracking-tight">Clair</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Header>

	<!-- Main nav -->
	<Sidebar.Content>
		<Sidebar.Group>
			<Sidebar.GroupContent>
				<Sidebar.Menu>
					{#each navLinks as link (link.href)}
						{@const active = page.url.pathname.startsWith(link.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton
								isActive={active}
								tooltipContent={link.label}
								class={active ? 'bg-primary-50! font-medium text-primary-600!' : ''}
							>
								{#snippet child({ props })}
									<a href={link.href} {...props} onclick={handleNavClick}>
										<link.Icon />
										<span>{link.label}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.GroupContent>
		</Sidebar.Group>
	</Sidebar.Content>

	<!-- Footer: settings, sign out, user -->
	<Sidebar.Footer>
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton tooltipContent="Settings">
					{#snippet child({ props })}
						<a href="/settings" {...props} onclick={handleNavClick}>
							<Settings />
							<span>Settings</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>

			<Sidebar.MenuItem>
				<Sidebar.MenuButton tooltipContent="Sign out" onclick={handleSignOut}>
					<LogOut />
					<span>Sign out</span>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>

		<Sidebar.Separator />

		<!-- User identity -->
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton size="lg" tooltipContent={user.name}>
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700"
					>
						{initials}
					</div>
					<div class="grid min-w-0 flex-1 text-left text-sm leading-tight">
						<span class="truncate font-medium">{user.name}</span>
						<span class="truncate text-xs text-muted-foreground">{roleLabel}</span>
					</div>
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
	</Sidebar.Footer>

	<Sidebar.Rail />
</Sidebar.Root>
