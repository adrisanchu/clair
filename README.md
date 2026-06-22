# Clair

Personal finance aggregator for couples. Upload bank CSVs, let AI tag your transactions, and export a clean unified CSV — all in a private, invite-only app.

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
