# Clair — Product Requirements Document
## File 2 of 3: Backend & Database
**Version:** 1.0

> Read `clair-prd-main.md` first for stack decisions, project structure, and Better Auth
> setup. This file covers everything that runs on the server: the full Drizzle schema,
> all API routes, CSV parsing, transfer detection, AI tagging, and CSV export.

---

## 1. Database schema (Drizzle)

**Schema split:** Better Auth auto-generates `src/lib/server/db/auth.schema.ts` (tables:
`user`, `session`, `account`, `verification`). Never edit that file directly — run
`npm run auth:schema` after changes to `auth.ts`. The business schema below lives in
`src/lib/server/db/schema.ts` and imports from `auth.schema.ts`.

Custom user fields (`workspaceId`, `role`) are added via `user.additionalFields` in
`auth.ts` — they end up in the Better Auth `user` table after regenerating the schema.
No separate `users` table is needed; all tables reference `user.id` (singular, from
`auth.schema.ts`).

```typescript
// src/lib/server/db/schema.ts
import {
  pgTable, pgEnum, text, timestamp, boolean,
  numeric, integer, uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core"
import { relations } from "drizzle-orm"
import { user } from "./auth.schema"   // Better Auth user table

export * from "./auth.schema"          // re-export auth tables

// ─── Enums ────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["owner", "member"])

export const accountStatusEnum = pgEnum("account_status", ["no_data", "active"])

export const shareStatusEnum = pgEnum("share_status",
  ["pending", "accepted", "declined", "revoked"])

export const transactionStatusEnum = pgEnum("transaction_status",
  ["pending", "posted", "review"])

export const syncSourceEnum = pgEnum("sync_source",
  ["csv_upload", "cron", "manual"])  // cron + manual reserved for v2

// ─── Workspaces ───────────────────────────────────────────────────────────────

export const workspaces = pgTable("workspaces", {
  id:        text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:      text("name").notNull(),
  ownerId:   text("owner_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
})

// ─── Users ────────────────────────────────────────────────────────────────────
// The `user` table is managed by Better Auth (auth.schema.ts).
// workspaceId and role are added as user.additionalFields in auth.ts.
// Passwords are stored in Better Auth's `account` table — no passwordHash here.
// All tables below reference user.id from the Better Auth user table.

// ─── Invites ──────────────────────────────────────────────────────────────────

export const invites = pgTable("invites", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id").notNull()
                 .references(() => workspaces.id),
  email:       text("email").notNull(),
  tokenHash:   text("token_hash").notNull().unique(),
  invitedById: text("invited_by_id").notNull()
                 .references(() => user.id),
  expiresAt:   timestamp("expires_at").notNull(),
  usedAt:      timestamp("used_at"),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
})

// ─── Bank accounts ────────────────────────────────────────────────────────────

export const bankAccounts = pgTable("bank_accounts", {
  id:              text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerUserId:     text("owner_user_id").notNull()
                     .references(() => user.id),
  workspaceId:     text("workspace_id").notNull()
                     .references(() => workspaces.id),
  displayName:     text("display_name").notNull(),
  institutionName: text("institution_name").notNull(),
  bankProfileId:   text("bank_profile_id").notNull(),
  ibanLast4:       text("iban_last4").notNull(),
  currency:        text("currency").default("EUR").notNull(),
  currentBalance:  numeric("current_balance", { precision: 15, scale: 4 })
                     .default("0").notNull(),
  status:          accountStatusEnum("status").default("no_data").notNull(),
  deletedAt:       timestamp("deleted_at"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
})

// ─── Account shares ───────────────────────────────────────────────────────────

export const accountShares = pgTable("account_shares", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bankAccountId: text("bank_account_id").notNull()
                   .references(() => bankAccounts.id),
  sharedById:    text("shared_by_id").notNull()
                   .references(() => user.id),
  sharedWithId:  text("shared_with_id").notNull()
                   .references(() => user.id),
  status:        shareStatusEnum("status").default("pending").notNull(),
  requestedAt:   timestamp("requested_at").defaultNow().notNull(),
  respondedAt:   timestamp("responded_at"),
})

// ─── CSV uploads ──────────────────────────────────────────────────────────────

export const csvUploads = pgTable("csv_uploads", {
  id:             text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bankAccountId:  text("bank_account_id").notNull()
                    .references(() => bankAccounts.id),
  userId:         text("user_id").notNull()
                    .references(() => user.id),
  filename:       text("filename").notNull(),
  bankProfileId:  text("bank_profile_id").notNull(),
  rowCount:       integer("row_count").notNull(),
  importedCount:  integer("imported_count").notNull(),
  duplicateCount: integer("duplicate_count").notNull(),
  flaggedCount:   integer("flagged_count").notNull(),
  openingBalance: numeric("opening_balance", { precision: 15, scale: 4 }),
  dateRangeFrom:  timestamp("date_range_from", { mode: "date" }),
  dateRangeTo:    timestamp("date_range_to",   { mode: "date" }),
  uploadedAt:     timestamp("uploaded_at").defaultNow().notNull(),
})

// ─── Transactions ─────────────────────────────────────────────────────────────

export const transactions = pgTable("transactions", {
  id:                    text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  bankAccountId:         text("bank_account_id").notNull()
                           .references(() => bankAccounts.id),
  csvUploadId:           text("csv_upload_id")
                           .references(() => csvUploads.id),
  externalId:            text("external_id"),

  bookingDate:           timestamp("booking_date", { mode: "date" }).notNull(),
  valueDate:             timestamp("value_date", { mode: "date" }),

  amount:                numeric("amount", { precision: 15, scale: 4 }).notNull(),
  currency:              text("currency").notNull(),
  amountEur:             numeric("amount_eur", { precision: 15, scale: 4 }),
  amountOriginal:        numeric("amount_original", { precision: 15, scale: 4 }),
  currencyOriginal:      text("currency_original"),

  description:           text("description").notNull(),
  creditorName:          text("creditor_name"),
  debtorName:            text("debtor_name"),

  // AI tagging
  category:              text("category"),
  categoryConfidence:    numeric("category_confidence", { precision: 4, scale: 3 }),
  categoryOverride:      text("category_override"),
  categoryOverrideById:  text("category_override_by_id")
                           .references(() => user.id),

  // Transfer linking — self-referential, set via UPDATE after insert
  isTransfer:            boolean("is_transfer").default(false).notNull(),
  transferCounterpartId: text("transfer_counterpart_id"),
  transferLinkedById:    text("transfer_linked_by_id")
                           .references(() => user.id),
  transferLinkedAt:      timestamp("transfer_linked_at"),

  isOpeningBalance:      boolean("is_opening_balance").default(false).notNull(),
  payerUserId:           text("payer_user_id").notNull()
                           .references(() => user.id),
  tags:                  text("tags").array().default([]).notNull(),

  status:                transactionStatusEnum("status").default("posted").notNull(),
  syncSource:            syncSourceEnum("sync_source").default("csv_upload").notNull(),

  createdAt:             timestamp("created_at").defaultNow().notNull(),
  updatedAt:             timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  dedupIdx:    uniqueIndex("transactions_dedup_idx")
                 .on(t.bankAccountId, t.externalId),
  dateIdx:     index("transactions_date_idx")
                 .on(t.bankAccountId, t.bookingDate),
  transferIdx: index("transactions_transfer_idx")
                 .on(t.transferCounterpartId),
}))

// ─── Per-user category overrides (for shared accounts) ────────────────────────

export const transactionOverrides = pgTable("transaction_overrides", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  transactionId: text("transaction_id").notNull()
                   .references(() => transactions.id),
  userId:        text("user_id").notNull()
                   .references(() => user.id),
  category:      text("category").notNull(),
  tags:          text("tags").array().default([]).notNull(),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqueIdx: uniqueIndex("tx_override_user_idx").on(t.transactionId, t.userId),
}))

// ─── Categories ───────────────────────────────────────────────────────────────

export const categories = pgTable("categories", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id").notNull()
                 .references(() => workspaces.id),
  name:        text("name").notNull(),
  color:       text("color").default("#6b7280").notNull(),
  sortOrder:   integer("sort_order").default(0).notNull(),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
})

// ─── CSV column mappings ──────────────────────────────────────────────────────

export const csvColumnMappings = pgTable("csv_column_mappings", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspaceId: text("workspace_id").notNull()
                 .references(() => workspaces.id),
  columnKey:   text("column_key").notNull(),
  columnLabel: text("column_label").notNull(),
  sortOrder:   integer("sort_order").notNull(),
  enabled:     boolean("enabled").default(true).notNull(),
})

// ─── Drizzle relations (for query builder) ────────────────────────────────────

export const workspacesRelations = relations(workspaces, ({ one, many }) => ({
  owner:             one(user, { fields: [workspaces.ownerId],   references: [user.id] }),
  bankAccounts:      many(bankAccounts),
  categories:        many(categories),
  csvColumnMappings: many(csvColumnMappings),
}))

export const userRelations = relations(user, ({ many }) => ({
  bankAccounts:         many(bankAccounts),
  sentShares:           many(accountShares, { relationName: "SharedBy" }),
  receivedShares:       many(accountShares, { relationName: "SharedWith" }),
  transactionOverrides: many(transactionOverrides),
  csvUploads:           many(csvUploads),
}))

export const bankAccountsRelations = relations(bankAccounts, ({ one, many }) => ({
  owner:       one(user,       { fields: [bankAccounts.ownerUserId],   references: [user.id] }),
  workspace:   one(workspaces, { fields: [bankAccounts.workspaceId],   references: [workspaces.id] }),
  transactions: many(transactions),
  shares:      many(accountShares),
  csvUploads:  many(csvUploads),
}))

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  bankAccount:   one(bankAccounts, { fields: [transactions.bankAccountId], references: [bankAccounts.id] }),
  csvUpload:     one(csvUploads,   { fields: [transactions.csvUploadId],   references: [csvUploads.id] }),
  payer:         one(user,         { fields: [transactions.payerUserId],   references: [user.id] }),
  counterpart:   one(transactions, { fields: [transactions.transferCounterpartId], references: [transactions.id], relationName: "TransferPair" }),
  overrides:     many(transactionOverrides),
}))
```

---

## 2. Migrations

```bash
# After editing auth.ts (user additional fields), regenerate auth schema first:
npm run auth:schema

# After editing schema.ts, generate a Drizzle migration:
npm run db:generate   # or: npx drizzle-kit generate

# Apply pending migrations to the DB:
npm run db:migrate    # or: npx drizzle-kit migrate

# Open Drizzle Studio (DB GUI):
npm run db:studio     # or: npx drizzle-kit studio
```

---

## 3. Auth & user management

Registration is invite-only. There is no open registration endpoint.
Sign-up happens only via the invite flow (see below). The first owner account is
created with the seed script (`npx tsx scripts/seed-owner.ts ...`), which calls
`auth.api.signUpEmail` server-side and then sets `role: 'owner'` in the DB.

### Invite flow

```typescript
// POST /api/invites
// Owner only. Creates a single-use invite token.
import { randomBytes, createHash } from "crypto"

const rawToken   = randomBytes(32).toString("hex")
const tokenHash  = createHash("sha256").update(rawToken).digest("hex")
const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)  // 7 days

await db.insert(invites).values({
  workspaceId: locals.user.workspaceId,
  email,
  tokenHash,
  invitedById: locals.user.id,
  expiresAt,
})

// Send email with link: https://clair.app/invite/${rawToken}
```

```typescript
// GET /invite/[token]/+page.server.ts — validate token on page load
const tokenHash = createHash("sha256").update(params.token).digest("hex")
const invite    = await db.query.invites.findFirst({
  where: (i, { eq, isNull, gt }) =>
    eq(i.tokenHash, tokenHash) && isNull(i.usedAt) && gt(i.expiresAt, new Date()),
})
if (!invite) throw redirect(303, "/login?error=invalid_invite")
```

---

## 4. Bank account management

### Access control rule (enforced on every query)

A user can access a bank account if:
- `bank_accounts.owner_user_id = current_user.id`  
- OR `account_shares` exists where `shared_with_id = current_user.id AND status = 'accepted'`

```typescript
// src/lib/server/db/access.ts
import { db } from "./index"
import { bankAccounts, accountShares } from "./schema"
import { eq, or, and, isNull } from "drizzle-orm"

export async function getAccessibleAccountIds(userId: string): Promise<string[]> {
  const owned = await db
    .select({ id: bankAccounts.id })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.ownerUserId, userId), isNull(bankAccounts.deletedAt)))

  const shared = await db
    .select({ id: accountShares.bankAccountId })
    .from(accountShares)
    .where(and(
      eq(accountShares.sharedWithId, userId),
      eq(accountShares.status, "accepted"),
    ))

  return [...owned, ...shared].map(r => r.id)
}
```

### Share flow

```
POST /api/accounts/[id]/share
  body: { sharedWithId: string }
  → creates account_shares row with status='pending'
  → sends in-app notification (store in DB or use polling)

PATCH /api/accounts/[id]/share/[shareId]
  body: { status: 'accepted' | 'declined' | 'revoked' }
  → updates account_shares.status + respondedAt
```

---

## 5. CSV upload & parsing

### Bank parser profile type

```typescript
// src/lib/server/parsers/types.ts
export interface BankParserProfile {
  bankProfileId:      string
  displayName:        string
  encoding:           string        // "utf-8" | "iso-8859-1"
  delimiter:          string        // "," | ";"
  skipRows:           number        // metadata rows before the header row
  dateColumn:         string
  dateFormat:         string        // "DD/MM/YYYY" | "DD-MM-YYYY" | "YYYY-MM-DD HH:mm:ss"
  amountColumn:       string | null
  debitColumn:        string | null
  creditColumn:       string | null
  descriptionColumn:  string
  currencyColumn:     string | null
  localAmountColumn:  string | null
  balanceColumn:      string | null
}

export interface NormalizedTransaction {
  bookingDate:      Date
  amount:           number
  currency:         string
  amountOriginal:   number
  currencyOriginal: string
  description:      string
  runningBalance:   number | null
}
```

### Bank profiles

**Implement one profile at a time. Test against a real export before adding the next.**

| Bank | Profile ID | Encoding | Date format | Amount | Balance col |
|---|---|---|---|---|---|
| BBVA | `bbva_es` | UTF-8 | `DD/MM/YYYY` | Single signed, comma decimal | Sometimes |
| CaixaBank | `caixabank_es` | ISO-8859-1 | `DD/MM/YYYY` | Split debit + credit | No |
| Bankinter | `bankinter_es` | UTF-8 | `DD-MM-YYYY` | Single signed, period decimal | Yes |
| Revolut | `revolut_eu` | UTF-8 | `YYYY-MM-DD HH:mm:ss` | Single signed + local amount | No |
| MyInvestor | `myinvestor_es` | UTF-8 | `DD/MM/YYYY` | Single signed, period decimal | No |

### Normaliser

```typescript
// src/lib/server/parsers/normalizer.ts
import type { BankParserProfile, NormalizedTransaction } from "./types"
import { parse as parseDate } from "date-fns"

export function normalizeRow(
  row: Record<string, string>,
  profile: BankParserProfile,
): NormalizedTransaction {
  const amount = profile.amountColumn
    ? parseAmount(row[profile.amountColumn])
    : parseAmount(row[profile.creditColumn!]) - parseAmount(row[profile.debitColumn!])

  return {
    bookingDate:      parseDate(
                        row[profile.dateColumn],
                        profile.dateFormat.replace("DD","dd").replace("YYYY","yyyy"),
                        new Date()
                      ),
    amount,
    currency:         profile.currencyColumn ? row[profile.currencyColumn] : "EUR",
    amountOriginal:   profile.localAmountColumn
                        ? parseAmount(row[profile.localAmountColumn])
                        : amount,
    currencyOriginal: profile.currencyColumn ? row[profile.currencyColumn] : "EUR",
    description:      row[profile.descriptionColumn].trim(),
    runningBalance:   profile.balanceColumn
                        ? parseAmount(row[profile.balanceColumn])
                        : null,
  }
}

function parseAmount(raw: string): number {
  if (!raw) return 0
  // Handle both "1.234,56" and "1,234.56" formats
  const cleaned = raw.trim().replace(/\s/g, "")
  const hasCommaDecimal = /\d,\d{2}$/.test(cleaned)
  const normalised = hasCommaDecimal
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned.replace(/,/g, "")
  return parseFloat(normalised) || 0
}
```

### Upload API — two steps

```
POST /api/upload/preview
  - Accept: multipart/form-data with `file` + `bankProfileId`
  - Parse file using the profile (PapaParse + chardet for encoding)
  - Return first 10 normalised rows + total row count + date range
  - Do NOT write to DB
  - Max file size: 10 MB

POST /api/upload
  - Accept: multipart/form-data with `file` + `bankProfileId`
               + `bankAccountId` + optional `currentBalance`
  - Full pipeline:
      1. Parse all rows → normalise
      2. Deduplicate against existing DB rows (see §5.4)
      3. Balance initialisation (see §5.5)
      4. Insert new transactions to DB
      5. Create csv_uploads record
      6. Update bank_accounts.current_balance
      7. Run transfer auto-detection (see §6)
  - Return: { imported, duplicates, flagged, unresolvedTransfers[] }
```

### Deduplication

```typescript
// Run before DB insert, per row
async function isDuplicate(
  row: NormalizedTransaction,
  bankAccountId: string,
  externalId?: string,
): Promise<"skip" | "update" | "insert" | "review"> {

  // Priority 1: externalId match
  if (externalId) {
    const existing = await db.query.transactions.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.bankAccountId, bankAccountId), eq(t.externalId, externalId)),
    })
    if (existing) return "skip"
  }

  // Priority 2: date + amount + description hash
  const descHash = createHash("md5").update(row.description).digest("hex")
  const sameExact = await db.query.transactions.findFirst({
    where: (t, { and, eq, sql }) =>
      and(
        eq(t.bankAccountId, bankAccountId),
        eq(t.bookingDate, row.bookingDate),
        sql`${t.amount} = ${row.amount}`,
        sql`md5(${t.description}) = ${descHash}`,
      ),
  })
  if (sameExact) return "skip"

  // Priority 3: date + amount, description differs
  const sameAmountDate = await db.query.transactions.findMany({
    where: (t, { and, eq, sql }) =>
      and(
        eq(t.bankAccountId, bankAccountId),
        eq(t.bookingDate, row.bookingDate),
        sql`${t.amount} = ${row.amount}`,
      ),
  })
  if (sameAmountDate.length === 1) return "update"  // update description
  if (sameAmountDate.length > 1)  return "review"   // ambiguous — flag

  return "insert"
}
```

### Balance initialisation

```typescript
// src/lib/server/balance.ts

// Called during POST /api/upload when no balance column is in the profile
export async function computeOpeningBalance(
  bankAccountId: string,
  enteredCurrentBalance: number,
  uploadedRows: NormalizedTransaction[],
): Promise<number> {
  const existingSum = await db
    .select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(transactions)
    .where(eq(transactions.bankAccountId, bankAccountId))

  const uploadSum = uploadedRows.reduce((acc, r) => acc + r.amount, 0)
  const existing  = parseFloat(existingSum[0].sum)

  return enteredCurrentBalance - uploadSum - existing
}

// Upsert the synthetic opening balance transaction
export async function upsertOpeningBalance(
  bankAccountId: string,
  openingAmount: number,
  earliestDate: Date,
  userId: string,
) {
  const openingDate = new Date(earliestDate)
  openingDate.setDate(openingDate.getDate() - 1)

  await db
    .insert(transactions)
    .values({
      bankAccountId,
      bookingDate:      openingDate,
      amount:           openingAmount.toString(),
      currency:         "EUR",
      description:      "Opening balance (system)",
      category:         "balance_adjustment",
      isOpeningBalance: true,
      payerUserId:      userId,
      status:           "posted",
      syncSource:       "csv_upload",
    })
    .onConflictDoUpdate({
      target:  [transactions.bankAccountId, transactions.isOpeningBalance],
      set:     { amount: openingAmount.toString(), updatedAt: new Date() },
    })
}

// Recompute and store current balance after every upload
export async function refreshCurrentBalance(bankAccountId: string) {
  const result = await db
    .select({ sum: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(transactions)
    .where(eq(transactions.bankAccountId, bankAccountId))

  await db
    .update(bankAccounts)
    .set({ currentBalance: result[0].sum })
    .where(eq(bankAccounts.id, bankAccountId))
}
```

---

## 6. Transfer detection & linking

### Auto-detection (runs after every upload)

```typescript
// src/lib/server/transfer-detector.ts
import { db } from "./db"
import { transactions } from "./db/schema"
import { and, eq, ne, isNull, gte, lte, sql, inArray } from "drizzle-orm"
import { subDays, addDays } from "date-fns"

export interface TransferMatch {
  sourceId:    string
  candidateId: string | null      // null = no match found
  candidates:  TransferCandidate[] // empty if auto-linked
}

export interface TransferCandidate {
  id:          string
  bookingDate: Date
  amount:      number
  description: string
  accountName: string
  daysDiff:    number
}

export async function detectAndLinkTransfers(
  newTransactionIds: string[],
  accessibleAccountIds: string[],
  linkedById: string,
): Promise<TransferMatch[]> {

  // Find newly inserted transfer-flagged transactions without a counterpart
  const sources = await db.select().from(transactions).where(and(
    inArray(transactions.id, newTransactionIds),
    eq(transactions.isTransfer, true),
    isNull(transactions.transferCounterpartId),
    eq(transactions.isOpeningBalance, false),
  ))

  const results: TransferMatch[] = []

  for (const source of sources) {
    const candidates = await db.select({
      id:          transactions.id,
      bookingDate: transactions.bookingDate,
      amount:      transactions.amount,
      description: transactions.description,
      bankAccountId: transactions.bankAccountId,
      daysDiff: sql<number>`ABS(EXTRACT(DAY FROM (
        ${transactions.bookingDate} - ${source.bookingDate}::date
      )))`,
    })
    .from(transactions)
    .where(and(
      ne(transactions.bankAccountId, source.bankAccountId),
      inArray(transactions.bankAccountId, accessibleAccountIds),
      sql`ABS(${transactions.amount}) = ABS(${source.amount})`,
      sql`SIGN(${transactions.amount}::numeric) != SIGN(${source.amount}::numeric)`,
      gte(transactions.bookingDate, subDays(source.bookingDate, 3)),
      lte(transactions.bookingDate, addDays(source.bookingDate, 3)),
      isNull(transactions.transferCounterpartId),
      eq(transactions.isOpeningBalance, false),
    ))
    .orderBy(
      sql`ABS(EXTRACT(DAY FROM (${transactions.bookingDate} - ${source.bookingDate}::date)))`
    )
    .limit(5)

    if (candidates.length === 1) {
      // Perfect match — auto-link both rows
      await linkPair(source.id, candidates[0].id, linkedById)
      results.push({ sourceId: source.id, candidateId: candidates[0].id, candidates: [] })
    } else {
      // 0 or multiple — surface to UI
      results.push({
        sourceId:    source.id,
        candidateId: null,
        candidates:  candidates.map(c => ({
          id:          c.id,
          bookingDate: c.bookingDate,
          amount:      parseFloat(c.amount as unknown as string),
          description: c.description,
          accountName: c.bankAccountId, // replace with display name in join
          daysDiff:    c.daysDiff,
        })),
      })
    }
  }

  return results
}

export async function linkPair(idA: string, idB: string, linkedById: string) {
  const now = new Date()
  await db.batch([
    db.update(transactions)
      .set({ isTransfer: true, transferCounterpartId: idB,
             transferLinkedById: linkedById, transferLinkedAt: now })
      .where(eq(transactions.id, idA)),
    db.update(transactions)
      .set({ isTransfer: true, transferCounterpartId: idA,
             transferLinkedById: linkedById, transferLinkedAt: now })
      .where(eq(transactions.id, idB)),
  ])
}

export async function unlinkPair(idA: string) {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, idA),
  })
  if (!tx?.transferCounterpartId) return

  await db.batch([
    db.update(transactions)
      .set({ isTransfer: false, transferCounterpartId: null,
             transferLinkedById: null, transferLinkedAt: null })
      .where(eq(transactions.id, idA)),
    db.update(transactions)
      .set({ isTransfer: false, transferCounterpartId: null,
             transferLinkedById: null, transferLinkedAt: null })
      .where(eq(transactions.id, tx.transferCounterpartId)),
  ])
}
```

---

## 7. Transaction queries

### Category display priority

When displaying a transaction's category to user U, apply in order:
1. `transaction_overrides.category` where `user_id = U`
2. `transactions.category_override` (owner's correction)
3. `transactions.category` (AI-assigned)

```typescript
// Helper to resolve effective category for a user
export function effectiveCategory(
  tx: typeof transactions.$inferSelect,
  override: typeof transactionOverrides.$inferSelect | undefined
): string | null {
  return override?.category ?? tx.categoryOverride ?? tx.category ?? null
}
```

### List endpoint

```
GET /api/transactions
  Query params:
    accountIds   string[]   filter by account (comma-separated)
    category     string     filter by category
    from         string     ISO date
    to           string     ISO date
    amountMin    number
    amountMax    number
    status       string     'posted' | 'review' | 'pending'
    tab          string     'all' | 'expenses' | 'transfers' | 'review'
    page         number     default 1
    pageSize     number     default 25

  Returns:
    { transactions: Transaction[], total: number, page: number }

  Note: always exclude is_opening_balance=true rows from the list.
  Note: apply access control — only return transactions for accessible accounts.
```

---

## 8. AI auto-tagging (Phase 5)

*Add after the CSV pipeline is stable. Not required for MVP.*

### Default categories (stored in DB per workspace at seed time)

```
restaurants · coffee · groceries · transport · travel · sports
health · subscriptions · transfers · savings · shopping · utilities · income · other
```

Internal only (hidden from UI): `balance_adjustment`

### Tagger

```typescript
// src/lib/server/ai/tagger.ts
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()

export interface TagInput {
  id:          string
  description: string
  amount:      number
  currency:    string
}

export interface TagResult {
  id:         string
  category:   string
  confidence: number
  isTransfer: boolean
}

export async function tagBatch(
  items: TagInput[],
  categories: string[],
  fewShot: string,
): Promise<TagResult[]> {
  const res = await client.messages.create({
    model:      "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [{
      role:    "user",
      content: `You are a personal finance transaction classifier for a Spanish user.
Return ONLY a valid JSON array. No explanation, no markdown.

${fewShot ? `Known corrections:\n${fewShot}\n` : ""}
Categories: ${categories.join(", ")}

Classify these ${items.length} transactions:
${JSON.stringify(items)}

Each item: {"id":"...","category":"...","confidence":0.00,"isTransfer":false}`,
    }],
  })

  const text = res.content[0].type === "text" ? res.content[0].text : "[]"
  return JSON.parse(text)
}

// Confidence thresholds
export function getStatusFromConfidence(
  confidence: number
): "posted" | "review" {
  return confidence >= 0.60 ? "posted" : "review"
}
```

Batch size: 20 transactions per API call.

### Few-shot accumulation

```typescript
// Build few-shot string from last 50 workspace overrides
export async function buildFewShot(workspaceId: string): Promise<string> {
  const overrides = await db
    .select({
      description: transactions.description,
      category:    transactionOverrides.category,
    })
    .from(transactionOverrides)
    .innerJoin(transactions, eq(transactionOverrides.transactionId, transactions.id))
    .innerJoin(bankAccounts,  eq(transactions.bankAccountId, bankAccounts.id))
    .where(eq(bankAccounts.workspaceId, workspaceId))
    .orderBy(desc(transactionOverrides.updatedAt))
    .limit(50)

  if (overrides.length < 5) return ""

  return overrides
    .map(o => `- "${o.description}" → ${o.category}`)
    .join("\n")
}
```

---

## 9. CSV export

```typescript
// src/routes/api/export/csv/+server.ts
import { error } from "@sveltejs/kit"
import type { RequestHandler } from "./$types"

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.user) throw error(401)

  const accountIds     = url.searchParams.get("accountIds")?.split(",") ?? []
  const from           = url.searchParams.get("from")
  const to             = url.searchParams.get("to")
  const includeTransfers = url.searchParams.get("includeTransfers") === "true"

  // Validate accountIds belong to accessible accounts
  const accessible = await getAccessibleAccountIds(locals.user.id)
  const filtered   = accountIds.filter(id => accessible.includes(id))
  if (filtered.length === 0) throw error(400, "No accessible accounts selected")

  // Stream CSV
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()

      // Header row
      controller.enqueue(enc.encode("Date,Description,Amount,Currency,Category,Account,Payer,Tags\n"))

      let offset = 0
      const batchSize = 500

      while (true) {
        const rows = await db
          .select({ /* ... relevant fields ... */ })
          .from(transactions)
          .where(and(
            inArray(transactions.bankAccountId, filtered),
            eq(transactions.isOpeningBalance, false),
            includeTransfers ? undefined : eq(transactions.isTransfer, false),
            from ? gte(transactions.bookingDate, new Date(from)) : undefined,
            to   ? lte(transactions.bookingDate, new Date(to))   : undefined,
          ))
          .orderBy(desc(transactions.bookingDate))
          .limit(batchSize)
          .offset(offset)

        if (rows.length === 0) break

        for (const row of rows) {
          const line = [
            row.bookingDate.toISOString().split("T")[0],
            `"${row.description.replace(/"/g, '""')}"`,
            row.amount,
            row.currency,
            row.categoryOverride ?? row.category ?? "",
            row.bankAccountId,
            row.payerUserId,
            row.tags.join(", "),
          ].join(",") + "\n"
          controller.enqueue(enc.encode(line))
        }

        offset += batchSize
        if (rows.length < batchSize) break
      }

      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clair-export-${new Date().toISOString().split("T")[0]}.csv"`,
    },
  })
}
```

---

## 10. API route summary

| Method | Path | Auth required | Description |
|---|---|---|---|
| POST | `/api/invites` | Owner | Create invite |
| GET | `/api/accounts` | Yes | List accessible accounts |
| POST | `/api/accounts` | Yes | Create account |
| GET | `/api/accounts/[id]` | Yes | Account detail |
| PATCH | `/api/accounts/[id]` | Owner | Update display name |
| DELETE | `/api/accounts/[id]` | Owner | Soft delete |
| POST | `/api/accounts/[id]/share` | Owner | Create share request |
| PATCH | `/api/accounts/[id]/share/[shareId]` | Yes | Accept/decline/revoke |
| POST | `/api/upload/preview` | Yes | Parse CSV, no DB write |
| POST | `/api/upload` | Yes | Full ingest |
| GET | `/api/transactions` | Yes | List (paginated, filtered) |
| PATCH | `/api/transactions/[id]` | Yes | Update category/tags |
| POST | `/api/transactions/[id]/transfer` | Yes | Mark + link transfer |
| DELETE | `/api/transactions/[id]/transfer` | Yes | Unlink transfer pair |
| GET | `/api/export/csv` | Yes | Stream CSV download |
| GET | `/api/settings` | Yes | Workspace settings |
| PATCH | `/api/settings` | Owner | Update categories/columns |