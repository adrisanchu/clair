<script lang="ts">
	import { format } from 'date-fns';
	import { ArrowRight, ArrowLeftRight } from '@lucide/svelte';
	import Amount from '$lib/components/Amount.svelte';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';
	import { cn } from '$lib/utils';
	import type { TransferPair, TxLeg } from '$lib/server/db/queries';

	interface Props {
		pair: TransferPair;
		/** When set, the whole card becomes a button (opens the pairing dialog). */
		onclick?: () => void;
	}
	let { pair, onclick }: Props = $props();

	// The foreign side drives the rate label (rate is stored foreign-per-EUR).
	const foreignCurrency = $derived(
		pair.out.currency !== PRIMARY_CURRENCY ? pair.out.currency : pair.in.currency
	);
	const rateLabel = $derived(
		pair.exchangeRate != null
			? new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(pair.exchangeRate)
			: null
	);

	const confidenceDot: Record<string, string> = {
		auto: 'bg-text-tertiary',
		confirmed: 'bg-success-500',
		manual: 'bg-primary-500'
	};
	const confidenceLabel: Record<string, string> = {
		auto: 'Auto-detected',
		confirmed: 'Confirmed',
		manual: 'Linked manually'
	};
</script>

{#snippet leg(l: TxLeg, direction: 'out' | 'in')}
	<div class="min-w-0 flex-1">
		<!-- Account chip and date on their own rows -->
		<div class="flex flex-col items-start gap-1">
			{#if l.accountName}
				<span
					class="inline-flex max-w-full items-center truncate rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-text-secondary uppercase"
				>
					{l.accountName}
				</span>
			{/if}
			<span class="text-[11px] text-text-tertiary tabular-nums">
				{format(l.accountingDate, 'd MMM yyyy')}
			</span>
		</div>

		<p class="mt-2 truncate text-sm font-medium text-text-primary">{l.description}</p>

		<div class="mt-1">
			<Amount value={l.amount} currency={l.currency} size="md" showSign />
			{#if l.currency !== PRIMARY_CURRENCY && l.amountEur != null}
				<div class="text-[11px] text-text-tertiary">
					<Amount value={l.amountEur} currency={PRIMARY_CURRENCY} size="xs" colorize={false} />
				</div>
			{/if}
		</div>

		<p class="mt-1.5 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
			{direction === 'out' ? 'Sent' : 'Received'}
		</p>
	</div>
{/snippet}

<svelte:element
	this={onclick ? 'button' : 'div'}
	{onclick}
	type={onclick ? 'button' : undefined}
	role={onclick ? 'button' : undefined}
	class={cn(
		'block w-full rounded-xl border border-border bg-surface p-4 text-left transition-colors md:p-5',
		onclick && 'cursor-pointer hover:border-border-strong hover:bg-surface-raised'
	)}
>
	<div class="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
		{@render leg(pair.out, 'out')}

		<!-- Center connector: column (↓) on mobile, row (→) on desktop -->
		<div class="flex shrink-0 flex-col items-center gap-1.5 md:flex-row md:gap-2">
			<span class="h-4 w-px bg-border md:h-px md:w-4"></span>
			{#if pair.kind === 'conversion' && rateLabel}
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1"
				>
					<span
						class={cn('size-1.5 rounded-full', confidenceDot[pair.confidence ?? 'auto'])}
						title={confidenceLabel[pair.confidence ?? 'auto']}
					></span>
					<span class="font-mono text-xs font-semibold text-text-primary tabular-nums">
						&times;{rateLabel}
					</span>
					<span class="text-[10px] font-medium text-text-tertiary">{foreignCurrency}/EUR</span>
				</div>
			{:else}
				<div
					class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-2.5 py-1 text-text-tertiary"
				>
					<ArrowLeftRight size={12} />
					<span class="text-[10px] font-semibold tracking-wider uppercase">Transfer</span>
				</div>
			{/if}
			<ArrowRight size={16} class="shrink-0 rotate-90 text-text-tertiary md:rotate-0" />
			<span class="h-4 w-px bg-border md:h-px md:w-4"></span>
		</div>

		{@render leg(pair.in, 'in')}
	</div>
</svelte:element>
