<script lang="ts">
	interface Props {
		name: string;
		bankProfileId?: string;
		size?: 'sm' | 'md' | 'lg';
		class?: string;
	}

	let { name, bankProfileId = '', size = 'md', class: cls = '' }: Props = $props();

	const BANK_COLOURS: Record<string, string> = {
		revolut_eu: 'bg-gray-900 text-white',
		caixabank_es: 'bg-violet-500 text-white',
		bankinter_es: 'bg-orange-500 text-white',
		bbva_es: 'bg-blue-600 text-white',
		myinvestor_es: 'bg-emerald-500 text-white'
	};

	const FALLBACK_PALETTE = [
		'bg-blue-500 text-white',
		'bg-emerald-500 text-white',
		'bg-violet-500 text-white',
		'bg-orange-500 text-white',
		'bg-pink-500 text-white'
	];

	const sizeMap: Record<string, string> = {
		sm: 'h-8 w-8 text-xs',
		md: 'h-10 w-10 text-sm',
		lg: 'h-12 w-12 text-base'
	};

	const colour = $derived(
		BANK_COLOURS[bankProfileId] ??
			FALLBACK_PALETTE[name.charCodeAt(0) % FALLBACK_PALETTE.length]
	);
	const letter = $derived(name[0]?.toUpperCase() ?? '?');
</script>

<div
	class="rounded-full flex items-center justify-center font-semibold shrink-0 {sizeMap[size]} {colour} {cls}"
>
	{letter}
</div>
