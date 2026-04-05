# Clair — Multi-Currency Management

## Overview

This document specifies the full implementation of multi-currency support in Clair. The goal is to allow foreign-currency accounts (e.g. Revolut SEK) to coexist with EUR-denominated accounts, with all transactions ultimately expressible in EUR for unified reporting — without requiring the user to manually enter conversion rates in most cases.

---

## Mental Model

- Every account has a **native currency** (e.g. EUR, SEK, USD).
- Every transaction is stored in its **native amount** (what the bank actually shows).
- For non-EUR transactions, Clair also stores the **EUR equivalent** and the **exchange rate** used to compute it.
- Exchange rates are not fetched from an external API in real time — they are **locked at the time the user funded the foreign account**, derived from the actual transfer transaction between accounts.
- If a rate cannot be automatically derived, the system flags the affected transactions as **unresolved** and prompts the user to confirm or enter a rate manually.

---

## 1. Database Schema

### 1.1 Extend `core.accounts`

Add a `currency` column defaulting to `EUR`. This is the native currency of the account and drives how transactions are interpreted.

```ts
export const accounts = pgTable('accounts', {
  // ... existing columns
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
});
```

**Migration:**

```sql
ALTER TABLE core.accounts
  ADD COLUMN currency VARCHAR(3) NOT NULL DEFAULT 'EUR';
```

All existing accounts will correctly default to EUR with no data loss.

---

### 1.2 New table: `core.currency_conversions`

Tracks each funding event: a user converts money from one currency account to another. This is the source of truth for which rate applies to a batch of transactions.

```ts
export const currencyConversions = pgTable('currency_conversions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  workspaceId:      uuid('workspace_id').notNull(),
  fromAccountId:    uuid('from_account_id').notNull(), // e.g. Revolut EUR
  toAccountId:      uuid('to_account_id').notNull(),   // e.g. Revolut SEK
  fromAmount:       numeric('from_amount',   { precision: 18, scale: 4 }).notNull(), // 200.0000
  toAmount:         numeric('to_amount',     { precision: 18, scale: 4 }).notNull(), // 2182.0000
  exchangeRate:     numeric('exchange_rate', { precision: 14, scale: 6 }).notNull(), // 10.910000
  effectiveFrom:    timestamp('effective_from').notNull(), // date of the funding transaction
  confidence:       varchar('confidence', { length: 20 }).notNull().default('auto'),
  // 'auto'     → derived from matched transfer pair
  // 'confirmed' → user confirmed the auto-detected rate
  // 'manual'   → user entered the rate by hand
  fromTransactionId: uuid('from_transaction_id'), // FK to the -200 EUR transaction
  toTransactionId:   uuid('to_transaction_id'),   // FK to the +2182 SEK transaction
  createdAt:        timestamp('created_at').notNull().defaultNow(),
});
```

---

### 1.3 Extend `core.transactions`

Add FX columns. All are nullable — EUR-native transactions will have them as `NULL`.

```ts
export const transactions = pgTable('transactions', {
  // ... existing columns:
  // id, workspaceId, accountId, amount, balance, date, description, ...

  // FX fields
  nativeCurrency:  varchar('native_currency', { length: 3 }),
  // Redundant with account.currency but useful for denormalized queries.
  // Always matches the account's currency at time of import.

  eurAmount:       numeric('eur_amount',    { precision: 18, scale: 4 }),
  // The EUR equivalent of this transaction. Null if unresolved.

  exchangeRate:    numeric('exchange_rate', { precision: 14, scale: 6 }),
  // The locked rate used to compute eurAmount.

  conversionId:    uuid('conversion_id'),
  // FK to currency_conversions. Null if unresolved or EUR-native.
});
```

**The `amount` column stays as-is**: it always holds the value in the account's native currency, exactly as the bank reports it. `eurAmount` is the derived field for reporting.

**Migration:**

```sql
ALTER TABLE core.transactions
  ADD COLUMN native_currency  VARCHAR(3),
  ADD COLUMN eur_amount       NUMERIC(18, 4),
  ADD COLUMN exchange_rate    NUMERIC(14, 6),
  ADD COLUMN conversion_id    UUID;
```

---

## 2. Transfer Matching & Rate Derivation

Multi-currency detection is an extension of Clair's existing transfer detection. A cross-currency transfer is identified the same way as a same-currency transfer, except the amounts are not equal — their **ratio is the rate**.

### 2.1 Matching Algorithm

When transactions are imported, run the following for any account with `currency != 'EUR'`:

```
For each incoming transaction T on a foreign-currency account:
  Search for a candidate EUR outgoing transaction C where:
    - C.accountId is a EUR account in the same workspace
    - C.amount is negative (outgoing)
    - T.amount is positive (incoming top-up)
    - T.date >= C.date (settlement can take 1–3 days)
    - T.date - C.date <= 3 days
    - abs((T.amount / abs(C.amount)) - knownApproxRate) < threshold
      (optional sanity check if a prior rate exists for this pair)

  If exactly one candidate found → HIGH confidence match
  If multiple candidates found  → MEDIUM confidence, pick closest date
  If no candidate found         → UNRESOLVED
```

**Derived rate:**

```ts
const exchangeRate = incomingAmount / Math.abs(outgoingAmount);
// e.g. 2182.00 / 200.00 = 10.91
```

### 2.2 Propagating the Rate to Transactions

Once a `currency_conversion` record is created with `effectiveFrom = C.date`, assign it to transactions using a **time-window** rule:

> A transaction T on account A uses the conversion whose `effectiveFrom` is the **latest date that is still ≤ T.date**, among all conversions where `toAccountId = A.id`.

In SQL:

```sql
SELECT *
FROM core.currency_conversions
WHERE to_account_id = $accountId
  AND effective_from <= $transactionDate
ORDER BY effective_from DESC
LIMIT 1;
```

At import time, this lookup runs per transaction and the result is denormalized into `transactions.conversion_id`, `transactions.exchange_rate`, and `transactions.eur_amount`.

---

## 3. Import Flow

### 3.1 Happy Path (auto-detected rate)

```
User uploads SEK CSV
  → Parser runs, transactions created with nativeCurrency = 'SEK', eurAmount = NULL
  → Transfer matching runs
  → Match found: -200 EUR (Dec 3) ↔ +2182 SEK (Dec 3)
  → currency_conversions record created: rate = 10.91, effectiveFrom = Dec 3, confidence = 'auto'
  → Rate propagated: all SEK transactions from Dec 3 onwards get eurAmount computed
  → Import review screen shown with rate confirmation card (see §4)
```

### 3.2 Partial Path (EUR CSV not yet uploaded)

```
User uploads SEK CSV
  → Parser runs, transactions created with nativeCurrency = 'SEK', eurAmount = NULL
  → Transfer matching runs → no matching EUR transaction found
  → Transactions flagged as UNRESOLVED (conversionId = NULL)
  → Import completes, but a warning banner is shown:
    "X transactions in Revolut SEK have no EUR rate assigned."

Later: User uploads Revolut EUR CSV
  → Transfer matching re-runs across existing unresolved transactions
  → Match found retroactively
  → currency_conversions created, rates backfilled
  → Banner dismissed
```

### 3.3 Manual Path (no match, user provides rate)

```
User uploads SEK CSV → no match found
  → After import, user sees the unresolved banner
  → User clicks "Resolve"
  → Rate input dialog shown (see §4.2)
  → User enters 10.91, confirms
  → currency_conversions created with confidence = 'manual'
  → Rates applied to all affected transactions
```

---

## 4. UI Components

### 4.1 Conversion Confirmation Card

Shown as part of the post-import review step when a rate is auto-detected.

```
┌──────────────────────────────────────────────────────────┐
│  💱  Conversion detected — Revolut SEK                   │
│                                                          │
│  -200.00 EUR  →  +2,182.00 SEK                           │
│  3 Dec 2024 → 3 Dec 2024                                 │
│                                                          │
│  Detected rate:  [ 10.91 ] SEK / EUR                     │
│  Applies to:     14 transactions  (Dec 3 → Jan 15)       │
│                                                          │
│               [ Edit rate ]  [ Confirm ]                 │
└──────────────────────────────────────────────────────────┘
```

- The rate field is editable inline before confirming.
- Confirming sets `confidence = 'confirmed'` on the conversion record.
- "Edit rate" focuses the input and dims the auto-detected value.

### 4.2 Unresolved Transactions Banner

Shown on the accounts view or dashboard when `conversionId IS NULL` exists for any non-EUR account.

```
┌──────────────────────────────────────────────────────────┐
│  ⚠  3 transactions in Revolut SEK have no EUR rate.      │
│     Upload the matching Revolut EUR export, or enter     │
│     a conversion rate manually.                          │
│                                [ Resolve ]               │
└──────────────────────────────────────────────────────────┘
```

Clicking **Resolve** opens a dialog:

```
┌──────────────────────────────────────────────────────────┐
│  Set conversion rate — Revolut SEK                       │
│                                                          │
│  We couldn't find a matching EUR → SEK transfer.         │
│  Enter the exchange rate to apply to these transactions: │
│                                                          │
│  Earliest unresolved:  Dec 3, 2024                       │
│  Latest unresolved:    Jan 15, 2025                      │
│                                                          │
│  Rate:  [ ________ ] SEK / EUR                           │
│                                                          │
│  [ Cancel ]                         [ Apply to all ]    │
└──────────────────────────────────────────────────────────┘
```

### 4.3 Transaction List — FX Display

For SEK transactions in the transaction list, show both values:

```
Dec 5          Coffee — Espresso House
               -45.00 SEK               -4.12 EUR
```

The EUR value is shown in a muted colour (secondary text). Unresolved transactions show `— EUR` with a warning icon instead.

---

## 5. Reporting

Because `eur_amount` is denormalized on every transaction, unified EUR reporting requires no joins beyond `core.transactions`:

```sql
-- Total spend in EUR across all accounts for a given period
SELECT
  SUM(COALESCE(eur_amount, amount)) AS total_eur
FROM core.transactions
WHERE workspace_id = $workspaceId
  AND date BETWEEN $start AND $end
  AND amount < 0;
-- COALESCE: EUR-native transactions have eur_amount = NULL,
-- so fall back to amount (which is already in EUR)
```

```sql
-- Unresolved transactions count (data health check)
SELECT COUNT(*)
FROM core.transactions t
JOIN core.accounts a ON a.id = t.account_id
WHERE t.workspace_id = $workspaceId
  AND a.currency != 'EUR'
  AND t.conversion_id IS NULL;
```

---

## 6. Edge Cases

| Scenario | Handling |
|---|---|
| Same account funded multiple times at different rates | Each top-up creates a new `currency_conversion`. Transactions are assigned to the conversion with the latest `effectiveFrom ≤ tx.date`. |
| User corrects a rate after the fact | Update `exchange_rate` on the `currency_conversions` row, then recompute `eur_amount` on all linked transactions (`conversionId = correctedId`). |
| EUR CSV uploaded before SEK CSV | The outgoing EUR transaction exists with no match yet. When SEK CSV is uploaded later, matching runs and finds it. |
| SEK CSV uploaded before EUR CSV | Transactions are UNRESOLVED. Banner shown. Resolved retroactively when EUR CSV is uploaded. |
| Multiple candidate EUR transactions match the same top-up | Flag as MEDIUM confidence; pick the candidate with the smallest date delta. Show the card with an extra note: "Multiple candidates found — please verify." |
| Account funded in non-EUR foreign currency (e.g. USD → SEK) | Out of scope for initial implementation. Schema supports it (`fromAmount` / `toAmount` have no currency assumption), but the UI and matching logic should guard against this case and surface it as unsupported for now. |

---

## 7. Implementation Order

1. **Schema migration** — add `currency` to `accounts`, add FX columns to `transactions`, create `currency_conversions` table.
2. **Account model update** — expose `currency` in account creation/edit forms; default to EUR.
3. **CSV parser update** — populate `nativeCurrency` on imported transactions from the account's currency; leave `eurAmount` and `conversionId` null initially.
4. **Transfer matching extension** — extend existing transfer matcher to handle cross-currency pairs and derive exchange rates.
5. **Rate propagation** — after a `currency_conversion` is created, run the time-window assignment across affected transactions.
6. **Retroactive backfill** — when a new CSV is uploaded, re-run matching against existing unresolved transactions.
7. **Import review UI** — add the conversion confirmation card to the post-import flow.
8. **Unresolved banner + manual resolution dialog** — surface data gaps and allow manual rate entry.
9. **Transaction list FX display** — show native + EUR amounts for foreign-currency transactions.
10. **Reporting queries** — update all aggregate queries to use `COALESCE(eur_amount, amount)`.