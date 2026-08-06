<script lang="ts">
	import { cn } from '$lib/utils';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';

	interface Props {
		value: number;
		currency?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
		showSign?: boolean;
		colorize?: boolean;
		/** Render struck-through and muted — used for reverted/returned transactions. */
		struck?: boolean;
		class?: string;
	}

	let {
		value,
		currency = PRIMARY_CURRENCY,
		size = 'md',
		showSign = true,
		colorize = true,
		struck = false,
		class: cls = ''
	}: Props = $props();

	const sizeMap: Record<string, string> = {
		xs: 'text-xs',
		sm: 'text-sm',
		md: 'text-base',
		lg: 'text-xl',
		xl: 'text-2xl',
		'2xl': 'text-3xl',
		'3xl': 'text-4xl'
	};

	const formatted = $derived(
		new Intl.NumberFormat('es-ES', {
			style: 'currency',
			currency,
			minimumFractionDigits: 2
		}).format(Math.abs(value))
	);

	const sign = $derived(showSign ? (value > 0 ? '+' : value < 0 ? '−' : '') : '');

	const colourClass = $derived(
		struck
			? 'text-text-tertiary'
			: colorize
				? value > 0
					? 'text-success-600'
					: value < 0
						? 'text-danger-600'
						: 'text-text-secondary'
				: ''
	);
</script>

<span
	class={cn('font-mono tabular-nums', sizeMap[size], colourClass, struck && 'line-through', cls)}
>
	{sign}{formatted}
</span>
