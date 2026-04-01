# Bank Transactions Parser — Data Flow

How a CSV from your banking app becomes a transaction record in the DB.

---

## Context

Revolut (and other banks) export transactions as CSVs. Revolut's Spanish-locale export
contains no categories and no unique transaction ID. The upload pipeline handles
parsing, smart deduplication (including PENDING→COMPLETED upgrades), balance
management, and transfer detection — all without overwriting anything you've already
annotated manually.

---

## Current test workflow (no UI yet)

```bash
# 1. Start the stack
docker compose up -d
npm run dev

# 2. Log in — store the session cookie
curl -s -c cookies.txt -X POST http://localhost:5173/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'

# 3. Preview a CSV (auto-detects Revolut format from header)
curl -s -b cookies.txt -X POST http://localhost:5173/api/upload/preview \
  -F "file=@/path/to/revolut-export.csv"

# 4. Full upload (requires a bankAccountId — create one via /accounts or Drizzle Studio)
curl -s -b cookies.txt -X POST http://localhost:5173/api/upload \
  -F "file=@/path/to/revolut-export.csv" \
  -F "bankAccountId=<uuid>"
```

Once the accounts UI is built (Phase 2), you create the bank account there and the
upload button appears directly on the account card.

---

## Full data flow

```
[User's phone]
     │  shares CSV file (via browser file picker or OS share sheet)
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /api/upload/preview                                           │
│                                                                     │
│  fileToText()          → read as UTF-8 buffer                      │
│  detectProfile()       → match header fingerprint → "revolut_eu"   │
│  parseCSV()            → PapaParse with header:true                │
│    normalizeRow()        per row:                                   │
│      • bookingDate     ← "Fecha de inicio"  (YYYY-MM-DD HH:mm:ss)  │
│      • valueDate       ← "Fecha de finalización" (null if PENDING) │
│      • amount          ← "Importe" (signed decimal)                │
│      • currency        ← "Divisa"                                   │
│      • status          ← "State": COMPLETADO→posted, PENDIENTE→pending │
│      • rawType         ← "Tipo": Pago con tarjeta / Transferir / …  │
│      • isTransferCand. ← rawType === "Transferir"                  │
│    revolut_eu postNormalize():                                      │
│      • adds "Comisión" to amount if non-zero                        │
│                                                                     │
│  Returns (no DB write):                                             │
│    rowCount, pendingCount, postedCount, dateRangeFrom/To,           │
│    latestBalance (from Saldo col — skips Step 3 in UI),             │
│    preview[0..4], errors[]                                          │
└─────────────────────────────────────────────────────────────────────┘
     │  User reviews preview, confirms
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  POST /api/upload                                                   │
│                                                                     │
│  ① Parse + normalise (same as preview)                              │
│                                                                     │
│  ② Deduplication — per row, classifyRow() returns one of:          │
│                                                                     │
│    "insert"        → brand-new row → db.insert(transactions)        │
│    "update_status" → row was PENDING, now POSTED                    │
│                      UPDATE status, valueDate, updatedAt            │
│                      !! category, notes, city, tags untouched       │
│    "update_desc"   → same date+amount, description changed          │
│                      UPDATE description only                        │
│    "skip"          → exact duplicate → no-op                        │
│    "review"        → ambiguous (same date+amount, 2+ matches)       │
│                      INSERT with status="review" for manual check   │
│                                                                     │
│  Dedup priority:                                                     │
│    1. externalId match  (Revolut has no externalId — skipped)       │
│    2. bookingDate + amount + md5(description)  exact                │
│    3. bookingDate + amount only  (description may differ)           │
│                                                                     │
│  ③ Balance                                                          │
│    Revolut has a "Saldo" column → use latest completed row's        │
│    balance directly (no user input needed — skips Step 3 in UI)     │
│    Other banks → user enters current balance → computeOpeningBalance│
│                                                                     │
│  ④ INSERT csv_uploads record (importedCount, statusUpdates, etc.)   │
│  ⑤ UPDATE transactions SET csv_upload_id for rows just inserted     │
│  ⑥ UPDATE bank_accounts.status = "active"                          │
│                                                                     │
│  ⑦ Transfer detection (only on newly inserted rows)                 │
│    Sources: rows where isTransfer=true (rawType="Transferir")       │
│    Note: "Cambio" (currency exchange) is intentionally excluded     │
│    Candidates: opposite sign, same absolute amount, ±3 days,        │
│                different account, not already linked                 │
│    1 candidate  → auto-link both rows                               │
│    0 or 2+      → surface as unresolvedTransfers[] for UI           │
│                                                                     │
│  Returns:                                                           │
│    { imported, statusUpdates, duplicates, flagged,                  │
│      unresolvedTransfers[] }                                        │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
  DB: core.transactions  (new rows + updated PENDING→POSTED rows)
  DB: core.csv_uploads   (upload audit record)
  DB: core.bank_accounts (current_balance + status refreshed)
```

---

## Revolut CSV quirks

| Quirk                                                      | Handling                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| No unique transaction ID                                   | Dedup via date + amount + description                               |
| PENDING rows have no `Fecha de finalización` or `Saldo`    | `valueDate = null`, `runningBalance = null`                         |
| `Cambio` (exchange) creates 2 rows (−EUR + +EUR remainder) | Both imported as regular transactions; **not** flagged as transfers |
| `Transferir` rows are inter-account transfers              | `isTransfer = true`; transfer detector runs on these                |
| Fee column (`Comisión`) usually 0                          | Added to amount when non-zero (postNormalize step)                  |
| UTF-8, comma-delimited                                     | Detected automatically from header fingerprint                      |

---

## User-enriched fields (never overwritten by re-uploads)

When a PENDING transaction becomes COMPLETED in a new CSV upload, only these
system-owned fields are updated:

```
status        → "posted"
valueDate     → parsed from "Fecha de finalización"
updatedAt     → now
```

These fields are **never touched** on re-upload:

```
category           (AI-assigned)
categoryOverride   (user correction)
notes              (free-form note, e.g. "CPH Day 1 — Café La Cabra")
city               (trip tag, e.g. "Copenhagen")
tags               (array)
```

---

## Required UI (current status)

| Component                 | Route / File             | Status      |
| ------------------------- | ------------------------ | ----------- |
| Bank account CRUD         | `/accounts`              | ✅ Phase 2  |
| Add account sheet         | `AddAccountSheet.svelte` | ✅ Phase 2  |
| Upload sheet (multi-step) | `UploadSheet.svelte`     | ⬜ Phase 3d |
| Transaction list          | `/transactions`          | ⬜ Phase 4  |

---

## Parser files

| File                                            | Role                                                        |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `src/lib/server/parsers/types.ts`               | `BankParserProfile`, `NormalizedTransaction` interfaces     |
| `src/lib/server/parsers/normalizer.ts`          | Generic row normalizer (dates, amounts, status)             |
| `src/lib/server/parsers/profiles/revolut_eu.ts` | Revolut EU profile + fee post-normalisation                 |
| `src/lib/server/parsers/index.ts`               | Profile registry, `detectProfile()`, `parseCSV()`           |
| `src/lib/server/dedup.ts`                       | `classifyRow()`, `applyStatusUpdate()`, `applyDescUpdate()` |
| `src/lib/server/balance.ts`                     | Opening balance + current balance helpers                   |
| `src/lib/server/transfer-detector.ts`           | `detectAndLinkTransfers()`, `linkPair()`, `unlinkPair()`    |
| `src/routes/api/upload/preview/+server.ts`      | Parse-only endpoint                                         |
| `src/routes/api/upload/+server.ts`              | Full ingest pipeline                                        |
