# Clair

Personal finance aggregator for couples. Upload bank CSVs, let AI tag your transactions, and export a clean unified CSV — all in a private, invite-only app.

## Vision

Clair brings clarity to the finances of individuals and families who juggle multiple bank providers. When transactions live across different accounts, with different categorizations, or even in different currencies, it's hard to put the numbers together and answer everyday questions like _"How much did I spend on groceries over the past 3 months?"_ or _"What can I cut right now to save more this year?"_. Clair pulls it all into one place so those patterns become obvious.

Three principles guide the product:

1. **No bank integrations.** You upload your own data manually. No credentials, no third-party account access — you decide exactly what goes in.
2. **Your data, always in control.** Import, process, and export freely, so you can keep working with your data from whatever tool you prefer.
3. **Extensive, incremental features.** Start simple with a single account, and unlock more as your setup grows.

### Feature ladder

Single account — the core loop:

1. Create a bank account
2. Upload bank CSVs
3. Auto-detect duplicated transactions within the account
4. AI-tag transactions
5. Export a clean CSV

Once a second account joins:

- **Transfers between accounts** — link a transaction to its counterpart in another account so the pair nets out instead of counting as separate income and expense.
- **Cross-currency conversions** — derive an FX rate from a linked transfer and apply it to the rest of that period's expenses.
- **Cost groups** — group transactions across accounts and categories to understand a habit or a one-off project (e.g. a trip).
- **Split transactions & account sharing** — invite collaborators with view-only or view-and-edit access, for families and companies sharing expenses across owners.

### What Clair is not

Clair is not a bank, a fraud-risk agency, or a financial entity — it's a tool to organize your personal finances. It does nothing with your data unless you consent: the AI tagging model may learn from other users' categorizations, but only from those who opt in to sharing.

## Stack

| Layer      | Choice                                            |
| ---------- | ------------------------------------------------- |
| Framework  | SvelteKit 2.x + Svelte 5 runes                    |
| Language   | TypeScript (strict)                               |
| Styling    | Tailwind CSS v4                                   |
| Components | shadcn-svelte                                     |
| Auth       | Better Auth ~1.4 (email + password)               |
| ORM        | Drizzle ORM + `postgres` driver                   |
| Database   | PostgreSQL — Docker Compose (local) / Neon (prod) |
| AI         | Anthropic Claude Haiku (Phase 5)                  |
| Email      | Resend (invite flow)                              |
| Deploy     | Vercel                                            |

## Quickstart

### Prerequisites

- Node.js 20+
- Docker (for local Postgres)

### First-time setup

```bash
# 1. Start the database
docker compose up -d

# 2. Install dependencies
npm install

# 3. Copy and fill in environment variables
cp .env.example .env   # then edit .env

# 4. Generate the Better Auth schema and run migrations
npm run auth:schema
npm run db:generate
npm run db:migrate

# 5. Seed the owner account (run once)
npx tsx scripts/seed-owner.ts --email=you@example.com --name="Your Name" --password=yourpassword

# 6. Start the dev server
npm run dev
```

### Daily workflow

```bash
docker compose up -d   # ensure DB is running
npm run dev
```

## Local database environments

Two independent Postgres containers share the same image but use separate volumes so they can run side by side:

| Environment | Compose file | Container | Host port | Purpose |
|-------------|-------------|-----------|-----------|---------|
| **Dev** | `compose.yaml` | `clair_db` | 5432 | Primary workspace with real data (close-to-prod) |
| **Test** | `compose.test.yaml` | `clair_db_test` | 5433 | Empty DB for testing new features / breaking changes |

### Running against dev (default)

```bash
docker compose up -d
npm run dev                 # uses DATABASE_URL from .env (port 5432)
```

### Running against test

```bash
docker compose -f compose.test.yaml up -d
DATABASE_URL="postgres://root:mysecretpassword@localhost:5433/local" npm run dev
```

### First-time test DB setup

```bash
docker compose -f compose.test.yaml up -d

# Apply migrations
for f in drizzle/migrations/0*.sql; do
  sed 's/--> statement-breakpoint//g' "$f" | docker exec -i clair_db_test psql -U root -d local
done

# Seed a test user
DATABASE_URL="postgres://root:mysecretpassword@localhost:5433/local" \
  npx tsx scripts/seed-owner.ts --email=test@test.com --name="Test" --password=test1234
```

### Tear down test (without affecting dev)

```bash
docker compose -f compose.test.yaml down -v
```

## Useful commands

| Command                  | Description                                           |
| ------------------------ | ----------------------------------------------------- |
| `npm run dev`            | Start dev server at `localhost:5173`                  |
| `npm run build`          | Build for production                                  |
| `npm run preview`        | Preview the production build                          |
| `npm run auth:schema`    | Regenerate `auth.schema.ts` after editing `auth.ts`   |
| `npm run db:generate`    | Generate a new Drizzle migration after schema changes |
| `npm run db:migrate`     | Apply pending migrations to the database              |
| `npm run db:studio`      | Open Drizzle Studio (DB GUI) at `localhost:4983`      |
| `docker compose down -v` | Destroy the dev DB and all data (full reset)          |

## Environment variables

```bash
DATABASE_URL="postgres://root:mysecretpassword@localhost:5432/local"
ORIGIN="http://localhost:5173"
BETTER_AUTH_SECRET=""        # generate: openssl rand -base64 32
RESEND_API_KEY="re_..."
EMAIL_FROM="noreply@clair.app"
ANTHROPIC_API_KEY="sk-ant-..."   # Phase 5 only
```
