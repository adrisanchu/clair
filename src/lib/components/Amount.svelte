<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		value: number;
		currency?: string;
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
		showSign?: boolean;
		colorize?: boolean;
		class?: string;
	}

	let {
		value,
		currency = 'EUR',
		size = 'md',
		showSign = true,
		colorize = true,
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
		colorize
			? value > 0
				? 'text-success-600'
				: value < 0
					? 'text-danger-600'
					: 'text-text-secondary'
			: ''
	);
</script>

<span class={cn('font-mono tabular-nums', sizeMap[size], colourClass, cls)}>
	{sign}{formatted}
</span>
