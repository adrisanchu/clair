# Feature: `preCategorize` — Description-based transfer detection ✓ DONE

## Context

Bankinter (and any future bank profile with `typeColumn: null`) never sets `isTransferCandidate: true`
during normalization because there is no type column to read from. Since the upload pipeline inserts
`isTransfer: row.isTransferCandidate` into the DB, those transactions never carry `isTransfer: true`.
The transfer detector (`detectAndLinkTransfers`) queries `eq(transactions.isTransfer, true)` — so it
completely skips Bankinter transactions, and transfers are never auto-detected or surfaced for manual
linking.

**Goal:** add a lightweight, regex-based `preCategorize()` step that flags transfer candidates by
scanning the `description` field. No AI required — common Spanish bank transfer keywords are
predictable enough for a first-pass heuristic. This is a stepping stone toward full AI tagging in
Phase 5.

---

## Root cause trace

```
normalizeRow()
  └─ isTransferCandidate = rawType !== null && profile.transferTypes.includes(rawType)
       └─ bankinter_es: typeColumn = null → rawType = null → isTransferCandidate = ALWAYS false

upload/+server.ts
  └─ isTransfer: row.isTransferCandidate   ← always false for Bankinter

detectAndLinkTransfers()
  └─ WHERE isTransfer = true               ← skips all Bankinter rows
```

---

## Critical files

| File                                   | Role                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `src/lib/server/parsers/index.ts`      | `parseCSV` / `parseXLSX` — integration point                             |
| `src/lib/server/parsers/normalizer.ts` | `normalizeRow` — sets `isTransferCandidate` from `typeColumn`            |
| `src/lib/server/parsers/types.ts`      | `NormalizedTransaction` interface                                        |
| `src/lib/server/transfer-detector.ts`  | Queries `isTransfer = true` — **unchanged**                              |
| `src/routes/api/upload/+server.ts`     | Maps `row.isTransferCandidate → isTransfer` in DB insert — **unchanged** |
| `tests/bankinter_parser/run.ts`        | Smoke test that already prints `[transfer]` flags                        |

---

## Implementation

### 1. New file: `src/lib/server/parsers/pre-categorize.ts`

```typescript
import type { NormalizedTransaction } from './types.js';

/**
 * Lightweight heuristic pre-categorisation pass.
 *
 * For bank profiles that lack a `typeColumn` (e.g. bankinter_es), description-based
 * pattern matching fills the role that the type column plays in profiles like revolut_eu.
 *
 * Only modifies `isTransferCandidate`; never overwrites a value already set to `true`
 * by the type column. Returns a new object — never mutates the input.
 */

const TRANSFER_PATTERNS: RegExp[] = [
	/\bTRANSF/i, // TRANSF, TRANSF., TRANSFERENCIA, TRANSFERENCIA EMITIDA/RECIBIDA …
	/\bTRASPASO\b/i // Spanish term for inter-account savings transfer
];

export function preCategorize(row: NormalizedTransaction): NormalizedTransaction {
	if (row.isTransferCandidate) return row; // already flagged via typeColumn — passthrough

	const isTransfer = TRANSFER_PATTERNS.some((re) => re.test(row.description));
	if (!isTransfer) return row;

	return { ...row, isTransferCandidate: true };
}
```

### 2. Edit `src/lib/server/parsers/index.ts`

Add import at the top:

```typescript
import { preCategorize } from './pre-categorize.js';
```

Call it in **both** `parseCSV` and `parseXLSX`, after the `postNorm` block and before `rows.push(...)`:

```typescript
// before (in both functions):
if (postNorm) {
	normalized = postNorm(normalized, raw);
}
rows.push({ ...normalized, sourceIndex: i });

// after:
if (postNorm) {
	normalized = postNorm(normalized, raw);
}
normalized = preCategorize(normalized); // ← add this line
rows.push({ ...normalized, sourceIndex: i });
```

---

## What does NOT change

- `normalizer.ts` — stays pure; type-column logic untouched
- `transfer-detector.ts` — unchanged; still queries `isTransfer = true`
- `+server.ts` upload route — unchanged; still maps `row.isTransferCandidate → isTransfer`
- `BankParserProfile` interface — no new fields needed
- DB schema — no migration needed

---

## Extensibility

`preCategorize` is intentionally minimal for now. In Phase 5, the same function can be extended to
also fill the `category` field using AI or more advanced heuristics (e.g. RECIBO → `direct_debit`,
NOMINA → `salary`). The function signature (`NormalizedTransaction → NormalizedTransaction`) is
already compatible with that future expansion.

---

## Verification

1. Run the bankinter smoke test — rows with TRANSF/TRASPASO in description will print `[transfer]`:

   ```bash
   npx tsx tests/bankinter_parser/run.ts
   ```

2. Upload a Bankinter XLSX with known transfers in the app. Confirm:
   - `unresolvedTransfers` in the upload response is populated (or auto-linked if counterpart exists)
   - Transactions show `isTransfer = true` in Drizzle Studio (`npm run db:studio`)

3. Upload a Revolut CSV — verify existing `[transfer]` behaviour is unchanged (passthrough).
