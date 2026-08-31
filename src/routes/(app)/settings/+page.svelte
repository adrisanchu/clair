<script lang="ts">
	import CategoryList from '$lib/components/settings/CategoryList.svelte';
	import CostGroupList from '$lib/components/settings/CostGroupList.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Tab = 'categories' | 'cost-groups';
	let activeTab = $state<Tab>('categories');

	const tabs: { id: Tab; label: string }[] = [
		{ id: 'categories', label: 'Categories' },
		{ id: 'cost-groups', label: 'Cost Groups' }
	];
</script>

<div class="max-w-3xl px-4 py-6 md:px-8 md:py-8">
	<!-- Page header -->
	<div class="mb-6">
		<h1 class="text-2xl font-semibold tracking-tight text-text-primary">Settings</h1>
		<p class="mt-1 text-sm text-text-secondary">Manage your workspace preferences</p>
	</div>

	<!-- Tab bar -->
	<div class="mb-6 flex gap-1 border-b border-border">
		{#each tabs as tab (tab.id)}
			<button
				class="px-4 py-2 text-sm font-medium transition-colors {activeTab === tab.id
					? 'border-b-2 border-primary-500 text-primary-600'
					: 'text-text-secondary hover:text-text-primary'}"
				onclick={() => (activeTab = tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Tab content -->
	{#if activeTab === 'categories'}
		<CategoryList categories={data.categories} isOwner={data.isOwner} />
	{:else if activeTab === 'cost-groups'}
		<CostGroupList costGroups={data.costGroups} isOwner={data.isOwner} />
	{/if}
</div>
