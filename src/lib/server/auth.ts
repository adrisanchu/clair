import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { authUser, authSession, authAccount, authVerification } from './db/auth.schema';

export const auth = betterAuth({
	// Pass the namespaced schema tables so Better Auth writes to auth.user, auth.session, etc.
	database: drizzleAdapter(db, {
		provider: 'pg',
		schema: {
			user: authUser,
			session: authSession,
			account: authAccount,
			verification: authVerification
		}
	}),

	emailAndPassword: { enabled: true },

	session: {
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24 // refresh session TTL daily
	},

	// Expose workspaceId and role on auth.user.
	// After editing these, run: npm run auth:schema → db:generate → db:migrate
	user: {
		additionalFields: {
			workspaceId: { type: 'string', required: false, input: false },
			role: { type: 'string', required: false, defaultValue: 'member', input: false }
		}
	},

	plugins: [
		// REQUIRED: fixes cookie propagation in SvelteKit server actions
		sveltekitCookies(getRequestEvent)
	]
});
