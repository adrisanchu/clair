<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils.js';

	let {
		class: className,
		children,
		...restProps
	}: { class?: string; children: Snippet; [key: string]: unknown } = $props();
</script>

<div class={cn('flex flex-col gap-2 text-left', className)} {...restProps}>
	{@render children()}
</div>
