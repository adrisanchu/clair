# Phase 3a — Revolut EU Parser & Upload Pipeline

> This is the implementation spec for Phase 3a. Read `clair-prd-main.md` and
> `clair-prd-backend.md` first — this file only documents what is Revolut-specific.

---

## 1. Revolut CSV anatomy

Revolut's personal account CSV (Spanish locale) has the following columns:

| Column (ES) | Column (EN equiv.) | Type | Notes |
|---|---|---|---|
| `Tipo` | Transaction type | string | See §3 for semantics |
| `Producto` | Product | string | Always "Actual" — ignore |
| `Fecha de inicio` | Start / booking date | `YYYY-MM-DD HH:mm:ss` | Always present |
| `Fecha de finalización` | End / value date | `YYYY-MM-DD HH:mm:ss` | **Empty for PENDING rows** |
| `Descripción` | Description / merchant | string | Merchant name or transfer description |
| `Importe` | Amount | decimal (signed) | Negative = debit, positive = credit |
| `Comisión` | Fee | decimal | Usually `0.00` — add to amount if non-zero |
| `Divisa` | Currency | ISO 4217 | `EUR`, `CZK`, `JPY`, `SEK`, etc. |
| `State` | Status | string | `COMPLETADO` or `PENDIENTE` |
| `Saldo` | Running balance | decimal | **Empty for PENDING rows** |

### Key quirks

- **PENDING rows** have no `Fecha de finalización` and no `Saldo`. This is expected.
- **Currency exchange** (`Tipo = Cambio`) always generates **two rows**:
  one negative EUR debit + one positive EUR credit (the converted-back amount).
  Both rows describe the conversion (e.g. `"Conversión a CZK"` and `"Conversión a EUR"`).
  These are NOT transfers between accounts.
- **Revolut provides no unique transaction ID** in the CSV export. Deduplication must
  rely on `bookingDate + amount + description` (see §5).
- Encoding: UTF-8. Delimiter: comma. No metadata rows (header is row 1).

---

## 2. Parser profile definition

```typescript
// src/lib/server/parsers/profiles/revolut_eu.ts
import type { BankParserProfile } from "../types"

export const revolut_eu: BankParserProfile = {
  bankProfileId:     "revolut_eu",
  displayName:       "Revolut (EU)",
  encoding:          "utf-8",
  delimiter:         ",",
  skipRows:          0,
  dateColumn:        "Fecha de inicio",
  dateFormat:        "YYYY-MM-DD HH:mm:ss",
  valueDateColumn:   "Fecha de finalización",
  amountColumn:      "Importe",
  debitColumn:       null,
  creditColumn:      null,
  descriptionColumn: "Descripción",
  currencyColumn:    "Divisa",
  localAmountColumn: null,
  balanceColumn:     "Saldo",
  statusColumn:      "State",
  typeColumn:        "Tipo",
}
```

### Status mapping

| CSV `State` value | `NormalizedTransaction.status` |
|---|---|
| `COMPLETADO` | `"posted"` |
| `PENDIENTE` | `"pending"` |
| anything else | `"pending"` (safe default) |

---

## 3. Transaction type semantics (`Tipo` column)

| Revolut `Tipo` | Clair interpretation | `isTransfer` candidate? |
|---|---|---|
| `Pago con tarjeta` | Regular card payment | No |
| `Recargas` | Top-up / incoming transfer | No (income) |
| `Transferir` | P2P or bank transfer | **Yes** — flag for transfer detection |
| `Cambio` | In-app currency exchange | No — see §3.1 |
| `Efectivo` | ATM withdrawal | No |
| `Devolución` | Refund | No |

### 3.1 Currency exchange (`Cambio`) handling

A `Cambio` creates two rows in the CSV. Example: converting €200 to CZK:
```
Cambio  ...  Conversión a CZK   -200.00  EUR  COMPLETADO
Cambio  ...  Conversión a EUR   +3.08    EUR  COMPLETADO   ← leftover cents back
```

Both rows should be imported as regular (non-transfer) transactions. The negative
row represents money leaving your EUR wallet; the positive row (if present) is the
rounding remainder returned to EUR. Do NOT auto-link them as a transfer pair.

Suggested category for `Cambio` rows: `"exchange"` (add to default category list).

### 3.2 Top-ups (`Recargas`) handling

- `"Pago de [NAME]"` → received from another person — category hint: `income`
- `"Una recarga de Google Pay"` → self top-up from external card — category hint: `income`
- `"Recarga automática"` → automatic top-up rule — category hint: `income`

These are not flagged as transfers (they're credits, not round-trips).

---

## 4. Normalisation specifics

```typescript
// src/lib/server/parsers/profiles/revolut_eu.ts (normalise override)
// The generic normalizer handles most of this, but Revolut needs extra steps:

export function postNormalize(
  row: NormalizedTransaction,
  raw: Record<string, string>,
): NormalizedTransaction {
  // 1. Add fee to amount if non-zero
  const fee = parseFloat(raw["Comisión"] || "0") || 0
  if (fee !== 0) {
    row.amount = row.amount + fee  // fee is already negative in Revolut
  }

  // 2. Mark Transferir rows as transfer candidates
  if (raw["Tipo"] === "Transferir") {
    row.rawType = "Transferir"
  }

  return row
}
```

**Date parsing note:** `"Fecha de inicio"` and `"Fecha de finalización"` are both
`YYYY-MM-DD HH:mm:ss`. Use `date-fns/parse` with format `"yyyy-MM-dd HH:mm:ss"`.
For `valueDate`, if the column is empty (PENDING rows), set to `null`.

---

## 5. Deduplication for Revolut

Since Revolut CSVs have no `externalId`, dedup always falls through to Priority 2
(date + amount + description) and Priority 3 (date + amount only) from `clair-prd-backend.md §5.4`.

### The PENDING → COMPLETED transition

When a user uploads a CSV that contains a transaction previously imported as PENDING,
the system must:

1. **Detect the match** via `bookingDate + amount + description`
2. **Apply `update_status`** — update only:
   - `status` → `"posted"`
   - `valueDate` → parsed from `Fecha de finalización`
   - `updatedAt` → now
3. **Preserve without touching:**
   - `category`, `categoryOverride`, `categoryConfidence`
   - `notes`, `city`, `tags`
   - `isTransfer`, `transferCounterpartId`

### Edge case: same-day, same-amount, same-description (two legitimate transactions)

Example: paying the same bar twice in one day. Both will have identical
`bookingDate + amount + description`. The dedup function returns `"review"` in this
case (Priority 3, multiple matches). Both are flagged; the user resolves manually.

---

## 6. Upload pipeline — Revolut-specific flow

### Step 1: Preview (`POST /api/upload/preview`)

Request: `multipart/form-data` — `file` (the CSV) + `bankProfileId: "revolut_eu"`

Response:
```typescript
{
  profile:       "revolut_eu",
  rowCount:      number,
  parsedCount:   number,         // rows successfully normalised
  skippedCount:  number,         // rows that failed to parse
  pendingCount:  number,         // rows with status = "pending"
  postedCount:   number,         // rows with status = "posted"
  dateRangeFrom: string,         // ISO date of earliest bookingDate
  dateRangeTo:   string,         // ISO date of latest bookingDate
  preview:       NormalizedTransaction[],  // first 5 rows
  errors:        string[],       // human-readable parse errors
}
```

### Step 2: Confirm (`POST /api/upload`)

Request: `multipart/form-data` — same file + `bankAccountId` + optional `currentBalance`

Pipeline:
1. Parse + normalise all rows
2. For each row, run `classifyRow()` → collect actions
3. Execute actions:
   - `insert` → `db.insert(transactions)`
   - `update_status` → `applyStatusUpdate()`
   - `update_desc` → update description only
   - `skip` → no-op (count as duplicate)
   - `review` → insert with `status = "review"` (flag for manual review)
4. Create `csv_uploads` record
5. Update `bank_accounts.current_balance` (only from COMPLETED rows with Saldo)
6. Run transfer auto-detection on newly inserted `Transferir` rows

Response:
```typescript
{
  imported:             number,  // net-new transactions inserted
  statusUpdates:        number,  // PENDING→COMPLETED upgrades
  duplicates:           number,  // skipped
  flagged:              number,  // inserted with status="review"
  unresolvedTransfers:  TransferMatch[],
}
```

---

## 7. Transfer detection for Revolut

After insert, run `detectAndLinkTransfers()` only on newly inserted transactions where
`rawType = "Transferir"`. Skip `Cambio` rows entirely — they are not inter-account transfers.

**"Transferir" matching heuristics:** The transfer detector uses the standard ±amount,
opposite-sign, ±3-day window logic from `clair-prd-backend.md §6`. For Revolut,
the description on both sides is often different (`"Transferencia a X"` vs `"Transfer from Y"`),
so the matching is purely amount + date based — which is correct.

---

## 8. Upload UI — Revolut-specific additions

### Auto-detection in Step 1

When the user uploads a CSV, the file header should be fingerprinted to auto-detect the
profile. Revolut EU (Spanish) starts with:

```
Tipo,Producto,Fecha de inicio,Fecha de finalización,Descripción,Importe,Comisión,Divisa,State,Saldo
```

If this header is detected, pre-select `revolut_eu` and show `"Detected: Revolut (EU) ✓"`.

### Step 2 preview — show pending/posted split

```
324 rows detected · Jan 2025 – Mar 2025
  ↳ 320 completed · 4 pending
```

Pending transactions are shown with a muted style in the preview table (opacity-60) and
a `PENDING` badge (`bg-amber-50 text-amber-700 text-xs rounded-full px-2`).

### Step 3 — Current balance

Revolut CSVs include a `Saldo` column for COMPLETED rows. When the latest row is
COMPLETED, we can read the balance directly — **skip Step 3 entirely** and use the
`Saldo` value from the most recent completed row.

Only show Step 3 if the most recent row is PENDING (no `Saldo` available).

### Step 4 — Confirm summary

```
Ready to import

┌──────────────────────────────────┐
│  New transactions          320   │
│  Status updates              4   │  ← only if > 0
│  Duplicates skipped         12   │
│  Needs review                2   │
│  Date range      Jan–Mar 2025    │
└──────────────────────────────────┘
```

---

## 9. Default categories — updated list

Add `exchange` to the default workspace categories (created at seed time):

```
restaurants · coffee · groceries · transport · travel · drinks
sports · health · subscriptions · transfers · exchange · savings
shopping · utilities · income · other
```

Internal only (hidden from UI): `balance_adjustment`

The `exchange` category is auto-assigned to `Cambio` rows during import (no AI needed).

---

## 10. OCR enhancement (Phase 5.5 — future)

> Not in scope for Phase 3. Documented here for future implementation.

Revolut shows spending categories (with icons) in the app UI, but these are not
exported in the CSV. An optional OCR flow could capture them:

**Concept:** User takes a screenshot of the Revolut transaction detail screen on their
phone and uploads it to Clair alongside (or instead of) a manual category selection.

**Implementation approach:**
1. Add a "Scan from Revolut app" button in the Transaction Detail panel (mobile only)
2. User selects or photographs the Revolut transaction detail screen
3. Send image to Claude Vision (same Anthropic SDK used in Phase 5)
4. Prompt: extract merchant name, amount, date, and category icon label
5. Map Revolut's category icon names to Clair category slugs:

| Revolut category | Clair category |
|---|---|
| Restaurants | `restaurants` |
| Coffee shops | `coffee` |
| Bars & nightclubs | `drinks` |
| Groceries | `groceries` |
| Transport | `transport` |
| Travel | `travel` |
| Health & beauty | `health` |
| Shopping | `shopping` |
| Entertainment | `other` |
| General | `other` |

6. Pre-fill the category picker with the matched category — user confirms or overrides
7. Store the source as `"ocr_revolut"` in an audit log (future History section)

**Confidence rule:** Only pre-fill if the OCR match confidence > 0.80. Otherwise show
"We couldn't read the category — please select manually."
