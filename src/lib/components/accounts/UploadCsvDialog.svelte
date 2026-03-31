<script lang="ts">
	import { invalidateAll } from '$app/navigation'
	import { CheckCircle2, AlertCircle, Upload, ArrowRight } from '@lucide/svelte'
	import * as Dialog from '$lib/components/ui/dialog'
	import { Button } from '$lib/components/ui/button'
	import Amount from '$lib/components/Amount.svelte'

	interface Props {
		open: boolean
		accountId: string
		accountName: string
		bankProfileId: string
		currency: string
		isFirstUpload: boolean
	}

	let {
		open = $bindable(false),
		accountId,
		accountName,
		bankProfileId,
		currency,
		isFirstUpload
	}: Props = $props()

	type Step = 'upload' | 'preview' | 'importing' | 'done'
	let step = $state<Step>('upload')
	let loading = $state(false)
	let err = $state<string | null>(null)
	let file = $state<File | null>(null)
	let dragging = $state(false)
	let balanceInput = $state('')

	type PreviewData = {
		filename: string
		totalParsed: number
		skippedCount: number
		preview: Array<{ date: string; description: string; amount: number; currency: string }>
	}

	type ImportResult = {
		imported: number
		flagged: number
		statusUpdates: number
		duplicates: number
	}

	let preview = $state<PreviewData | null>(null)
	let importResult = $state<ImportResult | null>(null)

	function reset() {
		step = 'upload'
		loading = false
		err = null
		file = null
		dragging = false
		balanceInput = ''
		preview = null
		importResult = null
	}

	function handleOpenChange(v: boolean) {
		open = v
		if (!v) {
			if (importResult) invalidateAll()
			reset()
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault()
		dragging = true
	}

	function handleDragLeave(e: DragEvent) {
		// Only clear dragging if we've left the drop zone entirely
		const target = e.currentTarget as HTMLElement
		if (!target.contains(e.relatedTarget as Node)) {
			dragging = false
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault()
		dragging = false
		const dropped = e.dataTransfer?.files[0]
		if (dropped) {
			file = dropped
			submitPreview()
		}
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement
		const selected = input.files?.[0]
		if (selected) {
			file = selected
			submitPreview()
		}
	}

	async function submitPreview() {
		if (!file) return
		loading = true
		err = null
		const formData = new FormData()
		formData.append('file', file)
		try {
			const res = await fetch(`/api/accounts/${accountId}/preview`, {
				method: 'POST',
				body: formData
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.message ?? 'Failed to parse CSV')
			preview = data
			step = 'preview'
		} catch (e) {
			err = e instanceof Error ? e.message : 'Could not parse the file'
		} finally {
			loading = false
		}
	}

	async function submitImport() {
		if (!file) return
		step = 'importing'
		err = null
		const formData = new FormData()
		formData.append('file', file)
		if (balanceInput.trim()) {
			formData.append('currentBalance', balanceInput.replace(',', '.'))
		}
		try {
			const res = await fetch(`/api/accounts/${accountId}/import`, {
				method: 'POST',
				body: formData
			})
			const data = await res.json()
			if (!res.ok) throw new Error(data.message ?? 'Import failed')
			importResult = data
			step = 'done'
		} catch (e) {
			err = e instanceof Error ? e.message : 'Import failed'
			step = 'preview'
		}
	}

	const steps = ['Upload', 'Review', 'Done']
	const stepIndex = $derived(step === 'upload' ? 0 : step === 'preview' || step === 'importing' ? 1 : 2)
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Import Transactions</Dialog.Title>
		</Dialog.Header>

		<!-- Step progress bar -->
		<div class="flex gap-1.5 mb-6">
			{#each steps as _, i}
				<div
					class="h-1 flex-1 rounded-full transition-colors duration-300 {i <= stepIndex
						? 'bg-primary-500'
						: 'bg-border'}"
				></div>
			{/each}
		</div>

		<!-- ── Step: Upload ── -->
		{#if step === 'upload'}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="border-2 border-dashed rounded-xl p-12 flex flex-col items-center gap-3 text-center
				       transition-colors duration-150 cursor-default
				       {dragging ? 'border-primary-500 bg-primary-50' : 'border-border hover:border-border-strong'}"
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
			>
				<div
					class="w-12 h-12 rounded-full bg-surface-sunken flex items-center justify-center text-text-tertiary"
				>
					<Upload size={20} />
				</div>
				<div>
					<p class="text-sm font-medium text-text-primary">Drop your CSV file here</p>
					<p class="text-xs text-text-secondary mt-0.5">Supported format: {bankProfileId}</p>
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
				<p class="text-center text-sm text-text-secondary mt-4 animate-pulse">Parsing file…</p>
			{/if}

		<!-- ── Step: Preview ── -->
		{:else if step === 'preview' && preview}
			<!-- Status banner -->
			<div class="flex items-center gap-3 mb-5">
				<div
					class="w-10 h-10 rounded-full bg-success-100 flex items-center justify-center shrink-0"
				>
					<CheckCircle2 size={18} class="text-success-600" />
				</div>
				<div class="min-w-0">
					<p class="text-sm font-semibold text-text-primary">Ready to import</p>
					<p class="text-xs text-text-secondary truncate">
						We've processed '{preview.filename}'
					</p>
				</div>
			</div>

			<!-- Stats grid -->
			<div class="grid grid-cols-3 gap-3 mb-5">
				<div class="border border-border rounded-lg p-3">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">New</p>
					<p class="text-2xl font-bold text-text-primary mt-1 font-mono tabular-nums">
						{preview.totalParsed}
					</p>
				</div>
				<div class="border border-border rounded-lg p-3">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
						Skipped
					</p>
					<p class="text-2xl font-bold text-text-primary mt-1 font-mono tabular-nums">
						{preview.skippedCount}
					</p>
				</div>
				<div class="border border-border-strong bg-surface-sunken rounded-lg p-3">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-primary-500">
						Account
					</p>
					<p class="text-sm font-semibold text-text-primary mt-1 truncate">{accountName}</p>
				</div>
			</div>

			<!-- Transaction preview table -->
			<div class="border border-border rounded-lg overflow-hidden mb-5">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-surface-sunken border-b border-border">
							<th
								class="text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-3 py-2"
							>
								Date
							</th>
							<th
								class="text-left text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-3 py-2"
							>
								Description
							</th>
							<th
								class="text-right text-[10px] font-semibold uppercase tracking-wider text-text-tertiary px-3 py-2"
							>
								Amount
							</th>
						</tr>
					</thead>
					<tbody>
						{#each preview.preview as row}
							<tr class="border-b border-border last:border-0">
								<td class="px-3 py-2 text-text-secondary whitespace-nowrap text-xs">{row.date}</td>
								<td class="px-3 py-2 text-text-primary max-w-[180px]">
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
						class="bg-surface-sunken px-3 py-1.5 text-center text-[10px] uppercase tracking-wider text-text-tertiary border-t border-border"
					>
						Showing 5 of {preview.totalParsed} rows
					</div>
				{/if}
			</div>

			<!-- Balance input (shown on first upload or always for reconciliation) -->
			{#if isFirstUpload}
				<div class="mb-2">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary mb-2">
						Confirm current balance
					</p>
					<div class="flex items-baseline gap-2 border-b-2 border-border pb-1.5">
						<span class="text-2xl text-text-tertiary">{currency === 'EUR' ? '€' : currency}</span>
						<input
							type="text"
							inputmode="decimal"
							placeholder="0.00"
							bind:value={balanceInput}
							class="flex-1 text-2xl font-bold font-mono text-text-primary bg-transparent outline-none placeholder:text-text-tertiary/40"
						/>
					</div>
					<p class="text-xs text-text-tertiary mt-1.5">
						Used to reconcile your ledger with bank statements.
					</p>
				</div>
			{/if}

		<!-- ── Step: Importing ── -->
		{:else if step === 'importing'}
			<div class="flex flex-col items-center py-12 gap-3">
				<div
					class="w-12 h-12 rounded-full border-2 border-primary-500 border-t-transparent animate-spin"
				></div>
				<p class="text-sm text-text-secondary">Importing transactions…</p>
			</div>

		<!-- ── Step: Done ── -->
		{:else if step === 'done' && importResult}
			<div class="flex flex-col items-center py-8 text-center gap-4">
				<div
					class="w-14 h-14 rounded-full bg-success-100 flex items-center justify-center"
				>
					<CheckCircle2 size={28} class="text-success-600" />
				</div>
				<div>
					<h3 class="text-base font-semibold text-text-primary">Import complete</h3>
					<p class="text-sm text-text-secondary mt-0.5">
						Your transactions have been saved.
					</p>
				</div>
				<div class="grid grid-cols-2 gap-3 w-full max-w-xs mt-1">
					<div class="border border-border rounded-lg p-3 text-center">
						<p class="text-2xl font-bold font-mono text-text-primary">{importResult.imported}</p>
						<p class="text-xs text-text-secondary mt-0.5">Imported</p>
					</div>
					<div class="border border-border rounded-lg p-3 text-center">
						<p class="text-2xl font-bold font-mono text-text-primary">{importResult.duplicates}</p>
						<p class="text-xs text-text-secondary mt-0.5">Duplicates</p>
					</div>
					{#if importResult.statusUpdates > 0}
						<div class="border border-border rounded-lg p-3 text-center">
							<p class="text-2xl font-bold font-mono text-text-primary">
								{importResult.statusUpdates}
							</p>
							<p class="text-xs text-text-secondary mt-0.5">Status updates</p>
						</div>
					{/if}
					{#if importResult.flagged > 0}
						<div class="border border-warning-200 bg-warning-50 rounded-lg p-3 text-center">
							<p class="text-2xl font-bold font-mono text-warning-700">{importResult.flagged}</p>
							<p class="text-xs text-warning-600 mt-0.5">Need review</p>
						</div>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Error banner -->
		{#if err}
			<div
				class="flex items-center gap-2 text-danger-600 text-sm bg-danger-50 rounded-lg px-3 py-2.5 mt-3 border border-danger-200"
			>
				<AlertCircle size={14} class="shrink-0" />
				{err}
			</div>
		{/if}

		<!-- Footer -->
		<Dialog.Footer>
			{#if step === 'upload'}
				<div></div>
				<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			{:else if step === 'preview'}
				<Button
					variant="outline"
					onclick={() => {
						step = 'upload'
						file = null
						preview = null
						err = null
					}}
				>
					Back
				</Button>
				<Button onclick={submitImport} disabled={loading}>
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
