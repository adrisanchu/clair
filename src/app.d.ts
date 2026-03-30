import type { Session, User } from 'better-auth';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Locals {
			user?: User & { workspaceId?: string | null; role?: string | null };
			session?: Session;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
