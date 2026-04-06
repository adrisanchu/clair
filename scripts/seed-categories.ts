/**
 * Seeds default categories into an existing workspace.
 * Useful when a workspace was created before category seeding was added.
 *
 *   npx tsx scripts/seed-categories.ts --workspaceId=<id>
 *
 * Skips any category whose name already exists at the top level in that workspace.
 */

// Load .env file (Node 20.12+ built-in)
try {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(process as any).loadEnvFile('.env');
} catch {
	// Env vars may already be set in the shell
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL is not set. Make sure .env is present.');
	process.exit(1);
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq, isNull } from 'drizzle-orm';

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => {
			const [key, ...rest] = a.slice(2).split('=');
			return [key, rest.join('=')];
		})
);

const workspaceId = args['workspaceId'];
if (!workspaceId) {
	console.error('Usage: npx tsx scripts/seed-categories.ts --workspaceId=<id>');
	process.exit(1);
}

const client = postgres(DATABASE_URL);
const { categories, workspaces } = await import('../src/lib/server/db/schema.js');
const db = drizzle(client, { schema: { categories, workspaces } });

// Verify workspace exists
const ws = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
if (!ws) {
	console.error(`Workspace "${workspaceId}" not found.`);
	await client.end();
	process.exit(1);
}

console.log(`Seeding categories for workspace "${ws.name}" (${workspaceId})...`);

const defaults = [
	{ name: 'Restaurants', color: '#f97316', sortOrder: 0 },
	{ name: 'Coffee', color: '#a16207', sortOrder: 1 },
	{ name: 'Groceries', color: '#16a34a', sortOrder: 2 },
	{ name: 'Transport', color: '#2563eb', sortOrder: 3 },
	{ name: 'Travel', color: '#7c3aed', sortOrder: 4 },
	{ name: 'Sports', color: '#0891b2', sortOrder: 5 },
	{ name: 'Health', color: '#dc2626', sortOrder: 6 },
	{ name: 'Subscriptions', color: '#9333ea', sortOrder: 7 },
	{ name: 'Transfers', color: '#6b7280', sortOrder: 8 },
	{ name: 'Savings', color: '#15803d', sortOrder: 9 },
	{ name: 'Shopping', color: '#db2777', sortOrder: 10 },
	{ name: 'Utilities', color: '#b45309', sortOrder: 11 },
	{ name: 'Income', color: '#059669', sortOrder: 12 },
	{ name: 'Other', color: '#78716c', sortOrder: 13 }
];

// Fetch existing top-level category names to skip duplicates
const existing = await db
	.select({ name: categories.name })
	.from(categories)
	.where(and(eq(categories.workspaceId, workspaceId), isNull(categories.parentId)));

const existingNames = new Set(existing.map((r) => r.name));

const toInsert = defaults.filter((d) => !existingNames.has(d.name));

if (toInsert.length === 0) {
	console.log('All default categories already exist. Nothing to do.');
} else {
	await db.insert(categories).values(toInsert.map((d) => ({ ...d, workspaceId })));
	console.log(`Inserted ${toInsert.length} categories:`);
	for (const cat of toInsert) {
		console.log(`  + ${cat.name}`);
	}
	if (existingNames.size > 0) {
		console.log(`Skipped ${existingNames.size} already existing.`);
	}
}

await client.end();
