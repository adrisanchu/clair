# Dashboard UI — Pending Tasks

> Identified after the initial dashboard implementation. Each task is independent and can be tackled separately.

---

## Task 1 — Migrate to shadcn-svelte Sidebar component

**Issue:** The current sidebar is a hand-rolled `<nav>` element. shadcn-svelte ships a full `Sidebar` primitive (collapsible, keyboard-accessible, state-managed via `useSidebar`) that handles the icon-only collapsed state, sheet overlay on mobile, and smooth transitions out of the box.

**Reference:** The shadcn dashboard screenshot shows the sidebar collapsing to icon-only at medium widths, controlled by a toggle button in the top header.

**Proposed solution:**
1. `npx shadcn-svelte@latest add sidebar` — installs `Sidebar`, `SidebarProvider`, `SidebarTrigger`, `SidebarContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarFooter`, etc.
2. Wrap `(app)/+layout.svelte` in `<SidebarProvider>`.
3. Replace `src/lib/components/layout/Sidebar.svelte` with a shadcn `AppSidebar` that uses the composable primitives.
4. Add `<SidebarTrigger>` to the page header (top-left on desktop, top bar on mobile).
5. The Sheet-based mobile overlay is built-in — no custom drawer needed.

**Files affected:** `+layout.svelte`, `Sidebar.svelte`, potentially a new `AppSidebar.svelte` wrapper.

---

## Task 2 — Use `Badge` component for trend indicator

**Issue:** The `+2.4%` trend value next to the hero total is styled with raw Tailwind classes. The shadcn-svelte `Badge` component (already installed) should be used for consistent chip styling.

**Proposed solution:**
Replace the raw `<div>` trend indicator with:

```svelte
<Badge class="gap-1 bg-success-50 text-success-600 border-0 font-medium">
  <TrendingUp size={13} />
  +2.4%
</Badge>
```

This also applies to the per-card change indicators (e.g. `+1.2%`) that will be added to account cards in a later task.

**Files affected:** `dashboard/+page.svelte`

---

## Task 3 — Fix sidebar breakpoint for medium screens (`md`)

**Issue:** The current sidebar uses `hidden md:flex`, which hides the sidebar below `768px` and shows it above. At exactly `md` width (768px–1023px) the sidebar is visible but the layout feels cramped — the 240px sidebar takes too much space on a tablet. On mobile (below `md`) the sidebar is gone entirely, but there is no fallback navigation offered until the bottom nav kicks in.

**Proposed solution (via Task 1):**
The shadcn Sidebar component solves this natively — it collapses to a 48px icon-only rail at `md` widths and expands to full width on `lg+`. This is the exact behaviour shown in the reference screenshot. Implementing Task 1 will resolve this as a side-effect.

**If Task 1 is deferred:** Adjust the breakpoint to `lg:flex` and add a hamburger menu for `md` screens (see Task 4).

---

## Task 4 — Mobile navigation: Settings & Sign-out accessibility

**Issue:** Below `md`, the sidebar is hidden. Settings and Sign-out are therefore completely inaccessible on mobile. The bottom tab bar only shows Dashboard / Accounts / Transactions / Export.

**Options:**

### Option A — Hamburger / Sheet drawer (recommended)
Add a hamburger icon to a top app bar (shown on mobile only). Tapping it opens a shadcn `Sheet` sliding from the left with the full sidebar content including Settings and Sign-out. This is a standard mobile pattern and keeps the bottom tab bar clean.

Implementation:
- Add a `<header class="md:hidden ...">` with app title + hamburger button.
- Use shadcn `Sheet` triggered by the hamburger.
- Reuse the sidebar link list inside the Sheet.

### Option B — Settings tab in bottom nav
Replace the Export tab with a Settings/Profile tab in the bottom nav (shifting Export to inside the Settings page or behind a button). Simpler, but loses a primary action.

### Option C — shadcn Sidebar Sheet mode (via Task 1)
The shadcn Sidebar's mobile mode renders as a Sheet automatically via `SidebarProvider`. This is the cleanest solution and makes Options A & B unnecessary. Dependent on Task 1.

**Recommended priority:** Do Task 1 first — it resolves Tasks 3 and 4 together.

---

## Summary & Recommended Order

| # | Task | Effort | Status |
|---|---|---|---|
| 1 | Migrate to shadcn Sidebar component | Medium | ✅ Done — `AppSidebar.svelte` + updated `(app)/+layout.svelte` |
| 2 | Badge for trend indicator | Trivial | ✅ Done — `dashboard/+page.svelte` |
| 3 | Sidebar breakpoint fix | Resolved by #1 | ✅ Done — shadcn Sidebar handles md/lg natively |
| 4 | Mobile Settings/Sign-out access | Resolved by #1 | ✅ Done — Sheet overlay on mobile via SidebarProvider |
