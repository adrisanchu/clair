# Bank statement parsers

This directory turns a user-uploaded bank export (CSV or Excel) into a list of
`NormalizedTransaction`s ready for dedup + import.

## How it fits together

```
uploadAndParse(file)              index.ts   ← single entry point
  ├─ detect file type (csv / xls / xlsx)
  ├─ pick a profile
  │     • profileIdHint (stored on the account)        ← primary path
  │     • detectProfile / detectXLSXProfile (fingerprint)
  │     • else → detectAdaptiveProfile (detector.ts)   ← generic fallback
  ├─ parseCSV / parseXLSX  ── strict profile parse
  │     └─ if >50% rows skipped → re-run with adaptive detection
  └─ per row: normalizeRow (normalizer.ts) → POST_NORMALIZE hook → preCategorize
```

- **`types.ts`** — `BankParserProfile` (the declarative shape a profile fills in) and
  `NormalizedTransaction` (the output row).
- **`normalizer.ts`** — `normalizeRow()` maps a raw row → `NormalizedTransaction` using the
  profile's column names. Shared helpers: `parseAmount()` (handles both `1.234,56` comma-decimal
  and `1,234.56` dot-decimal), `parseDateField()`, `resolveDateFormat()` (the profile's
  `dateFormat` is a hint; the real format is detected from the file), `classifyStatus()`.
- **`detector.ts`** — the adaptive fallback: charset / delimiter / skip-rows / semantic-column /
  date-format detection for files with no matching profile.
- **`index.ts`** — profile registry, fingerprint auto-detection, file-type routing, and the
  `POST_NORMALIZE` per-profile escape hatch.

## Adding a profile — checklist

1. Add `profiles/<id>.ts` exporting the `BankParserProfile` + a `*_HEADER_FINGERPRINT`.
2. Register it in the `PROFILES` map in `index.ts`.
3. Wire fingerprint auto-detection: `detectProfile` (CSV header line) or `detectXLSXProfile`
   (the header row index). Not strictly required — accounts store the `bankProfileId` and pass
   it as `profileIdHint` — but it lets uploads to the wrong/new account still be recognised.
4. If a column needs handling the generic mapping can't express, add a `POST_NORMALIZE[<id>]`
   hook (runs after `normalizeRow`, before `preCategorize`).
5. A profile is surfaced in the account-creation dropdowns and accepted by the API
   automatically via `getAllProfiles()` — no UI change needed beyond an optional `BankLogo`
   colour.
6. Drop a reference export in `tests/data/` and add the profile's hypotheses below.

Everything else (dedup, balance, enrichment, AI tagging) is profile-agnostic.

## Parser hypotheses

Each profile encodes assumptions about one bank's export. Documented here so a future export
that drifts from them is easy to diagnose. Verify against a fresh reference file before trusting.

### `revolut_eu` — Revolut (CSV)

- **Format:** UTF-8 CSV, `,`-delimited, header on line 0 (`skipRows: 0`).
  Auto-detected by `REVOLUT_EU_HEADER_FINGERPRINT` (exact or subset match).
- **Dates:** `Started Date` (`yyyy-MM-dd HH:mm:ss`), with `Completed Date` as the value date.
- **Amounts:** single signed `Amount` column + a separate `Fee` column, folded into the net
  amount by the generic `feeColumn` handling. Multi-currency: `Currency` + original-amount
  columns are populated.
- **Status/type:** has both `State` (COMPLETED/PENDING/REVERTED…) and `Type` (TRANSFER,
  EXCHANGE, …) → drives transfer/FX candidate flags.
- **Fragile if:** Revolut renames columns, or a re-saved export localises the date format
  (mitigated by `resolveDateFormat`).

### `bankinter_es` — Bankinter (XLSX)

- **Format:** modern `.xlsx`; 8 metadata/blank rows then the header at **row index 8**
  (`skipRows: 8`). Auto-detected by matching `BANKINTER_ES_HEADER_FINGERPRINT` at that row.
- **Dates:** `Fecha contable` (booking, `dd/MM/yyyy`) + `Fecha valor` (value).
- **Amounts:** single signed `Importe`; running `Saldo`; `Divisa` currency column. No fees
  column (baked into amount), no status/type column (all rows posted).
- **Fragile if:** Bankinter changes the number of leading metadata rows (shifts the header
  index) or the column labels.

### `caixabank_es` — CaixaBank (legacy `.xls`)

- **Format:** **legacy binary `.xls`** (OLE2/BIFF), _not_ modern `.xlsx`. SheetJS reads it
  through the same path, so `fileType: 'xlsx'`; the only special-casing is routing `.xls` /
  `application/vnd.ms-excel` to the spreadsheet path in `uploadAndParse`. Row 0 = title with
  IBAN, row 1 = "Importes expresados en euros", header at **row index 2** (`skipRows: 2`).
  Auto-detected by `CAIXABANK_ES_HEADER_FINGERPRINT` at that row.
- **Dates:** `Fecha` (booking, `dd/MM/yyyy`) + `Fecha valor` (value). Read as SheetJS formatted
  strings (`raw: false`), so the DD/MM/YYYY display is what `parseDateField` sees.
- **Amounts:** single signed `Importe`, **US-formatted** (`-1,056.32` — comma thousands, dot
  decimal); `parseAmount`'s dot-decimal branch strips the commas. Running `Saldo`. All EUR
  (no currency column), no fee/status/type column.
- **Description vs notes:** `Movimiento` is truncated to ~17 chars → used verbatim as the
  description. The richer `Más datos` context (counterparty, concept) is folded into `notes`
  by the `caixabank_es` `POST_NORMALIZE` hook, which drops the `Fecha de operación: DD-MM-YYYY`
  noise present in ~70% of rows. That card-operation date has no slot in the model and is
  discarded.
- **Fragile if:** CaixaBank changes the two leading metadata rows, switches the amount format
  to Spanish comma-decimal (would still parse — `parseAmount` detects both), or exports as
  real `.xlsx` (still fine — same SheetJS path).
- **Known limitation:** transfers ("TRANSFER INMEDIATA", "TRANSF. A SU FAVOR", …) live in the
  description with no type column, so they aren't auto-flagged as transfer candidates; the
  amount/date-based transfer-detector still pairs them.
