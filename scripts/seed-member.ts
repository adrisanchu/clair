/**
 * Creates a second member account and assigns them to an existing workspace.
 * Run once after seed-owner.ts to set up a second user for testing:
 *
 *   npx tsx scripts/seed-member.ts \
 *     --email=partner@example.com \
 *     --name="María García" \
 *     --password=yourpassword \
 *     --workspaceId=<id from seed-owner output>
 *
 * The workspaceId is printed when running seed-owner.ts.
 * You can also find it in Drizzle Studio: npm run db:studio
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
import { eq } from 'drizzle-orm';

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
const workspaceId = args['workspaceId'];

if (!email || !name || !password || !workspaceId) {
	console.error(
		'Usage: npx tsx scripts/seed-member.ts --email=... --name=... --password=... --workspaceId=...'
	);
	process.exit(1);
}

// Set up DB client
const client = postgres(DATABASE_URL);
const { authUser, authSession, authAccount, authVerification, workspaces } =
	await import('../src/lib/server/db/schema.js');
const db = drizzle(client, { schema: { authUser, workspaces } });

// Verify the workspace exists
const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
if (!workspace) {
	console.error(`Error: Workspace "${workspaceId}" not found. Check the ID and try again.`);
	process.exit(1);
}

// Check workspace does not already have 2 members
const existingMembers = await db
	.select({ id: authUser.id })
	.from(authUser)
	.where(eq(authUser.workspaceId, workspaceId));

if (existingMembers.length >= 2) {
	console.error(
		`Error: Workspace "${workspace.name}" already has ${existingMembers.length} members (max 2).`
	);
	process.exit(1);
}

// Minimal auth instance — must match auth.ts schema mapping
const auth = betterAuth({
	database: drizzleAdapter(db as never, {
		provider: 'pg',
		schema: {
			user: authUser,
			session: authSession,
			account: authAccount,
			verification: authVerification
		}
	}),
	emailAndPassword: { enabled: true },
	user: {
		additionalFields: {
			workspaceId: { type: 'string', required: false, input: false },
			role: { type: 'string', required: false, defaultValue: 'member', input: false }
		}
	}
});

console.log(`Creating member account for ${email}...`);

try {
	await auth.api.signUpEmail({ body: { email, password, name } });
} catch (err: unknown) {
	const message = err instanceof Error ? err.message : String(err);
	if (
		message.toLowerCase().includes('already exists') ||
		message.toLowerCase().includes('duplicate')
	) {
		console.log('User already exists, continuing to workspace assignment...');
	} else {
		console.error('Failed to create user:', message);
		process.exit(1);
	}
}

// Fetch the created user
const createdUser = await db.query.authUser.findFirst({ where: eq(authUser.email, email) });
if (!createdUser) {
	console.error('Could not find user after creation. Aborting.');
	process.exit(1);
}

// Assign to workspace as member
await db
	.update(authUser)
	.set({ role: 'member', workspaceId })
	.where(eq(authUser.id, createdUser.id));

console.log(`\nMember account created successfully!`);
console.log(`  Name:        ${name}`);
console.log(`  Email:       ${email}`);
console.log(`  User ID:     ${createdUser.id}`);
console.log(`  Workspace:   ${workspaceId} (${workspace.name})`);
console.log(`\nThey can now log in at http://localhost:5173/login`);

await client.end();
