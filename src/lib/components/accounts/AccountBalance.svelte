<script lang="ts">
	import Amount from '$lib/components/Amount.svelte';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';

	interface Props {
		/** Balance in the account's own currency. */
		value: number;
		currency: string;
		/** EUR value of the balance — shown as a secondary line on foreign accounts. */
		balanceEur: number;
		/** Some rows have no EUR value yet, so `balanceEur` is incomplete. */
		eurPartial?: boolean;
		size?: 'lg' | '2xl';
		colorize?: boolean;
	}

	let {
		value,
		currency,
		balanceEur,
		eurPartial = false,
		size = 'lg',
		colorize = true
	}: Props = $props();

	const isForeign = $derived(currency !== PRIMARY_CURRENCY);
</script>

<div>
	<Amount {value} {currency} {size} {colorize} showSign={false} />
	{#if isForeign}
		<p class="mt-0.5 flex items-center gap-1 text-xs text-text-tertiary">
			<span>≈</span>
			<Amount
				value={balanceEur}
				currency={PRIMARY_CURRENCY}
				size="xs"
				colorize={false}
				showSign={balanceEur < 0}
			/>
			{#if eurPartial}
				<span title="Some transactions have no exchange rate yet">· partial</span>
			{/if}
		</p>
	{/if}
</div>
