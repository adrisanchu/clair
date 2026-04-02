# Phase 2 — Account Sharing Model

> Implementation plan for issue #16.
> Updated after architectural discussion — see below for rationale.

---

## Final model

### Workspaces

Workspaces define **who is connected to whom** — the couple unit. Both users share the same `workspaceId`. They also scope shared settings: categories and CSV column mappings are workspace-level.

Workspaces are **not** the sharing mechanism. They answer "who can potentially see my accounts", not "which accounts are visible and how much."

### Account visibility

Each `bankAccount` has a `visibility` field (enum) that controls what the workspace partner can see:

| Value        | Owner       | Partner                                                                                         |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------- |
| `private`    | Full access | Cannot see the account at all                                                                   |
| `stats_only` | Full access | Sees aggregated data on dashboard (totals, category breakdown) — individual transactions hidden |
| `full`       | Full access | Sees everything, including individual transactions, and can upload CSVs                         |

Default: `private` on creation.

This replaces the `accountShares` table entirely. No pending/accepted/revoked lifecycle needed.

### Expense splits (`myPortion`)

Each transaction has an optional `myPortion` field (numeric, 0.0–1.0):

- `null` → 100% the owner's expense (default)
- `0.5` → owner paid the full amount but only half is theirs (e.g. paid for two)
- `0.33` → owner paid for three people

The dashboard uses `amount × COALESCE(myPortion, 1.0)` as the **effective expense** for the owner's personal view. This avoids building a full Splitwise-like debt-tracking system while still giving an accurate picture of personal spending.

Groups (linking transactions to other people and tracking debts/settlements) are a future phase — see issue #21.

---

## What was removed

- `accountShares` table — replaced by `bankAccounts.visibility`
- `shareStatusEnum` — no longer needed
- `canUpload` boolean — upload rights are now implicit: owner always, partner when `visibility = 'full'`

---

## Schema changes applied

### `bankAccounts`

```typescript
// Added
visibility: accountVisibilityEnum('visibility').default('private').notNull();
// 'private' | 'stats_only' | 'full'
```

### `transactions`

```typescript
// Added — null means 100% mine
myPortion: numeric('my_portion', { precision: 4, scale: 3 });
```

### Removed

- `shareStatusEnum` enum
- `accountShares` table + `accountSharesRelations`
- `sharedAccountsBy` / `sharedAccountsWith` from `userRelations`
- `shares` from `bankAccountsRelations`

---

## `access.ts` — updated helpers

### `getAccessibleAccountIds(userId)`

Returns account IDs the user can access:

- All accounts they own (any visibility, including private)
- Workspace accounts owned by others where `visibility IN ('stats_only', 'full')`

Queries by `workspaceId` — no join to `accountShares` needed.

### `canUploadToAccount(userId, accountId)` — new

Returns `true` if:

- User owns the account, OR
- User is in the same workspace AND account has `visibility = 'full'`

Used by the upload endpoint (Phase 3).

---

## Remaining implementation (not yet done)

### Step 1 — Migration

Run in a terminal (needs TTY):

```bash
npm run db:generate && npm run db:migrate
```

This will:

- Drop the `account_shares` table and `share_status` enum
- Add `visibility` column to `bank_accounts`
- Add `my_portion` column to `transactions`

### Step 2 — API: update `GET /api/accounts`

The response already returns `isOwner`. No change needed for the list — access control is already handled via `getAccessibleAccountIds`.

### Step 3 — API: `PATCH /api/accounts/[id]`

Extend the existing handler to accept `visibility` in the body (owner only). Validate against the enum values.

### Step 4 — Account Detail page (`+page.server.ts`)

Load the workspace partner's name (to display in the sharing UI):

```typescript
const partner = await db.query.authUser.findFirst({
	where: and(eq(authUser.workspaceId, user.workspaceId), ne(authUser.id, userId)),
	columns: { id: true, name: true }
});
```

Return `{ account, uploads, isOwner, partner }`.

### Step 5 — Account Detail page (`+page.svelte`)

Add a **Sharing** card between Upload History and Danger Zone (owner only):

```
SHARING
─────────────────────────────────────
○ Private         Only you can see this account
○ Stats only      María can see totals and category breakdown
● Full access     María can see all transactions and upload CSVs
```

A radio group with three options. On change, `PATCH /api/accounts/[id]` with the new visibility.

### Step 6 — BankCard: "Shared" badge

In `BankCard.svelte`, when `!account.isOwner`, show a small chip next to the account name:

```
bg-primary-100 text-primary-700  rounded-full px-2 py-0.5 text-xs  "Shared"
```

No API change needed — `isOwner` is already in the `GET /api/accounts` response.

### Step 7 — Dashboard: stats_only aggregation

When rendering dashboard data for accounts where the user is not the owner and `visibility = 'stats_only'`, return category totals and monthly summaries only — no individual transactions. The transaction list endpoint should return an empty array for these accounts when the requester is not the owner.

---

## Future: expense groups (issue #21)

A future phase will add proper group expense tracking:

- `groups` table: `id, name, workspaceId`
- `group_members` table: `groupId, userId` (supports external people by name/email)
- Transactions can be tagged with a `groupId`
- Settlement tracking within the group

The `myPortion` field on transactions is designed to work independently of groups — it can be set manually without a group, or derived automatically from a group split in the future.
