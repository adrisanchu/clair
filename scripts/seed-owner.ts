/**
 * Creates the first owner account and workspace.
 * Run once after the first DB migration:
 *   npx tsx scripts/seed-owner.ts --email=you@example.com --name="Your Name" --password=yourpassword
 */

// Load .env file (Node 20.12+ built-in)
try {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(process as any).loadEnvFile('.env');
} catch {
	// Env vars may already be set in the shell
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';

// Resolve env before importing auth (auth reads DATABASE_URL at module load)
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('Error: DATABASE_URL is not set. Make sure .env is present.');
	process.exit(1);
}

// Dynamic imports after env check
const { betterAuth } = await import('better-auth');
const { drizzleAdapter } = await import('better-auth/adapters/drizzle');

// Parse CLI args
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.filter((a) => a.startsWith('--'))
		.map((a) => {
			const [key, ...rest] = a.slice(2).split('=');
			return [key, rest.join('=')];
		})
);

const email = args['email'];
const name = args['name'];
const password = args['password'];

if (!email || !name || !password) {
	console.error('Usage: npx tsx scripts/seed-owner.ts --email=... --name=... --password=...');
	process.exit(1);
}

// Set up DB client
const client = postgres(DATABASE_URL);
const { user, workspaces } = await import('../src/lib/server/db/schema.js');
const db = drizzle(client, { schema: { user, workspaces } });

// Set up a minimal auth instance for the seed script
const auth = betterAuth({
	baseURL: process.env.ORIGIN ?? 'http://localhost:5173',
	secret: process.env.BETTER_AUTH_SECRET ?? 'seed-secret-not-used-in-prod',
	database: drizzleAdapter(db as never, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			workspaceId: { type: 'string', required: false },
			role: { type: 'string', defaultValue: 'member' }
		}
	}
});

console.log(`Creating owner account for ${email}...`);

try {
	// Create the user via Better Auth
	await auth.api.signUpEmail({ body: { email, password, name } });
} catch (err: unknown) {
	const message = err instanceof Error ? err.message : String(err);
	if (message.toLowerCase().includes('already exists') || message.toLowerCase().includes('duplicate')) {
		console.log('User already exists, continuing to workspace setup...');
	} else {
		console.error('Failed to create user:', message);
		process.exit(1);
	}
}

// Fetch the created user
const createdUser = await db.query.user.findFirst({ where: eq(user.email, email) });
if (!createdUser) {
	console.error('Could not find user after creation. Aborting.');
	process.exit(1);
}

// Create workspace if not already set
let workspaceId = createdUser.workspaceId;
if (!workspaceId) {
	const [ws] = await db
		.insert(workspaces)
		.values({ name: `${name}'s workspace`, ownerId: createdUser.id })
		.returning({ id: workspaces.id });
	workspaceId = ws.id;
}

// Set role=owner and workspaceId on the user
await db
	.update(user)
	.set({ role: 'owner', workspaceId })
	.where(eq(user.id, createdUser.id));

console.log(`\nOwner account created successfully!`);
console.log(`  Name:        ${name}`);
console.log(`  Email:       ${email}`);
console.log(`  User ID:     ${createdUser.id}`);
console.log(`  Workspace:   ${workspaceId}`);
console.log(`\nYou can now log in at http://localhost:5173/login`);

await client.end();
