/**
 * tsx shim for SvelteKit's `$env/dynamic/private` virtual module.
 *
 * `$env/dynamic/private` is provided by Vite at runtime and has no real file, so tsx
 * can't resolve it. In production it simply exposes the private env vars; for tests we
 * point the alias here (see tests/_shims/tsconfig.tsx.json) so server modules that read
 * `env.DATABASE_URL` (e.g. src/lib/server/db/index.ts) load under tsx.
 */
export const env = process.env as Record<string, string | undefined>;
