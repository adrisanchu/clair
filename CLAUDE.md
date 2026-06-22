# Clair — Claude Code Instructions

> Read this file before every task. See `features/` for full PRDs.

## Project

Personal finance aggregator: upload bank CSVs → AI-tag transactions → export clean CSV.
Two users max (invite-only couple). Designed to scale to more users in v2 with no schema changes.

## Stack

| Layer      | Choice                                                           |
| ---------- | ---------------------------------------------------------------- |
| Framework  | SvelteKit 2.x + **Svelte 5 runes** (strict — no legacy syntax)   |
| Language   | TypeScript strict mode throughout                                |
| Styling    | Tailwind CSS v4 (CSS `@theme` config — no `tailwind.config.ts`)  |
| Components | shadcn-svelte (already initialised — `src/lib/components/ui/`)   |
| Auth       | **Better Auth** (`better-auth ~1.4`) — `emailAndPassword` plugin |
| Database   | PostgreSQL via Docker Compose (local) / Neon (prod)              |
| ORM        | Drizzle ORM (`drizzle-orm` + `postgres` driver)                  |
| AI         | Anthropic Claude Haiku — Phase 5 only                            |
| Email      | Resend — invites                                                 |
| Deploy     | Vercel (SvelteKit adapter)                                       |

## Critical: Svelte 5 / SvelteKit Patterns

### `$app/state` — NOT `$app/stores`

PRD code samples use `import { page } from '$app/stores'` (Svelte 4). Always use Svelte 5 syntax:

```typescript
// ✅ Svelte 5 — reactive state object, no $ prefix needed in template
import { page } from '$app/state';
page.url.pathname; // access directly

// ❌ Wrong — Svelte 4 store syntax
import { page } from '$app/stores';
$page.url.pathname;
```

### Auth client (client-side)

```typescript
import { authClient } from '$lib/auth-client';
const { data: session } = authClient.useSession();
```

## Critical: Svelte 5 Runes Only

```svelte
<!-- ✅ Correct — Svelte 5 runes -->
<script lang="ts">
	let count = $state(0);
	let doubled = $derived(count * 2);
	interface Props {
		label: string;
	}
	let { label }: Props = $props();
</script>

<!-- ❌ Wrong — never use Svelte 4 legacy syntax -->
<!-- export let | writable/readable stores | $: reactive | createEventDispatcher -->
```

## Key Files

| File                               | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `src/lib/server/auth.ts`           | Better Auth config (plugins, user additional fields)              |
| `src/lib/server/db/auth.schema.ts` | **Auto-generated** by `npm run auth:schema` — never edit manually |
| `src/lib/server/db/schema.ts`      | Business schema (imports + re-exports auth schema)                |
| `src/lib/server/db/index.ts`       | Drizzle client singleton                                          |
| `src/hooks.server.ts`              | Sets `locals.user` + `locals.session` via `svelteKitHandler`      |
| `src/app.d.ts`                     | TypeScript types for `App.Locals`                                 |
| `src/routes/layout.css`            | Global CSS + Tailwind v4 `@theme` design tokens                   |
| `compose.yaml`                     | Docker Compose for local dev Postgres                             |
| `compose.test.yaml`                | Docker Compose for isolated test Postgres (empty DB)              |
| `scripts/seed-owner.ts`            | Creates first owner account (run once after first migration)      |

## Better Auth Patterns

### Session access (server-side)

```typescript
// +page.server.ts / +layout.server.ts / +server.ts
export const load = async ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { user: locals.user };
};
```

### Auth API calls (form actions)

```typescript
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';

// Sign in
await auth.api.signInEmail({ body: { email, password } });

// Sign up
await auth.api.signUpEmail({ body: { email, password, name } });

// Sign out
await auth.api.signOut({ headers: event.request.headers });
```

### No separate /api/auth route needed

Better Auth is mounted via `svelteKitHandler` in `hooks.server.ts`. Do NOT create an `api/auth` route file.

### Extending the user table with custom fields

Edit `user.additionalFields` in `src/lib/server/auth.ts`, then regenerate:

```bash
npm run auth:schema   # regenerates auth.schema.ts
npm run db:generate   # creates new Drizzle migration
npm run db:migrate    # applies migration to DB
```

## Development Setup

### Local database environments

Two independent Postgres containers share the same image (`postgres:16-alpine`) but use separate volumes:

| Environment | Compose file | Container | Host port | Volume | Purpose |
|-------------|-------------|-----------|-----------|--------|---------|
| **Dev** | `compose.yaml` | `clair_db` | 5432 | `clair_clair_pgdata` | Primary workspace with real data (close-to-prod) |
| **Test** | `compose.test.yaml` | `clair_db_test` | 5433 | `clair_test_clair_test_pgdata` | Empty DB for testing new features / breaking changes |

Both can run side by side. The dev server connects to whichever you specify via `DATABASE_URL`.

#### Running against dev (default)

```bash
docker compose up -d        # start dev DB on :5432
npm run dev                 # uses DATABASE_URL from .env (port 5432)
```

#### Running against test

```bash
docker compose -f compose.test.yaml up -d   # start test DB on :5433
DATABASE_URL="postgres://root:mysecretpassword@localhost:5433/local" npm run dev
```

#### First-time test DB setup

```bash
docker compose -f compose.test.yaml up -d

# Apply migrations (drizzle-kit migrate doesn't support env override — apply SQL directly)
for f in drizzle/migrations/0*.sql; do
  sed 's/--> statement-breakpoint//g' "$f" | docker exec -i clair_db_test psql -U root -d local
done

# Seed a test user
DATABASE_URL="postgres://root:mysecretpassword@localhost:5433/local" \
  npx tsx scripts/seed-owner.ts --email=test@test.com --name="Test" --password=test1234
```

#### Tear down (without affecting dev)

```bash
docker compose -f compose.test.yaml down -v   # destroy test DB + data only
```

### First time (fresh clone)

```bash
docker compose up -d                     # start Postgres
npm install
npm run db:generate && npm run db:migrate    # NOTE: db:generate needs a TTY — run in terminal, not CI
npx tsx scripts/seed-owner.ts --email=you@example.com --name="Pablo" --password=yourpassword
npm run dev
```

### Daily workflow

```bash
docker compose up -d   # start DB (if not running)
npm run dev
```

### Useful commands

```bash
npm run db:studio        # open Drizzle Studio (DB GUI at localhost:4983)
npm run auth:schema      # after editing auth.ts
npm run db:generate      # after editing schema.ts
npm run db:migrate       # apply pending migrations
docker compose down -v   # destroy dev DB + data (full reset)
```

## Environment Variables

```bash
# .env
DATABASE_URL="postgres://root:mysecretpassword@localhost:5432/local"
ORIGIN="http://localhost:5173"
BETTER_AUTH_SECRET="..."        # 32+ chars, generate with: openssl rand -base64 32
RESEND_API_KEY="re_..."         # for email invites
EMAIL_FROM="noreply@clair.app"
ANTHROPIC_API_KEY="sk-ant-..."  # Phase 5 only — not needed for MVP
```

## Route Structure

```
src/routes/
├── (auth)/              ← public routes
│   ├── login/
│   └── invite/[token]/
├── (app)/               ← protected layout
│   ├── +layout.server.ts   ← if (!locals.user) redirect('/login')
│   ├── dashboard/
│   ├── accounts/
│   ├── transactions/
│   ├── export/
│   └── settings/
└── api/                 ← always check locals.user at the top of every handler
```

## Schema Structure

- **`auth.schema.ts`** (auto-generated): `user`, `session`, `account`, `verification`
- **`schema.ts`** (business tables): `workspaces`, `bankAccounts`, `transactions`, etc. — re-exports auth schema
- All business tables reference `user.id` (from auth schema — singular, not plural)
- Custom user fields (`workspaceId`, `role`) live in `auth.ts` → `user.additionalFields`
- Never put `passwordHash` on the user table — Better Auth stores passwords in the `account` table

## Design System

- **Primary colour:** pink-500 (`#ec4899`)
- **Positive amounts:** `text-success-600` | **Negative amounts:** `text-danger-600`
- **Fonts:** Inter (sans) + JetBrains Mono (mono)
- Always use `<Amount>` component for monetary values (`font-mono tabular-nums`)
- Design aesthetic: Mynt/Revolut — crisp white, generous whitespace, bold monospace numbers
- No gradients, glassmorphism, dark-by-default, or heavy custom animations
- Design tokens defined in `src/routes/layout.css` using Tailwind v4 `@theme` directive

## Bank Profile IDs

`revolut_eu` · `caixabank_es` · `bankinter_es` · `bbva_es` · `myinvestor_es`

## Build Phases

| Phase | Description                                                | Status       |
| ----- | ---------------------------------------------------------- | ------------ |
| 1     | Scaffold, Docker, schema, Better Auth, login, invite, seed | **Complete** |
| 2     | Bank account CRUD + sharing model                          | Pending      |
| 3a–d  | CSV parsers + full upload pipeline                         | Pending      |
| 4     | Transaction list + detail panel + transfer linking         | Pending      |
| 5     | AI tagging via Claude Haiku                                | Pending      |
| 6     | CSV export streaming                                       | Pending      |
| 7     | Settings, upload history, mobile polish, empty states      | Pending      |

## Design Decisions

### Constants and magic numbers

All shared constants live in `src/lib/constants/` as separate files grouped by domain (e.g. `colors.ts`, `ai.ts`). This path is available to both server and client code, so a single file can be imported by server modules (`$lib/server/`) and Svelte components alike — no duplication needed.

- Do **not** define magic numbers inline in a module and re-export them as if they were that module's API.
- Do **not** duplicate constants in a sibling `constants.ts` inside a component folder — import from `$lib/constants/` instead.
- Server-only constants (e.g. a model ID, a batch size) can still live in `$lib/constants/` — being importable from the client doesn't mean the client must use them.

### AI availability check

`isAiAvailable()` in `src/lib/server/ai/tagger.ts` checks only that `ANTHROPIC_API_KEY` is set. A more accurate name would be `isAiConfigured()`. It does **not** guarantee the key is valid, that the account has credits, or that Anthropic's API is reachable.

The real runtime guard is the `try/catch` inside each function in `tagger.ts`: on any failure, AI functions return graceful fallbacks (empty array / exact-match fallback) so the upload flow never breaks.

**Things to improve later:**
- Rename `isAiAvailable` → `isAiConfigured` for accuracy, or introduce a lightweight `/api/ai/status` health-check endpoint that caches the result of a real test call.
- The `aiAvailable` flag passed from `+layout.server.ts` to the frontend is a weak signal — consider gating UI elements on observed AI results rather than the presence of a key.

## Coding Rules

1. `$props()` with inline interface — never `export let`
2. `$state()` / `$derived()` / `$effect()` — never `svelte/store`
3. Never edit `auth.schema.ts` directly — always regenerate via `npm run auth:schema`
4. Always scope DB queries to the authenticated user's workspace
5. Use `locals.user` for auth checks — not `locals.auth()`
6. API routes: check `locals.user` at top, throw `error(401)` if absent
7. All amounts use the `<Amount>` component — never raw number strings
8. Svelte 5: use `{@render children()}` for slots, `import type { Snippet }` for typed slots
