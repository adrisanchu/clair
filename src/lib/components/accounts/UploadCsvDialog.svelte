<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		CheckCircle2,
		AlertCircle,
		Upload,
		ArrowRight,
		ArrowLeftRight,
		Link,
		Columns3
	} from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import Amount from '$lib/components/Amount.svelte';
	import { PRIMARY_CURRENCY } from '$lib/currencies.js';

	interface Props {
		open: boolean;
		accountId: string;
		accountName: string;
		bankProfileId: string;
		currency: string;
		isFirstUpload: boolean;
	}

	let {
		open = $bindable(false),
		accountId,
		accountName,
		bankProfileId,
		currency,
		isFirstUpload
	}: Props = $props();

	type Step = 'upload' | 'preview' | 'columns' | 'importing' | 'done';
	let step = $state<Step>('upload');
	let loading = $state(false);
	let err = $state<string | null>(null);
	let file = $state<File | null>(null);
	let dragging = $state(false);
	let balanceInput = $state('');

	type ColumnMapping = { csvHeader: string; field: 'category' | 'city' | 'notes'; label: string };

	type PreviewData = {
		filename: string;
		totalParsed: number;
		skippedCount: number;
		preview: Array<{ date: string; description: string; amount: number; currency: string }>;
		openingBalance: number | null;
		closingBalance: number | null;
		columnMappings: ColumnMapping[];
		unusedColumns: string[];
		savedMappings: Array<{ field: string; csvHeader: string; enabled: boolean }>;
	};

	type DetectedConversion = {
		conversionId: string;
		fromAmount: number;
		toAmount: number;
		exchangeRate: number;
		effectiveFrom: string;
		affectedTxCount: number;
		confidence: 'auto';
		fromAccountName: string;
		fromTransactionDescription: string;
		toAccountName: string;
		toTransactionDescription: string;
	};

	type TransferCandidate = {
		id: string;
		accountingDate: string;
		amount: number;
		description: string;
		bankAccountId: string;
		accountName: string;
		daysDiff: number;
	};

	type TransferMatch = {
		sourceId: string;
		sourceDescription: string;
		sourceAmount: number;
		sourceDate: string;
		sourceAccountName: string;
		candidateId: string | null;
		candidates: TransferCandidate[];
	};

	type ImportResult = {
		imported: number;
		flagged: number;
		statusUpdates: number;
		duplicates: number;
		detectedConversions: DetectedConversion[];
		unresolvedTransfers: TransferMatch[];
		newCategories: Array<{ name: string; color: string }>;
	};

	let preview = $state<PreviewData | null>(null);
	let importResult = $state<ImportResult | null>(null);
	let columnConfirm = $state<Record<'category' | 'city' | 'notes', boolean>>({
		category: true,
		city: true,
		notes: true
	});
	// Per-match state: sourceId → 'linked' | 'skipped' | selectedCandidateId | null (pending)
	let transferDecisions = $state<Record<string, string | null>>({});
	let transferLinking = $state<Record<string, boolean>>({});

	function reset() {
		step = 'upload';
		loading = false;
		err = null;
		file = null;
		dragging = false;
		balanceInput = '';
		preview = null;
		importResult = null;
		transferDecisions = {};
		transferLinking = {};
		columnConfirm = { category: true, city: true, notes: true };
	}

	function handleOpenChange(v: boolean) {
		open = v;
		if (!v) {
			if (importResult) invalidateAll();
			reset();
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function handleDragLeave(e: DragEvent) {
		// Only clear dragging if we've left the drop zone entirely
		const target = e.currentTarget as HTMLElement;
		if (!target.contains(e.relatedTarget as Node)) {
			dragging = false;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const dropped = e.dataTransfer?.files[0];
		if (dropped) {
			file = dropped;
			submitPreview();
		}
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		const selected = input.files?.[0];
		if (selected) {
			file = selected;
			submitPreview();
		}
	}

	async function submitPreview() {
		if (!file) return;
		loading = true;
		err = null;
		const formData = new FormData();
		formData.append('file', file);
		try {
			const res = await fetch(`/api/accounts/${accountId}/preview`, {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Failed to parse CSV');
			preview = data;
			if (data.openingBalance !== null) {
				balanceInput = data.openingBalance.toFixed(2);
			}
			// Pre-apply saved workspace mappings to confirm toggles
			columnConfirm = { category: true, city: true, notes: true };
			for (const saved of data.savedMappings ?? []) {
				const field = saved.field as 'category' | 'city' | 'notes';
				if (field in columnConfirm) columnConfirm[field] = saved.enabled;
			}
			step = 'preview';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not parse the file';
		} finally {
			loading = false;
		}
	}

	async function submitImport() {
		if (!file) return;
		step = 'importing';
		err = null;
		const formData = new FormData();
		formData.append('file', file);
		if (balanceInput.trim()) {
			formData.append('openingBalance', balanceInput.replace(',', '.'));
		}
		// Send user-confirmed column overrides if there were any detected mappings
		if (preview && preview.columnMappings.length > 0) {
			const overrides = {
				categoryColumn: columnConfirm.category
					? (preview.columnMappings.find((m) => m.field === 'category')?.csvHeader ?? null)
					: null,
				cityColumn: columnConfirm.city
					? (preview.columnMappings.find((m) => m.field === 'city')?.csvHeader ?? null)
					: null,
				notesColumn: columnConfirm.notes
					? (preview.columnMappings.find((m) => m.field === 'notes')?.csvHeader ?? null)
					: null
			};
			formData.append('columnMappings', JSON.stringify(overrides));
		}
		try {
			const res = await fetch(`/api/accounts/${accountId}/import`, {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Import failed');
			importResult = data;
			step = 'done';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Import failed';
			step = 'preview';
		}
	}

	async function linkTransfer(sourceId: string, candidateId: string) {
		transferLinking[sourceId] = true;
		try {
			const res = await fetch(`/api/transactions/${sourceId}/link-transfer`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ counterpartId: candidateId })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message ?? 'Could not link transfer');
			}
			transferDecisions[sourceId] = 'linked';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not link transfer';
		} finally {
			transferLinking[sourceId] = false;
		}
	}

	const hasColumnsStep = $derived(
		!!preview && (preview.columnMappings.length > 0 || preview.unusedColumns.length > 0)
	);
	const steps = $derived(
		hasColumnsStep ? ['Upload', 'Preview', 'Columns', 'Done'] : ['Upload', 'Preview', 'Done']
	);
	const stepIndex = $derived(
		step === 'upload' ? 0 : step === 'preview' ? 1 : step === 'columns' ? 2 : steps.length - 1
	);
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="flex flex-col overflow-hidden">
		<!-- Fixed: header + progress bar never scroll -->
		<Dialog.Header>
			<Dialog.Title>Import Transactions</Dialog.Title>
		</Dialog.Header>

		<div class="mb-4 flex shrink-0 gap-1.5">
			{#each steps as _, i}
				<div
					class="h-1 flex-1 rounded-full transition-colors duration-300 {i <= stepIndex
						? 'bg-primary-500'
						: 'bg-border'}"
				></div>
			{/each}
		</div>

		<!-- Scrollable content: grows to fill remaining space, scrolls if needed -->
		<div class="min-h-0 flex-1 overflow-y-auto">
			<!-- ── Step: Upload ── -->
			{#if step === 'upload'}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="flex cursor-default flex-col items-center gap-3 rounded-xl border-2 border-dashed p-12
				       text-center transition-colors duration-150
				       {dragging ? 'border-primary-500 bg-primary-50' : 'border-border hover:border-border-strong'}"
					ondragover={handleDragOver}
					ondragleave={handleDragLeave}
					ondrop={handleDrop}
				>
					<div
						class="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-text-tertiary"
					>
						<Upload size={20} />
					</div>
					<div>
						<p class="text-sm font-medium text-text-primary">Drop your CSV file here</p>
						<p class="mt-0.5 text-xs text-text-secondary">Supported format: {bankProfileId}</p>
					</div>
					<label class="cursor-pointer">
						<input type="file" accept=".csv,text/csv" class="sr-only" onchange={handleFileInput} />
						<span
							class="text-xs font-medium text-primary-500 underline underline-offset-2 hover:text-primary-600"
						>
							or click to browse
						</span>
					</label>
				</div>

				{#if loading}
					<p class="mt-4 animate-pulse text-center text-sm text-text-secondary">Parsing file…</p>
				{/if}

				<!-- ── Step: Preview ── -->
			{:else if step === 'preview' && preview}
				<!-- Status banner -->
				<div class="mb-5 flex items-center gap-3">
					<div
						class="bg-success-100 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
					>
						<CheckCircle2 size={18} class="text-success-600" />
					</div>
					<div class="min-w-0">
						<p class="text-sm font-semibold text-text-primary">Ready to import</p>
						<p class="truncate text-xs text-text-secondary">
							We've processed '{preview.filename}'
						</p>
					</div>
				</div>

				<!-- Stats grid -->
				<div class="mb-5 grid grid-cols-3 gap-3">
					<div class="rounded-lg border border-border p-3">
						<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">New</p>
						<p class="mt-1 font-mono text-2xl font-bold text-text-primary tabular-nums">
							{preview.totalParsed}
						</p>
					</div>
					<div class="rounded-lg border border-border p-3">
						<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							Skipped
						</p>
						<p class="mt-1 font-mono text-2xl font-bold text-text-primary tabular-nums">
							{preview.skippedCount}
						</p>
					</div>
					<div class="rounded-lg border border-border-strong bg-surface-sunken p-3">
						<p class="text-[10px] font-semibold tracking-wider text-primary-500 uppercase">
							Account
						</p>
						<p class="mt-1 truncate text-sm font-semibold text-text-primary">{accountName}</p>
					</div>
				</div>

				<!-- Transaction preview table -->
				<div class="mb-5 overflow-hidden rounded-lg border border-border">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-border bg-surface-sunken">
								<th
									class="px-3 py-2 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
								>
									Date
								</th>
								<th
									class="px-3 py-2 text-left text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
								>
									Description
								</th>
								<th
									class="px-3 py-2 text-right text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
								>
									Amount
								</th>
							</tr>
						</thead>
						<tbody>
							{#each preview.preview as row}
								<tr class="border-b border-border last:border-0">
									<td class="px-3 py-2 text-xs whitespace-nowrap text-text-secondary">{row.date}</td
									>
									<td class="max-w-45 px-3 py-2 text-text-primary">
										<span class="block truncate text-xs">{row.description}</span>
									</td>
									<td class="px-3 py-2 text-right">
										<Amount value={row.amount} currency={row.currency} size="sm" />
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
					{#if preview.totalParsed > 5}
						<div
							class="border-t border-border bg-surface-sunken px-3 py-1.5 text-center text-[10px] tracking-wider text-text-tertiary uppercase"
						>
							Showing 5 of {preview.totalParsed} rows
						</div>
					{/if}
				</div>

				<!-- Balance input (shown on first upload or always for reconciliation) -->
				{#if isFirstUpload}
					<div class="mb-2">
						<p class="mb-2 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							Opening balance
						</p>
						<div class="flex items-baseline gap-2 border-b-2 border-border pb-1.5">
							<span class="text-2xl text-text-tertiary">{currency === PRIMARY_CURRENCY ? '€' : currency}</span>
							<input
								type="text"
								inputmode="decimal"
								placeholder="0.00"
								bind:value={balanceInput}
								class="flex-1 bg-transparent font-mono text-2xl font-bold text-text-primary outline-none placeholder:text-text-tertiary/40"
							/>
						</div>
						<p class="mt-1.5 text-xs text-text-tertiary">
							Balance before the first transaction in this file. Used to reconcile your ledger.
						</p>
					</div>
				{/if}

				<!-- ── Step: Columns ── -->
			{:else if step === 'columns' && preview}
				{#if preview.columnMappings.length > 0}
					<div class="mb-4">
						<p class="mb-3 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							Optional columns detected
						</p>
						<div class="space-y-2">
							{#each preview.columnMappings as mapping (mapping.field)}
								<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
								<label
									class="flex cursor-pointer items-center justify-between rounded-lg border border-border p-3 transition-colors hover:border-border-strong {columnConfirm[
										mapping.field
									]
										? 'bg-surface'
										: 'bg-surface-sunken opacity-60'}"
								>
									<div class="flex items-center gap-3">
										<Columns3 size={15} class="shrink-0 text-text-tertiary" />
										<div>
											<p class="text-sm font-medium text-text-primary">{mapping.csvHeader}</p>
											<p class="text-xs text-text-secondary">→ {mapping.label}</p>
										</div>
									</div>
									<input
										type="checkbox"
										bind:checked={columnConfirm[mapping.field]}
										class="h-4 w-4 accent-primary-500"
									/>
								</label>
							{/each}
						</div>
					</div>
				{/if}

				{#if preview.unusedColumns.length > 0}
					<div class="rounded-lg border border-border bg-surface-sunken p-3">
						<p class="mb-2 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
							{preview.unusedColumns.length}
							{preview.unusedColumns.length === 1 ? 'column' : 'columns'} won't be imported
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each preview.unusedColumns as col}
								<span
									class="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-text-secondary"
								>
									{col}
								</span>
							{/each}
						</div>
					</div>
				{/if}

				<!-- ── Step: Importing ── -->
			{:else if step === 'importing'}
				<div class="flex flex-col items-center gap-3 py-12">
					<div
						class="h-12 w-12 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"
					></div>
					<p class="text-sm text-text-secondary">Importing transactions…</p>
				</div>

				<!-- ── Step: Done ── -->
			{:else if step === 'done' && importResult}
				<div class="flex flex-col items-center gap-2 text-center">
					<div class="bg-success-100 flex h-10 w-10 items-center justify-center rounded-full">
						<CheckCircle2 size={24} class="text-success-600" />
					</div>
					<div>
						<h3 class="text-base font-semibold text-text-primary">Import complete</h3>
						<p class="text-sm text-text-secondary">Your transactions have been saved.</p>
					</div>
					<div class="grid w-full max-w-xs grid-cols-2 gap-2">
						<div class="rounded-lg border border-border px-3 py-2 text-center">
							<p class="font-mono text-xl font-bold text-text-primary">{importResult.imported}</p>
							<p class="text-xs text-text-secondary">Imported</p>
						</div>
						<div class="rounded-lg border border-border px-3 py-2 text-center">
							<p class="font-mono text-xl font-bold text-text-primary">{importResult.duplicates}</p>
							<p class="text-xs text-text-secondary">Duplicates</p>
						</div>
						{#if importResult.statusUpdates > 0}
							<div class="rounded-lg border border-border px-3 py-2 text-center">
								<p class="font-mono text-xl font-bold text-text-primary">
									{importResult.statusUpdates}
								</p>
								<p class="text-xs text-text-secondary">Status updates</p>
							</div>
						{/if}
						{#if importResult.flagged > 0}
							<div class="border-warning-200 bg-warning-50 rounded-lg border px-3 py-2 text-center">
								<p class="text-warning-700 font-mono text-xl font-bold">{importResult.flagged}</p>
								<p class="text-warning-600 text-xs">Need review</p>
							</div>
						{/if}
					</div>

					<div class="max-h-[45vh] w-full overflow-y-auto">
						<!-- New categories detected -->
						{#if importResult.newCategories?.length > 0}
							<div class="mb-3 w-full rounded-lg border border-border p-3 text-left">
								<p
									class="mb-2 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
								>
									{importResult.newCategories.length}
									{importResult.newCategories.length === 1 ? 'new category' : 'new categories'} added
								</p>
								<div class="flex flex-wrap gap-1.5">
									{#each importResult.newCategories as cat}
										<span
											class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-white"
											style="background-color: {cat.color}"
										>
											{cat.name}
										</span>
									{/each}
								</div>
							</div>
						{/if}

						<!-- Conversion confirmation cards -->
						{#if importResult.detectedConversions?.length > 0}
							<div class="mt-2 w-full space-y-2">
								{#each importResult.detectedConversions as conv (conv.conversionId)}
									<div class="rounded-lg border border-primary-200 bg-primary-50 p-4 text-left">
										<div class="mb-3 flex items-center gap-2">
											<ArrowLeftRight size={14} class="text-primary-500" />
											<span class="text-xs font-semibold text-primary-700">Conversion detected</span
											>
										</div>
										<!-- From row -->
										<div class="flex items-center justify-between gap-2">
											<div class="min-w-0">
												<p
													class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
												>
													{conv.fromAccountName}
												</p>
												<p class="truncate text-xs text-text-secondary">
													{conv.fromTransactionDescription}
												</p>
											</div>
											<Amount value={-conv.fromAmount} currency={PRIMARY_CURRENCY} size="sm" />
										</div>
										<!-- Arrow -->
										<div class="my-1.5 flex items-center gap-1.5 text-text-tertiary">
											<div class="h-px flex-1 bg-primary-200"></div>
											<ArrowRight size={12} class="text-primary-400" />
											<div class="h-px flex-1 bg-primary-200"></div>
										</div>
										<!-- To row -->
										<div class="flex items-center justify-between gap-2">
											<div class="min-w-0">
												<p
													class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
												>
													{conv.toAccountName}
												</p>
												<p class="truncate text-xs text-text-secondary">
													{conv.toTransactionDescription}
												</p>
											</div>
											<Amount value={conv.toAmount} {currency} size="sm" />
										</div>
										<!-- Rate footer -->
										<div
											class="mt-3 flex items-center justify-between border-t border-primary-200 pt-2.5 text-xs text-text-secondary"
										>
											<span>
												Rate: <span class="font-mono font-semibold text-text-primary">
													{conv.exchangeRate.toFixed(4)}
													{currency} / EUR
												</span>
											</span>
											<span class="text-text-tertiary"
												>Applies to {conv.affectedTxCount} transactions</span
											>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						<!-- Transfer linking section -->
						{#if importResult.unresolvedTransfers?.length > 0}
							<div class="mt-4 w-full space-y-2">
								{#each importResult.unresolvedTransfers as match (match.sourceId)}
									{@const decision = transferDecisions[match.sourceId] ?? null}
									{@const isLinking = transferLinking[match.sourceId] ?? false}

									{#if match.candidateId !== null}
										<!-- Auto-linked -->
										<div
											class="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2.5"
										>
											<Link size={13} class="shrink-0 text-success-600" />
											<div class="min-w-0 flex-1">
												<p class="text-xs font-medium text-text-primary">
													Transfer linked automatically
												</p>
												<p class="truncate text-[11px] text-text-secondary">
													{match.sourceAccountName} · {match.sourceDescription}
													<span class="text-text-tertiary">→</span>
													{match.candidates[0]?.accountName} · {match.candidates[0]?.description}
												</p>
											</div>
										</div>
									{:else if decision === 'linked'}
										<!-- Just linked by user -->
										<div
											class="border-success-200 flex items-center gap-2 rounded-lg border bg-success-50 px-3 py-2.5"
										>
											<CheckCircle2 size={13} class="shrink-0 text-success-600" />
											<p class="text-xs font-medium text-success-700">Transfer linked</p>
										</div>
									{:else if decision === 'skipped'}
										<!-- Dismissed -->
										<div
											class="flex items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2.5 opacity-50"
										>
											<p class="text-xs text-text-tertiary">
												Skipped — link manually from the transactions page
											</p>
										</div>
									{:else if match.candidates.length === 0}
										<!-- No counterpart found -->
										<div class="rounded-lg border border-border bg-surface-sunken p-3 text-left">
											<div class="flex items-center justify-between gap-2">
												<p class="truncate text-xs font-medium text-text-primary">
													{match.sourceAccountName} · {match.sourceDescription}
												</p>
												<Amount value={match.sourceAmount} currency={PRIMARY_CURRENCY} size="sm" />
											</div>
											<div class="mt-1.5 flex items-center justify-between gap-2">
												<p class="text-[11px] text-text-tertiary">No matching transfer found</p>
												<button
													class="text-[11px] text-text-tertiary underline underline-offset-2 hover:text-text-secondary"
													onclick={() => (transferDecisions[match.sourceId] = 'skipped')}
													>Skip</button
												>
											</div>
										</div>
									{:else}
										<!-- Multiple candidates — needs user choice -->
										<div class="rounded-lg border border-border p-3 text-left">
											<div class="mb-2 flex items-center gap-2">
												<ArrowLeftRight size={13} class="text-text-tertiary" />
												<div class="min-w-0">
													<p class="text-xs font-semibold text-text-primary">
														{match.sourceAccountName}
													</p>
													<p class="truncate text-[11px] text-text-secondary">
														{match.sourceDescription}
													</p>
												</div>
												<Amount value={match.sourceAmount} currency={PRIMARY_CURRENCY} size="sm" />
											</div>
											<p
												class="mb-1.5 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
											>
												Match with
											</p>
											<div class="space-y-1">
												{#each match.candidates as candidate (candidate.id)}
													<button
														class="flex w-full items-center justify-between gap-2 rounded-md border border-border px-2.5 py-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50 disabled:opacity-50"
														disabled={isLinking}
														onclick={() => linkTransfer(match.sourceId, candidate.id)}
													>
														<div class="min-w-0">
															<p
																class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase"
															>
																{candidate.accountName}
															</p>
															<p class="truncate text-xs text-text-primary">
																{candidate.description}
															</p>
															{#if candidate.daysDiff > 0}
																<p class="text-[10px] text-text-tertiary">
																	{candidate.daysDiff}d apart
																</p>
															{/if}
														</div>
														<Amount value={candidate.amount} currency={PRIMARY_CURRENCY} size="sm" />
													</button>
												{/each}
											</div>
											<button
												class="mt-2 text-[11px] text-text-tertiary underline underline-offset-2 hover:text-text-secondary"
												onclick={() => (transferDecisions[match.sourceId] = 'skipped')}
											>
												Skip for now
											</button>
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error banner -->
			{#if err}
				<div
					class="border-danger-200 mt-3 flex items-center gap-2 rounded-lg border bg-danger-50 px-3 py-2.5 text-sm text-danger-600"
				>
					<AlertCircle size={14} class="shrink-0" />
					{err}
				</div>
			{/if}
		</div>

		<Dialog.Footer class="mt-4 shrink-0 pt-2">
			{#if step === 'upload'}
				<div></div>
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{:else if step === 'preview'}
				<Button
					variant="outline"
					onclick={() => {
						step = 'upload';
						file = null;
						preview = null;
						err = null;
					}}
				>
					Back
				</Button>
				{#if hasColumnsStep}
					<Button onclick={() => (step = 'columns')} disabled={loading}>
						Review columns
						<ArrowRight size={14} />
					</Button>
				{:else}
					<Button onclick={submitImport} disabled={loading}>
						Import {preview?.totalParsed ?? ''} transactions
						<ArrowRight size={14} />
					</Button>
				{/if}
			{:else if step === 'columns'}
				<Button variant="outline" onclick={() => (step = 'preview')}>Back</Button>
				<Button onclick={submitImport}>
					Import {preview?.totalParsed ?? ''} transactions
					<ArrowRight size={14} />
				</Button>
			{:else if step === 'importing'}
				<div></div>
				<Button variant="outline" disabled>Importing…</Button>
			{:else if step === 'done'}
				<div></div>
				<Button onclick={() => (open = false)}>Done</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
