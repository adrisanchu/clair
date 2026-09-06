<script lang="ts">
	import {
		CheckCircle2,
		AlertCircle,
		Upload,
		ArrowRight,
		ArrowLeftRight,
		Link,
		Columns3,
		Landmark,
		Plus
	} from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Amount from '$lib/components/Amount.svelte';
	import CategoryMappingSheet from '$lib/components/upload/CategoryMappingSheet.svelte';
	import { PRIMARY_CURRENCY, CURRENCIES } from '$lib/currencies.js';
	import type { CategoryRow } from '$lib/types';

	export type AccountOption = {
		id: string;
		displayName: string;
		bankProfileId: string;
		currency: string;
		txCount: number;
	};

	interface Profile {
		id: string;
		displayName: string;
	}

	interface Props {
		/** Preselected account. When set, the account-picker step is skipped. */
		accountId?: string;
		/** Accounts the user can upload into. Required for the picker (generic entry). */
		accounts?: AccountOption[];
		/** Bank profiles for inline account creation. */
		profiles?: Profile[];
		/** Fired once an import has completed (parent can refresh data). */
		onImported?: () => void;
		/** Fired when the user cancels or finishes (parent closes dialog / navigates). */
		onClose?: () => void;
	}

	let { accountId, accounts = [], profiles = [], onImported, onClose }: Props = $props();

	/** Close the wizard and open the transactions list filtered to this upload's rows. */
	function viewUpload(outcome: 'inserted' | 'updated' | 'duplicate') {
		if (!importResult) return;
		const url = `/transactions?upload=${importResult.uploadId}&outcome=${outcome}`;
		onClose?.();
		goto(url);
	}

	// Picker mode = no account was preselected → user must pick/create one first.
	const pickerMode = !accountId;

	type Step = 'account' | 'upload' | 'preview' | 'columns' | 'categories' | 'importing' | 'done';
	let step = $state<Step>(pickerMode ? 'account' : 'upload');
	let loading = $state(false);
	let err = $state<string | null>(null);
	let file = $state<File | null>(null);
	let dragging = $state(false);
	let balanceInput = $state('');

	// The account currently driving preview/import. Set from the prop or the picker.
	let currentAccountId = $state(accountId ?? '');
	const currentAccount = $derived(accounts.find((a) => a.id === currentAccountId));
	const accountName = $derived(currentAccount?.displayName ?? '');
	const bankProfileId = $derived(currentAccount?.bankProfileId ?? '');
	const currency = $derived(currentAccount?.currency ?? PRIMARY_CURRENCY);
	const isFirstUpload = $derived(currentAccount ? currentAccount.txCount === 0 : false);

	// ── Inline "new account" form (picker step) ────────────────────────────────
	let showNewAccountForm = $state(false);
	let newName = $state('');
	let newProfileId = $state(profiles[0]?.id ?? '');
	let newIbanLast4 = $state('');
	let newCurrency = $state(PRIMARY_CURRENCY);
	let creatingAccount = $state(false);

	type ColumnMapping = { csvHeader: string; field: 'category' | 'city' | 'notes'; label: string };

	type CategoryMappingEntry = {
		csvCategory: string;
		suggestedMatch: string | null;
		confidence: number;
	};

	type PreviewData = {
		filename: string;
		totalParsed: number;
		skippedCount: number;
		newCount: number;
		duplicateCount: number;
		updateCount: number;
		reviewCount: number;
		preview: Array<{ date: string; description: string; amount: number; currency: string }>;
		openingBalance: number | null;
		closingBalance: number | null;
		columnMappings: ColumnMapping[];
		unusedColumns: string[];
		savedMappings: Array<{ field: string; csvHeader: string; enabled: boolean }>;
		categoryMappings: CategoryMappingEntry[] | null;
		workspaceCategories: CategoryRow[];
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
		uploadId: string;
		imported: number;
		flagged: number;
		statusUpdates: number;
		enrichmentUpdates: number;
		duplicates: number;
		detectedConversions: DetectedConversion[];
		unresolvedTransfers: TransferMatch[];
		newCategories: Array<{ name: string; color: string }>;
		aiTagged: number;
	};

	let preview = $state<PreviewData | null>(null);
	let importResult = $state<ImportResult | null>(null);
	let columnConfirm = $state<Record<'category' | 'city' | 'notes', boolean>>({
		category: true,
		city: true,
		notes: true
	});
	let categoryDecisions = $state<Record<string, string | null>>({});
	// Per-match state: sourceId → 'linked' | 'skipped' | selectedCandidateId | null (pending)
	let transferDecisions = $state<Record<string, string | null>>({});
	let transferLinking = $state<Record<string, boolean>>({});
	// Per-conversion state: conversionId → 'rejected' | null (pending); + in-flight flag.
	let conversionDecisions = $state<Record<string, 'rejected' | null>>({});
	let conversionRejecting = $state<Record<string, boolean>>({});

	function selectAccount(id: string) {
		currentAccountId = id;
		showNewAccountForm = false;
		err = null;
		step = 'upload';
	}

	// Restore the wizard to its initial state so it can be reused without a remount
	// (page flow) or a dialog close/reopen (dialog flow).
	function reset() {
		step = pickerMode ? 'account' : 'upload';
		loading = false;
		err = null;
		file = null;
		dragging = false;
		balanceInput = '';
		currentAccountId = accountId ?? '';
		showNewAccountForm = false;
		newName = '';
		newProfileId = profiles[0]?.id ?? '';
		newIbanLast4 = '';
		newCurrency = PRIMARY_CURRENCY;
		preview = null;
		importResult = null;
		columnConfirm = { category: true, city: true, notes: true };
		categoryDecisions = {};
		transferDecisions = {};
		transferLinking = {};
		conversionDecisions = {};
		conversionRejecting = {};
	}

	async function createAccount(e: Event) {
		e.preventDefault();
		err = null;
		if (!newName.trim()) {
			err = 'Account name is required';
			return;
		}
		if (!/^\d{4}$/.test(newIbanLast4.trim())) {
			err = 'IBAN last 4 must be exactly 4 digits';
			return;
		}
		creatingAccount = true;
		try {
			const res = await fetch('/api/accounts', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName: newName.trim(),
					bankProfileId: newProfileId,
					ibanLast4: newIbanLast4.trim(),
					currency: newCurrency
				})
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Could not create account');
			// Make the new account available to the derived lookups, then advance.
			accounts = [
				...accounts,
				{
					id: data.id,
					displayName: data.displayName,
					bankProfileId: data.bankProfileId,
					currency: data.currency,
					txCount: 0
				}
			];
			onImported?.(); // let the parent refresh its own account list
			selectAccount(data.id);
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not create account';
		} finally {
			creatingAccount = false;
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
		if (!file || !currentAccountId) return;
		loading = true;
		err = null;
		const formData = new FormData();
		formData.append('file', file);
		try {
			const res = await fetch(`/api/accounts/${currentAccountId}/preview`, {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Failed to parse CSV');
			preview = data;
			if (data.openingBalance !== null) {
				balanceInput = data.openingBalance.toFixed(2);
			}
			// Pre-populate category mapping decisions from AI suggestions
			if (data.categoryMappings) {
				categoryDecisions = Object.fromEntries(
					data.categoryMappings.map((m: CategoryMappingEntry) => [m.csvCategory, m.suggestedMatch])
				);
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
		if (!file || !currentAccountId) return;
		step = 'importing';
		err = null;
		const formData = new FormData();
		formData.append('file', file);
		if (balanceInput.trim()) {
			formData.append('openingBalance', balanceInput.replace(',', '.'));
		}
		// Send confirmed category mappings if any decisions were made
		if (Object.keys(categoryDecisions).length > 0) {
			const confirmedMappings = Object.entries(categoryDecisions).map(([csvCategory, mappedTo]) => ({
				csvCategory,
				mappedTo
			}));
			formData.append('categoryMappings', JSON.stringify(confirmedMappings));
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
			const res = await fetch(`/api/accounts/${currentAccountId}/import`, {
				method: 'POST',
				body: formData
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.message ?? 'Import failed');
			importResult = data;
			step = 'done';
			onImported?.();
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

	// Reject an auto-detected conversion: break the pair AND opt its legs out of future
	// auto-detection (server-side), so re-imports don't recreate it. The user links it
	// manually later on the Transfers page if it really is a conversion.
	async function rejectConversion(conversionId: string) {
		conversionRejecting[conversionId] = true;
		try {
			const res = await fetch(`/api/conversions/${conversionId}`, { method: 'DELETE' });
			if (!res.ok) {
				const data = await res.json().catch(() => ({}));
				throw new Error(data.message ?? 'Could not reject conversion');
			}
			conversionDecisions[conversionId] = 'rejected';
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not reject conversion';
		} finally {
			conversionRejecting[conversionId] = false;
		}
	}

	const hasColumnsStep = $derived(
		!!preview && (preview.columnMappings.length > 0 || preview.unusedColumns.length > 0)
	);
	// Show the categories step when there are non-exact category mappings to review
	const hasCategoriesStep = $derived(
		!!preview &&
			!!preview.categoryMappings &&
			preview.categoryMappings.length > 0 &&
			preview.categoryMappings.some((m) => m.confidence < 1.0)
	);

	// Ordered list of visible step keys (drives the progress bar + index).
	const stepKeys = $derived.by(() => {
		const keys: Exclude<Step, 'importing'>[] = [];
		if (pickerMode) keys.push('account');
		keys.push('upload', 'preview');
		if (hasColumnsStep) keys.push('columns');
		if (hasCategoriesStep) keys.push('categories');
		keys.push('done');
		return keys;
	});
	const stepLabels: Record<Exclude<Step, 'importing'>, string> = {
		account: 'Account',
		upload: 'Upload',
		preview: 'Preview',
		columns: 'Columns',
		categories: 'Categories',
		done: 'Done'
	};
	const stepIndex = $derived(
		step === 'importing' ? stepKeys.length - 1 : Math.max(0, stepKeys.indexOf(step))
	);

	// ── Preview headline / labels driven by the dedup projection ────────────────
	const hasChanges = $derived(
		!!preview && (preview.newCount > 0 || preview.updateCount > 0 || preview.reviewCount > 0)
	);

	const previewHeadline = $derived(
		!preview || preview.newCount > 0
			? 'Ready to import'
			: preview.updateCount > 0 || preview.reviewCount > 0
				? 'Ready to update'
				: 'Nothing new to import'
	);

	const importActionLabel = $derived.by(() => {
		if (!preview) return 'Import';
		if (preview.newCount > 0)
			return `Import ${preview.newCount} ${preview.newCount === 1 ? 'transaction' : 'transactions'}`;
		if (preview.updateCount > 0 || preview.reviewCount > 0) return 'Apply updates';
		return 'Import anyway';
	});

	// Secondary detail line: updates / review / unreadable rows (shown only when non-zero)
	const previewDetail = $derived.by(() => {
		if (!preview) return '';
		const parts: string[] = [];
		if (preview.updateCount > 0) parts.push(`${preview.updateCount} updated`);
		if (preview.reviewCount > 0) parts.push(`${preview.reviewCount} need review`);
		if (preview.skippedCount > 0)
			parts.push(`${preview.skippedCount} unreadable ${preview.skippedCount === 1 ? 'row' : 'rows'}`);
		return parts.join(' · ');
	});
</script>

<!-- Progress bar -->
<div class="mb-4 flex shrink-0 gap-1.5">
	{#each stepKeys as key (key)}
		<div
			class="h-1 flex-1 rounded-full transition-colors duration-300 {stepKeys.indexOf(key) <=
			stepIndex
				? 'bg-primary-500'
				: 'bg-border'}"
			title={stepLabels[key]}
		></div>
	{/each}
</div>

<!-- Scrollable content -->
<div class="min-h-0 flex-1 overflow-y-auto">
	<!-- ── Step: Account (picker mode only) ── -->
	{#if step === 'account'}
		{#if !showNewAccountForm}
			<p class="mb-3 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
				Choose an account
			</p>
			<div class="space-y-2">
				{#each accounts as acc (acc.id)}
					<button
						class="flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50"
						onclick={() => selectAccount(acc.id)}
					>
						<div
							class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-text-tertiary"
						>
							<Landmark size={16} />
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-text-primary">{acc.displayName}</p>
							<p class="text-xs text-text-secondary">{acc.bankProfileId} · {acc.currency}</p>
						</div>
						<ArrowRight size={14} class="shrink-0 text-text-tertiary" />
					</button>
				{/each}

				{#if accounts.length === 0}
					<p class="rounded-lg border border-dashed border-border p-4 text-center text-xs text-text-tertiary">
						No accounts yet — create one to start uploading.
					</p>
				{/if}
			</div>

			{#if profiles.length > 0}
				<button
					class="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
					onclick={() => {
						showNewAccountForm = true;
						err = null;
					}}
				>
					<Plus size={15} />
					New account
				</button>
			{/if}
		{:else}
			<!-- Inline new-account form -->
			<form onsubmit={createAccount} class="flex flex-col gap-4">
				<div class="grid gap-1.5">
					<Label for="wiz-name">Account name</Label>
					<Input
						id="wiz-name"
						bind:value={newName}
						placeholder="e.g. Revolut, BBVA Main"
						disabled={creatingAccount}
					/>
				</div>
				<div class="grid gap-1.5">
					<Label for="wiz-bank">Bank</Label>
					<select
						id="wiz-bank"
						bind:value={newProfileId}
						disabled={creatingAccount}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#each profiles as p (p.id)}
							<option value={p.id}>{p.displayName}</option>
						{/each}
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="wiz-currency">Primary currency</Label>
					<select
						id="wiz-currency"
						bind:value={newCurrency}
						disabled={creatingAccount}
						class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					>
						{#each CURRENCIES as c (c.code)}
							<option value={c.code}>{c.label}</option>
						{/each}
					</select>
				</div>
				<div class="grid gap-1.5">
					<Label for="wiz-iban">Last 4 digits of IBAN / card</Label>
					<Input
						id="wiz-iban"
						bind:value={newIbanLast4}
						placeholder="1234"
						maxlength={4}
						inputmode="numeric"
						disabled={creatingAccount}
						class="max-w-28 font-mono tracking-widest"
					/>
				</div>
			</form>
		{/if}

		<!-- ── Step: Upload ── -->
	{:else if step === 'upload'}
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
				class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {hasChanges
					? 'bg-success-100'
					: 'bg-surface-sunken'}"
			>
				<CheckCircle2 size={18} class={hasChanges ? 'text-success-600' : 'text-text-tertiary'} />
			</div>
			<div class="min-w-0">
				<p class="text-sm font-semibold text-text-primary">{previewHeadline}</p>
				<p class="truncate text-xs text-text-secondary">
					We've processed '{preview.filename}'
				</p>
			</div>
		</div>

		<!-- Stats grid — projected dedup outcome (matches the import result) -->
		<div class="mb-2 grid grid-cols-3 gap-3">
			<div class="rounded-lg border border-border p-3">
				<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">New</p>
				<p class="mt-1 font-mono text-2xl font-bold text-text-primary tabular-nums">
					{preview.newCount}
				</p>
			</div>
			<div class="rounded-lg border border-border p-3">
				<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
					Duplicates
				</p>
				<p class="mt-1 font-mono text-2xl font-bold text-text-primary tabular-nums">
					{preview.duplicateCount}
				</p>
			</div>
			<div class="rounded-lg border border-border-strong bg-surface-sunken p-3">
				<p class="text-[10px] font-semibold tracking-wider text-primary-500 uppercase">Account</p>
				<p class="mt-1 truncate text-sm font-semibold text-text-primary">{accountName}</p>
			</div>
		</div>

		<!-- Secondary detail: updates / review / unreadable rows -->
		<p class="mb-5 h-4 text-xs text-text-tertiary">{previewDetail}</p>

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
							<td class="px-3 py-2 text-xs whitespace-nowrap text-text-secondary">{row.date}</td>
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

		<!-- Balance input (shown on first upload for reconciliation) -->
		{#if isFirstUpload}
			<div class="mb-2">
				<p class="mb-2 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
					Opening balance
				</p>
				<div class="flex items-baseline gap-2 border-b-2 border-border pb-1.5">
					<span class="text-2xl text-text-tertiary"
						>{currency === PRIMARY_CURRENCY ? '€' : currency}</span
					>
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

		<!-- ── Step: Categories ── -->
	{:else if step === 'categories' && preview?.categoryMappings}
		<CategoryMappingSheet
			mappings={preview.categoryMappings}
			workspaceCategories={preview.workspaceCategories}
			bind:decisions={categoryDecisions}
		/>

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
				{#snippet tile(count: number, label: string, outcome: 'inserted' | 'updated' | 'duplicate')}
					{#if count > 0}
						<button
							type="button"
							onclick={() => viewUpload(outcome)}
							class="group rounded-lg border border-border px-3 py-2 text-center transition-colors hover:border-primary-300 hover:bg-primary-50"
							title="View these transactions"
						>
							<p class="font-mono text-xl font-bold text-text-primary">{count}</p>
							<p class="text-xs text-text-secondary group-hover:text-primary-700">{label} →</p>
						</button>
					{:else}
						<div class="rounded-lg border border-border px-3 py-2 text-center">
							<p class="font-mono text-xl font-bold text-text-primary">{count}</p>
							<p class="text-xs text-text-secondary">{label}</p>
						</div>
					{/if}
				{/snippet}

				{@render tile(importResult.imported, 'Imported', 'inserted')}
				{@render tile(importResult.duplicates, 'Duplicates', 'duplicate')}
				{#if importResult.statusUpdates > 0}
					{@render tile(importResult.statusUpdates, 'Updated', 'updated')}
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
						<p class="mb-2 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
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

				<!-- AI auto-tagging summary -->
				{#if importResult.aiTagged > 0}
					<div class="mb-3 w-full rounded-lg border border-primary-200 bg-primary-50 p-3 text-left">
						<p class="text-xs font-medium text-primary-700">
							AI auto-tagged {importResult.aiTagged}
							{importResult.aiTagged === 1 ? 'transaction' : 'transactions'}
						</p>
					</div>
				{/if}

				<!-- Conversion confirmation cards -->
				{#if importResult.detectedConversions?.length > 0}
					<div class="mt-2 w-full space-y-2">
						{#each importResult.detectedConversions as conv (conv.conversionId)}
							{@const isRejected = conversionDecisions[conv.conversionId] === 'rejected'}
							{@const isRejecting = conversionRejecting[conv.conversionId] ?? false}
							<div
								class="rounded-lg border p-4 text-left transition-opacity"
								class:border-primary-200={!isRejected}
								class:bg-primary-50={!isRejected}
								class:border-border={isRejected}
								class:bg-surface-sunken={isRejected}
								class:opacity-60={isRejected}
							>
								<div class="mb-3 flex items-center justify-between gap-2">
									<div class="flex items-center gap-2">
										<ArrowLeftRight size={14} class="text-primary-500" />
										<span class="text-xs font-semibold text-primary-700">
											{isRejected ? 'Conversion rejected' : 'Conversion detected'}
										</span>
									</div>
									{#if isRejected}
										<span class="text-[11px] text-text-tertiary">Link it manually on Transfers</span>
									{:else}
										<button
											type="button"
											class="rounded px-2 py-0.5 text-[11px] font-medium text-text-tertiary hover:bg-surface-sunken hover:text-danger-600 disabled:opacity-50"
											disabled={isRejecting}
											onclick={() => rejectConversion(conv.conversionId)}
										>
											{isRejecting ? 'Rejecting…' : "Not a conversion"}
										</button>
									{/if}
								</div>
								<!-- From row -->
								<div class="flex items-center justify-between gap-2">
									<div class="min-w-0">
										<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
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
										<p class="text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
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
									<span class="text-text-tertiary">Applies to {conv.affectedTxCount} transactions</span>
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
										<p class="text-xs font-medium text-text-primary">Transfer linked automatically</p>
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
											onclick={() => (transferDecisions[match.sourceId] = 'skipped')}>Skip</button
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
									<p class="mb-1.5 text-[10px] font-semibold tracking-wider text-text-tertiary uppercase">
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

<!-- Footer navigation -->
<div class="mt-4 flex shrink-0 items-center justify-between gap-2 pt-2">
	{#if step === 'account'}
		{#if showNewAccountForm}
			<Button variant="outline" onclick={() => (showNewAccountForm = false)} disabled={creatingAccount}>
				Back
			</Button>
			<Button onclick={createAccount} disabled={creatingAccount || !newName.trim() || !newIbanLast4.trim()}>
				{creatingAccount ? 'Creating…' : 'Create & continue'}
				<ArrowRight size={14} />
			</Button>
		{:else}
			<div></div>
			{#if onClose}
				<Button variant="outline" onclick={onClose}>Cancel</Button>
			{:else}
				<div></div>
			{/if}
		{/if}
	{:else if step === 'upload'}
		{#if pickerMode}
			<Button variant="outline" onclick={() => (step = 'account')}>Back</Button>
		{:else if onClose}
			<Button variant="outline" onclick={onClose}>Cancel</Button>
		{:else}
			<div></div>
		{/if}
		<div></div>
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
		{:else if hasCategoriesStep}
			<Button onclick={() => (step = 'categories')} disabled={loading}>
				Review categories
				<ArrowRight size={14} />
			</Button>
		{:else}
			<Button onclick={submitImport} disabled={loading}>
				{importActionLabel}
				<ArrowRight size={14} />
			</Button>
		{/if}
	{:else if step === 'columns'}
		<Button variant="outline" onclick={() => (step = 'preview')}>Back</Button>
		{#if hasCategoriesStep}
			<Button onclick={() => (step = 'categories')}>
				Review categories
				<ArrowRight size={14} />
			</Button>
		{:else}
			<Button onclick={submitImport}>
				{importActionLabel}
				<ArrowRight size={14} />
			</Button>
		{/if}
	{:else if step === 'categories'}
		<Button variant="outline" onclick={() => (step = hasColumnsStep ? 'columns' : 'preview')}>
			Back
		</Button>
		<Button onclick={submitImport}>
			Import {preview?.totalParsed ?? ''} transactions
			<ArrowRight size={14} />
		</Button>
	{:else if step === 'importing'}
		<div></div>
		<Button variant="outline" disabled>Importing…</Button>
	{:else if step === 'done'}
		{#if onClose}
			<Button variant="outline" onclick={reset}>Upload another</Button>
			<Button onclick={onClose}>Done</Button>
		{:else}
			<div></div>
			<Button onclick={reset}>Upload another file</Button>
		{/if}
	{/if}
</div>
