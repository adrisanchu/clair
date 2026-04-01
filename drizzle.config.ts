import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export default {
	schema: ['./src/lib/server/db/auth.schema.ts', './src/lib/server/db/schema.ts'],
	out: './drizzle/migrations',
	dialect: 'postgresql',
	dbCredentials: {
		url: process.env.DATABASE_URL
	}
} satisfies Config;
