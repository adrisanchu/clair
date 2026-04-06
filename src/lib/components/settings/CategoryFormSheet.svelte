<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import ColorPicker from './ColorPicker.svelte';
	import type { CategoryRow } from '$lib/types';

	interface Props {
		open?: boolean;
		/** 'create' to add a new category; 'edit' to update an existing one */
		mode?: 'create' | 'edit';
		/** Set when creating a subcategory */
		parentId?: string | null;
		/** Set when editing an existing category */
		category?: CategoryRow | null;
	}

	let {
		open = $bindable(false),
		mode = 'create',
		parentId = null,
		category = null
	}: Props = $props();

	let name = $state('');
	let color = $state('#6b7280');
	let submitting = $state(false);
	let fieldError = $state<string | null>(null);

	$effect(() => {
		if (open) {
			name = mode === 'edit' && category ? category.name : '';
			color = mode === 'edit' && category ? category.color : '#6b7280';
			fieldError = null;
		}
	});

	const title = $derived(
		mode === 'edit' ? 'Edit category' : parentId ? 'Add subcategory' : 'Add category'
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		fieldError = null;

		const trimmedName = name.trim();
		if (!trimmedName) {
			fieldError = 'Name is required';
			return;
		}

		submitting = true;
		try {
			const url =
				mode === 'edit' && category
					? `/api/settings/categories/${category.id}`
					: '/api/settings/categories';

			const body =
				mode === 'edit'
					? { name: trimmedName, color }
					: { name: trimmedName, color, parentId: parentId ?? null };

			const res = await fetch(url, {
				method: mode === 'edit' ? 'PATCH' : 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Something went wrong' }));
				fieldError = data.message ?? 'Something went wrong';
				return;
			}

			await invalidateAll();
			open = false;
		} finally {
			submitting = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content side="right" class="flex w-full flex-col sm:max-w-md">
		<Sheet.Header>
			<Sheet.Title>{title}</Sheet.Title>
			<Sheet.Description>
				{mode === 'edit'
					? 'Update the name or color.'
					: 'Choose a name and color for the category.'}
			</Sheet.Description>
		</Sheet.Header>

		<form onsubmit={handleSubmit} class="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-2">
			<!-- Name -->
			<div class="grid gap-1.5">
				<Label for="cat-name">Name</Label>
				<Input
					id="cat-name"
					bind:value={name}
					placeholder="e.g. Groceries"
					maxlength={50}
					required
					disabled={submitting}
				/>
			</div>

			<!-- Color -->
			<div class="grid gap-1.5">
				<Label>Color</Label>
				<div class="flex items-center gap-3">
					<ColorPicker bind:value={color} />
					<span class="font-mono text-sm text-text-secondary">{color}</span>
				</div>
			</div>

			{#if fieldError}
				<p class="text-sm text-danger-600">{fieldError}</p>
			{/if}
		</form>

		<Sheet.Footer class="px-6 pt-2 pb-6">
			<Sheet.Close>
				{#snippet child({ props })}
					<Button variant="outline" {...props} disabled={submitting}>Cancel</Button>
				{/snippet}
			</Sheet.Close>
			<Button
				onclick={(e: MouseEvent) => {
					const form = (e.currentTarget as HTMLElement)
						.closest('[data-slot="sheet-content"]')
						?.querySelector('form');
					form?.requestSubmit();
				}}
				disabled={submitting || !name.trim()}
			>
				{submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Add'}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
