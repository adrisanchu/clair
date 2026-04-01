<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';

	let { form }: { form: ActionData } = $props();

	let showPassword = $state(false);
	let loading = $state(false);
</script>

<div class="flex min-h-screen flex-col items-center justify-center bg-primary-50 px-4 py-12">
	<div class="w-full max-w-sm">
		<!-- Card -->
		<div class="rounded-2xl border border-border bg-surface px-8 py-10 shadow-sm">
			<!-- Wordmark -->
			<div class="mb-8 flex items-center gap-2.5">
				<div class="h-6 w-6 rounded bg-primary-500"></div>
				<span class="text-xl font-semibold tracking-tight text-primary-600">Clair</span>
			</div>

			<!-- Heading -->
			<div class="mb-7">
				<h1 class="text-2xl font-semibold text-text-primary">Sign in to Clair</h1>
			</div>

			<!-- Form -->
			<form
				method="POST"
				action="?/signIn"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
				class="flex flex-col gap-5"
			>
				<!-- Email -->
				<div class="flex flex-col gap-1.5">
					<Label for="email" class="text-sm text-text-primary">Email address</Label>
					<Input
						id="email"
						name="email"
						type="email"
						autocomplete="email"
						placeholder="you@example.com"
						required
						disabled={loading}
						class="h-11"
					/>
				</div>

				<!-- Password -->
				<div class="flex flex-col gap-1.5">
					<Label for="password" class="text-sm text-text-primary">Password</Label>
					<div class="relative">
						<Input
							id="password"
							name="password"
							type={showPassword ? 'text' : 'password'}
							autocomplete="current-password"
							placeholder="••••••••"
							required
							disabled={loading}
							class="h-11 pr-10"
						/>
						<button
							type="button"
							onclick={() => (showPassword = !showPassword)}
							class="absolute top-1/2 right-3 -translate-y-1/2 text-text-tertiary transition-colors hover:text-text-secondary"
							aria-label={showPassword ? 'Hide password' : 'Show password'}
						>
							{#if showPassword}
								<EyeOff size={16} />
							{:else}
								<Eye size={16} />
							{/if}
						</button>
					</div>
				</div>

				<!-- Error message -->
				{#if form?.message}
					<p class="rounded-lg bg-danger-50 px-3 py-2.5 text-sm text-danger-600">
						{form.message}
					</p>
				{/if}

				<!-- Submit -->
				<Button type="submit" class="h-11 w-full" disabled={loading}>
					{loading ? 'Signing in…' : 'Sign in'}
				</Button>

				<!-- Forgot password -->
				<p class="text-center text-sm text-text-secondary">
					<button type="button" class="hover:text-text-primary hover:underline">
						Forgot password?
					</button>
				</p>
			</form>
		</div>

		<!-- Invite-only footer -->
		<p class="mt-6 text-center text-xs text-text-tertiary">Access is by invitation only.</p>
	</div>
</div>
