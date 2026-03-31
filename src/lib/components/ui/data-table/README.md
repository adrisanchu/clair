# DataTable Component (planned)

Reusable TanStack Table component for Clair, following the shadcn-svelte data table guide:
https://www.shadcn-svelte.com/docs/components/data-table#introduction

## Planned features

- Fixed-height container (fills remaining viewport height)
- Sticky column headers
- Scrollable body
- Column sorting (click header to toggle asc/desc)
- Column visibility toggle
- Row selection
- Server-side or client-side data

## Dependencies to install

```bash
npm install @tanstack/table-core
```

## Usage plan

```svelte
<DataTable
  {columns}
  {data}
  {total}
  {page}
  {pageSize}
  onSortChange={(col, dir) => ...}
  onPageChange={(p) => ...}
/>
```

## Implementation notes

- The transactions page will be refactored to use this component
- The table body height should be: `calc(100vh - <header> - <filterbar> - <footer>)`
- Column defs follow TanStack Table v8 `ColumnDef<TData>` type
