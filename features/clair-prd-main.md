# Clair — Product Requirements Document
## File 1 of 3: Project Overview
**Version:** 1.0  
**Status:** Ready for build

---

## How to use these three files with Claude Code

There are three PRD files. Feed them in this order when starting a task:

| Task | Files to include |
|---|---|
| Scaffold the full project | All three files |
| Any backend task (DB, API routes, auth) | This file + `clair-prd-backend.md` |
| Any frontend task (UI, components, design) | This file + `clair-prd-frontend.md` |
| A full feature (e.g. CSV upload) | All three files |

Never feed all three files when doing a narrowly scoped task — it wastes context and
produces worse output.

---

## 1. What is Clair

Clair is a personal finance aggregator for people who manage multiple bank accounts.
It replaces a tedious manual workflow — downloading statements per bank, copy-pasting
into spreadsheets, tagging every transaction by hand — with a single web app where you
upload a CSV, get everything parsed and AI-tagged, and export a clean file.

**The core loop:**
1. Download a CSV from your bank's app
2. Upload it to Clair (takes ~30 seconds)
3. Transactions are parsed, deduplicated, and auto-categorised by AI
4. Review and correct anything the AI got wrong
5. Export a clean CSV for Fina or any other finance tool

**v1 target users:** Two people sharing finances (a couple). The app is invite-only
with no public registration. Designed to scale to other users in v2 with no schema
changes.

---

## 2. Supported banks (v1)

| Bank | Profile ID | Country |
|---|---|---|
| Revolut | `revolut_eu` | EU |
| CaixaBank | `caixabank_es` | Spain |
| Bankinter | `bankinter_es` | Spain |
| MyInvestor | `myinvestor_es` | Spain |
| BBVA | `bbva_es` | Spain |

---

## 3. Stack

| Layer | Choice |
|---|---|
| **Framework** | SvelteKit (latest) with Svelte 5 runes |
| **Language** | TypeScript throughout — strict mode |
| **Styling** | Tailwind CSS v4 (CSS `@theme` config — no `tailwind.config.ts`) |
| **Components** | shadcn-svelte |
| **Auth** | Better Auth (`better-auth`) — email/password via `emailAndPassword` plugin |
| **Database** | PostgreSQL via Docker (local) / Vercel Postgres - Neon (production) |
| **ORM** | Drizzle ORM (`drizzle-orm` + `postgres` driver) |
| **CSV parsing** | PapaParse |
| **Encoding detection** | chardet (for CaixaBank's ISO-8859-1 exports) |
| **AI tagging** | Anthropic SDK `@anthropic-ai/sdk` — added in Phase 5 |
| **Email** | Resend (invites + magic-link password recovery) |
| **Deploy** | Vercel (SvelteKit adapter) |

### Why SvelteKit + Svelte 5

SvelteKit is the developer's primary stack. Svelte 5's runes (`$state`, `$derived`,
`$effect`, `$props`) are used exclusively — no legacy stores. shadcn-svelte is a
mature port of shadcn/ui for Svelte with full component parity.

### Important: Svelte 5 runes syntax

All components MUST use Svelte 5 runes. Never use legacy Svelte 4 syntax.

```svelte
<!-- ✅ Correct — Svelte 5 runes -->
<script lang="ts">
  let count = $state(0)
  let doubled = $derived(count * 2)

  interface Props { label: string }
  let { label }: Props = $props()
</script>

<!-- ❌ Wrong — Svelte 4 legacy -->
<script lang="ts">
  import { writable } from 'svelte/store'
  export let label: string
  let count = 0
  $: doubled = count * 2
</script>
```

---

## 4. Project structure

```
clair/
├── src/
│   ├── routes/
│   │   ├── (auth)/
│   │   │   ├── login/
│   │   │   │   └── +page.svelte
│   │   │   └── invite/
│   │   │       └── [token]/
│   │   │           └── +page.svelte
│   │   ├── (app)/                        ← protected layout
│   │   │   ├── +layout.svelte            ← sidebar + bottom nav
│   │   │   ├── +layout.server.ts         ← session guard
│   │   │   ├── dashboard/
│   │   │   │   └── +page.svelte
│   │   │   ├── accounts/
│   │   │   │   ├── +page.svelte
│   │   │   │   └── [id]/
│   │   │   │       └── +page.svelte
│   │   │   ├── transactions/
│   │   │   │   └── +page.svelte
│   │   │   ├── export/
│   │   │   │   └── +page.svelte
│   │   │   └── settings/
│   │   │       └── +page.svelte
│   │   └── api/
│   │       ├── accounts/
│   │       │   ├── +server.ts
│   │       │   └── [id]/
│   │       │       ├── +server.ts
│   │       │       └── share/
│   │       │           ├── +server.ts
│   │       │           └── [shareId]/
│   │       │               └── +server.ts
│   │       ├── upload/
│   │       │   ├── preview/
│   │       │   │   └── +server.ts
│   │       │   └── +server.ts
│   │       ├── transactions/
│   │       │   ├── +server.ts
│   │       │   └── [id]/
│   │       │       ├── +server.ts
│   │       │       └── transfer/
│   │       │           └── +server.ts
│   │       ├── export/
│   │       │   └── csv/
│   │       │       └── +server.ts
│   │       └── settings/
│   │           └── +server.ts
│   └── lib/
│       ├── server/                       ← server-only code (never imported in client)
│       │   ├── db/
│       │   │   ├── index.ts              ← Drizzle client
│       │   │   └── schema.ts             ← full schema
│       │   ├── auth.ts                   ← Better Auth config
│       │   ├── parsers/
│       │   │   ├── types.ts
│       │   │   ├── index.ts              ← profile registry
│       │   │   ├── normalizer.ts
│       │   │   └── profiles/
│       │   │       ├── bbva_es.ts
│       │   │       ├── caixabank_es.ts
│       │   │       ├── bankinter_es.ts
│       │   │       ├── revolut_eu.ts
│       │   │       └── myinvestor_es.ts
│       │   ├── transfer-detector.ts
│       │   ├── balance.ts
│       │   └── ai/
│       │       └── tagger.ts             ← Phase 5
│       ├── components/
│       │   ├── ui/                       ← shadcn-svelte primitives
│       │   ├── layout/
│       │   │   ├── Sidebar.svelte
│       │   │   ├── BottomNav.svelte
│       │   │   └── Header.svelte
│       │   ├── accounts/
│       │   │   ├── AccountCard.svelte
│       │   │   └── ShareDialog.svelte
│       │   ├── transactions/
│       │   │   ├── TransactionRow.svelte
│       │   │   ├── TransactionDetail.svelte
│       │   │   └── TransferLinkDialog.svelte
│       │   ├── upload/
│       │   │   └── UploadSheet.svelte    ← multi-step sheet
│       │   └── Amount.svelte             ← shared amount display
│       └── types/
│           └── index.ts                  ← shared types
├── drizzle/
│   └── migrations/                       ← generated SQL files
├── scripts/
│   └── seed-owner.ts
├── docker-compose.yml
├── drizzle.config.ts
├── svelte.config.js
└── .env.local
```

---

## 5. Local development setup

### Docker Postgres

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    container_name: clair_db
    environment:
      POSTGRES_USER: clair
      POSTGRES_PASSWORD: clair
      POSTGRES_DB: clair
    ports:
      - "5432:5432"
    volumes:
      - clair_postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U clair"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  clair_postgres_data:
```

```bash
# Start DB
docker compose up -d

# Stop DB (keeps data)
docker compose stop

# Destroy everything
docker compose down -v
```

### Environment variables

```bash
# .env

# Local Docker DB (matches compose.yaml)
DATABASE_URL="postgres://root:mysecretpassword@localhost:5432/local"

# Better Auth
ORIGIN="http://localhost:5173"
BETTER_AUTH_SECRET="generate-with: openssl rand -base64 32"

# Email — Resend
RESEND_API_KEY="re_..."
EMAIL_FROM="noreply@clair.app"

# AI — Phase 5 only, not needed for MVP
ANTHROPIC_API_KEY="sk-ant-..."
```

### drizzle.config.ts

```typescript
import type { Config } from "drizzle-kit"

export default {
  schema: "./src/lib/server/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config
```

### Drizzle client

```typescript
// src/lib/server/db/index.ts
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

// Prevent multiple connections in dev (HMR creates new modules)
const globalForDb = globalThis as unknown as { _db?: ReturnType<typeof drizzle> }

const client = postgres(process.env.DATABASE_URL!)
export const db = globalForDb._db ?? drizzle(client, { schema })
if (process.env.NODE_ENV !== "production") globalForDb._db = db

export type DB = typeof db
```

### Seed script

```bash
# Create first owner account (run once after first migration)
npx tsx scripts/seed-owner.ts --email=you@example.com --name="Pablo" --password=yourpassword
```

---

## 6. Better Auth

Better Auth is configured server-side in `src/lib/server/auth.ts` and mounted via
`svelteKitHandler` in `src/hooks.server.ts`. No separate `/api/auth` route is needed —
the handler is injected at the hook level.

```typescript
// src/lib/server/auth.ts
import { betterAuth } from 'better-auth/minimal'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { sveltekitCookies } from 'better-auth/svelte-kit'
import { env } from '$env/dynamic/private'
import { getRequestEvent } from '$app/server'
import { db } from '$lib/server/db'

export const auth = betterAuth({
  baseURL: env.ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg' }),
  emailAndPassword: { enabled: true },
  // Custom user fields (regenerate auth.schema.ts after changes here)
  user: {
    additionalFields: {
      workspaceId: { type: 'string', required: false },
      role: { type: 'string', defaultValue: 'member' },
    },
  },
  plugins: [
    sveltekitCookies(getRequestEvent), // must be last
  ],
})
```

```typescript
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit'
import { building } from '$app/environment'
import { auth } from '$lib/server/auth'
import { svelteKitHandler } from 'better-auth/svelte-kit'

export const handle: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({ headers: event.request.headers })
  if (session) {
    event.locals.session = session.session
    event.locals.user = session.user
  }
  return svelteKitHandler({ event, resolve, auth, building })
}
```

```typescript
// src/routes/(app)/+layout.server.ts — session guard
import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login')
  return { user: locals.user }
}
```

### Auth API (server-side form actions)

```typescript
import { auth } from '$lib/server/auth'
import { APIError } from 'better-auth/api'

// Sign in (in a form action)
await auth.api.signInEmail({ body: { email, password } })

// Sign up (in a form action)
await auth.api.signUpEmail({ body: { email, password, name } })

// Sign out (in a form action)
await auth.api.signOut({ headers: event.request.headers })
```

### Regenerating the auth schema

After editing `auth.ts` (e.g. adding `user.additionalFields`), run:

```bash
npm run auth:schema   # regenerates src/lib/server/db/auth.schema.ts
npm run db:generate   # creates Drizzle migration
npm run db:migrate    # applies migration
```

> Never edit `src/lib/server/db/auth.schema.ts` directly — it is auto-generated.

---

## 7. API route conventions

All API routes live under `src/routes/api/` and export named functions for each HTTP
method. Every route validates the session and scopes DB queries to `workspace_id`.

```typescript
// Example: src/routes/api/accounts/+server.ts
import { json, error } from "@sveltejs/kit"
import type { RequestHandler } from "./$types"
import { db } from "$lib/server/db"

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) throw error(401, "Unauthorized")

  const accounts = await db.query.bankAccounts.findMany({
    where: (a, { eq, isNull }) =>
      eq(a.ownerUserId, locals.user.id) && isNull(a.deletedAt),
  })

  return json(accounts)
}
```

---

## 8. Feature summary

Full specification for each feature lives in the backend and frontend PRD files.
Use this table as a quick reference:

| Feature | Backend file section | Frontend file section |
|---|---|---|
| Auth + invite flow | §3 | §4 (Screens 1–2) |
| Bank account CRUD | §4 | §4 (Screens 4–5) |
| Account sharing (2-sided) | §5 | §4 (Screen 4) |
| CSV upload + parsing | §6 | §4 (Screen 6) |
| Balance initialisation | §6.4 | §4 (Screen 6, Step 3) |
| Deduplication | §6.5 | — |
| AI auto-tagging | §8 | §4 (Screen 7) |
| Transfer detection + linking | §7 | §4 (Screen 8, 9) |
| CSV export | §9 | §4 (Screen 10) |
| Settings | §10 | §4 (Screen 11) |

---

## 9. Build phases

| Phase | Description | Primary tool |
|---|---|---|
| **1** | Scaffold: project init, Docker, Drizzle schema, Better Auth, login, invite, seed | Claude Code |
| **2** | Bank account CRUD + sharing model | Claude Code |
| **3a** | CSV parser: `revolut_es` profile + normaliser + preview endpoint | Claude Code |
| **3b** | Remaining 4 bank profiles (one at a time, tested per profile) | Claude Code |
| **3c** | Full upload: dedup + balance init + DB write + transfer scan | Claude Code |
| **3d** | Upload Sheet UI wired to API | Claude Code |
| **4** | Transaction list + detail panel + transfer linking dialog | Claude Code |
| **5** | AI tagging via Claude Haiku + confidence thresholds + few-shot | Claude Code |
| **6** | CSV export streaming endpoint + export screen | Claude Code |
| **7** | Settings, upload history, mobile polish, empty states | Claude Code |

---

## 10. V2 roadmap (not in scope for this build)

- Enable Banking PSD2 automatic bank sync
- Daily cron jobs and re-consent flow
- Open registration + multi-workspace billing

The Drizzle schema is forward-compatible with v2. No migrations needed when adding
automatic sync — v2 only adds columns to `bank_accounts` and new enum values to
`sync_source`.