<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		icon: Component<{ size: number }>;
		title: string;
		description?: string;
		compact?: boolean;
		class?: string;
		children?: Snippet;
	}
	let { icon: Icon, title, description, compact = false, class: className, children }: Props = $props();
</script>

<div
	class={cn(
		'flex flex-col items-center justify-center px-4 text-center',
		compact ? 'py-12' : 'py-24',
		className
	)}
>
	<div
		class={cn(
			'mb-4 flex items-center justify-center rounded-full bg-surface-sunken text-text-tertiary',
			compact ? 'h-12 w-12' : 'h-14 w-14'
		)}
	>
		<Icon size={compact ? 22 : 24} />
	</div>
	<p class="mb-1 text-sm font-medium text-text-primary">{title}</p>
	{#if description}
		<p class={cn('text-sm text-text-secondary', children ? 'mb-6' : '')}>{description}</p>
	{/if}
	{#if children}
		{@render children()}
	{/if}
</div>
