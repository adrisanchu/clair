# CSV Column Mapping UX — Upload Dialog Review Step

## Overview

After issue #18 (auto-detect optional columns like category/city/notes), the parser silently maps or ignores user-added CSV columns. This feature adds a **"Columns" review step** to the upload dialog so users can:

1. Confirm (or reject) auto-detected optional column mappings (category/city/notes).
2. See which CSV columns won't be imported (informational notice).

Confirmed mappings are saved to `csv_column_mappings` per workspace so future uploads are pre-confirmed.

---

## New upload flow

```
upload → preview → [columns?] → importing → done
```

The `columns` step is **skipped** when both `columnMappings` and `unusedColumns` are empty — i.e. the file contains exactly the profile-expected columns and nothing extra.

---

## Files to modify

| File | Change |
|---|---|
| `src/lib/server/parsers/types.ts` | Add `additionalColumns` to `BankParserProfile`; add `columnMappings` + `unusedColumns` to `ParseResult` |
| `src/lib/server/parsers/normalizer.ts` | Add `getUsedColumns(profile)` utility |
| `src/lib/server/parsers/profiles/revolut_eu.ts` | Add `additionalColumns: ['Comisión']` |
| `src/lib/server/parsers/profiles/bankinter_es.ts` | Add `additionalColumns: []` |
| `src/lib/server/parsers/index.ts` | Compute `unusedColumns`; populate new `ParseResult` fields; add `columnOverrides` param to `uploadAndParse()` |
| `src/routes/api/accounts/[id]/preview/+server.ts` | Add `columnMappings`, `unusedColumns`, `savedMappings` to response |
| `src/routes/api/accounts/[id]/import/+server.ts` | Accept `columnMappings` JSON override; save confirmed mappings to `csv_column_mappings` |
| `src/lib/components/accounts/UploadCsvDialog.svelte` | Add `'columns'` step; extend state + types; conditional routing |

---

## Implementation

### 1. `types.ts` — Extend interfaces

Add `additionalColumns` to `BankParserProfile`:
```typescript
additionalColumns: string[]; // extra CSV columns consumed by postNormalize (e.g. 'Comisión')
```

Extend `ParseResult`:
```typescript
export interface ParseResult {
  rows: NormalizedTransaction[];
  skippedCount: number;
  errors: string[];
  columnMappings: Array<{
    csvHeader: string;
    field: 'category' | 'city' | 'notes';
    label: string;
  }>;
  unusedColumns: string[];
}
```

### 2. `normalizer.ts` — `getUsedColumns` utility

Add after the synonym constants:
```typescript
/** Returns all CSV header names that the profile actively consumes. */
export function getUsedColumns(profile: BankParserProfile): string[] {
  return [
    profile.dateColumn,
    profile.valueDateColumn,
    profile.amountColumn,
    profile.debitColumn,
    profile.creditColumn,
    profile.descriptionColumn,
    profile.currencyColumn,
    profile.localAmountColumn,
    profile.balanceColumn,
    profile.statusColumn,
    profile.typeColumn,
    ...profile.additionalColumns
  ].filter((c): c is string => c !== null);
}
```

### 3. Profile files

- `revolut_eu.ts`: add `additionalColumns: ['Comisión']`
- `bankinter_es.ts`: add `additionalColumns: []`

### 4. `index.ts` — Column detection + overrides

Add type alias:
```typescript
type ColumnOverrides = {
  categoryColumn: string | null;
  cityColumn: string | null;
  notesColumn: string | null;
} | null;
```

Update `uploadAndParse()`, `parseCSV()`, `parseXLSX()` to accept an optional `columnOverrides` parameter. When provided, skip synonym detection and use the override values directly.

Compute `columnMappings` and `unusedColumns` in both parse functions:
```typescript
const usedByProfile = getUsedColumns(profile);
const optionalColumnValues = Object.values(optionalColumns).filter(Boolean) as string[];

const unusedColumns = headers.filter(
  (h) => !usedByProfile.includes(h) && !optionalColumnValues.includes(h)
);

const FIELD_LABELS = { category: 'Category', city: 'City', notes: 'Notes' };
const columnMappings = (
  Object.entries({
    category: optionalColumns.categoryColumn,
    city: optionalColumns.cityColumn,
    notes: optionalColumns.notesColumn
  }) as [string, string | null][]
)
  .filter(([, v]) => v !== null)
  .map(([field, csvHeader]) => ({
    csvHeader: csvHeader!,
    field: field as 'category' | 'city' | 'notes',
    label: FIELD_LABELS[field as keyof typeof FIELD_LABELS]
  }));
```

Return `{ rows, skippedCount, errors, columnMappings, unusedColumns }` from `ParseResult`.

### 5. Preview endpoint

Query saved workspace mappings and include in response:
```typescript
const savedMappings = await db.query.csvColumnMappings.findMany({
  where: eq(csvColumnMappings.workspaceId, account.workspaceId)
});

return json({
  // ...existing fields...
  columnMappings: result.columnMappings,
  unusedColumns: result.unusedColumns,
  savedMappings: savedMappings.map((m) => ({
    field: m.columnKey,
    csvHeader: m.columnLabel,
    enabled: m.enabled
  }))
});
```

### 6. Import endpoint

Accept user-confirmed column overrides:
```typescript
const columnMappingsRaw = formData.get('columnMappings') as string | null;
const columnOverrides = columnMappingsRaw ? JSON.parse(columnMappingsRaw) : null;
```

Pass to `uploadAndParse(file, account.bankProfileId, columnOverrides)`.

Save confirmed mappings to `csv_column_mappings` after insert:
```typescript
if (columnOverrides) {
  const toSave = [
    columnOverrides.categoryColumn ? { key: 'category', label: columnOverrides.categoryColumn } : null,
    columnOverrides.cityColumn     ? { key: 'city',     label: columnOverrides.cityColumn }     : null,
    columnOverrides.notesColumn    ? { key: 'notes',    label: columnOverrides.notesColumn }    : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>;

  for (const { key, label } of toSave) {
    await db
      .insert(csvColumnMappings)
      .values({ workspaceId: account.workspaceId, columnKey: key, columnLabel: label, sortOrder: 0, enabled: true })
      .onConflictDoNothing();
  }
}
```

### 7. `UploadCsvDialog.svelte`

**State additions:**
```typescript
type Step = 'upload' | 'preview' | 'columns' | 'importing' | 'done';
type ColumnMapping = { csvHeader: string; field: 'category' | 'city' | 'notes'; label: string };

// Extend PreviewData
type PreviewData = {
  // ...existing...
  columnMappings: ColumnMapping[];
  unusedColumns: string[];
  savedMappings: Array<{ field: string; csvHeader: string; enabled: boolean }>;
};

let columnConfirm = $state<Record<'category' | 'city' | 'notes', boolean>>({
  category: true, city: true, notes: true
});
```

**Progress bar (dynamic):**
```typescript
const steps = $derived(
  preview && (preview.columnMappings.length > 0 || preview.unusedColumns.length > 0)
    ? ['Upload', 'Preview', 'Columns', 'Done']
    : ['Upload', 'Preview', 'Done']
);
const stepIndex = $derived(
  step === 'upload' ? 0
  : step === 'preview' ? 1
  : step === 'columns' ? 2
  : steps.length - 1
);
```

**Preview footer:** Route to `columns` step or directly to import:
```svelte
{#if preview && (preview.columnMappings.length > 0 || preview.unusedColumns.length > 0)}
  <Button onclick={() => (step = 'columns')}>
    Review columns <ArrowRight size={14} />
  </Button>
{:else}
  <Button onclick={submitImport}>
    Import {preview?.totalParsed ?? ''} transactions <ArrowRight size={14} />
  </Button>
{/if}
```

**Columns step UI:** Two sections:
1. Detected optional columns — toggle list (default: on, pre-populated from `savedMappings`)
2. Unused columns — informational pill list

**`submitImport()` — include column overrides:**
```typescript
if (preview?.columnMappings.length) {
  const overrides = {
    categoryColumn: columnConfirm.category ? preview.columnMappings.find(m => m.field === 'category')?.csvHeader ?? null : null,
    cityColumn:     columnConfirm.city     ? preview.columnMappings.find(m => m.field === 'city')?.csvHeader     ?? null : null,
    notesColumn:    columnConfirm.notes    ? preview.columnMappings.find(m => m.field === 'notes')?.csvHeader    ?? null : null,
  };
  formData.append('columnMappings', JSON.stringify(overrides));
}
```

---

## Migration note

`csv_column_mappings` needs a unique constraint on `(workspace_id, column_key)` for the upsert to work cleanly:
1. Add to `schema.ts`: `uniqueIndex('csv_column_mappings_workspace_column_key').on(table.workspaceId, table.columnKey)`
2. Run `npm run db:generate` (TTY terminal) + `npm run db:migrate`

---

## Verification

1. Upload a Revolut CSV with extra columns (`Categoría`, `Ciudad`, `Notas`, `Zona`):
   - Preview footer shows "Review columns →"
   - Columns step shows 3 toggles + 1 unused pill (`Zona`)
2. Disable `Ciudad` toggle → import → Drizzle Studio: `city` is null on inserted rows
3. Upload a clean Revolut CSV (no extra columns):
   - Columns step is skipped; `Producto` shows as unused pill if it's in the file but not in the profile
4. Upload again: `savedMappings` pre-checks the previously confirmed columns
