import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Prevent multiple connections during SvelteKit HMR in dev
const globalForDb = globalThis as unknown as { _pgClient?: ReturnType<typeof postgres> };
const client = globalForDb._pgClient ?? postgres(env.DATABASE_URL);
if (process.env.NODE_ENV !== 'production') globalForDb._pgClient = client;

export const db = drizzle(client, { schema });
export type DB = typeof db;
