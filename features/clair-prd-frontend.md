# Clair — Product Requirements Document
## File 3 of 3: Frontend & Design System
**Version:** 1.0

> Read `clair-prd-main.md` first for stack decisions, Svelte 5 runes syntax rules, and
> project structure. This file covers everything visual: the design system, Tailwind v4
> CSS config, shadcn-svelte setup, shared components, and all 11 screen specifications.

---

## 1. Design reference

**Aesthetic:** Mynt (mynt.com) meets Revolut. Crisp white backgrounds, generous
whitespace, bold monospace numbers, subtle borders (not shadows), a single strong
accent colour used sparingly.

**Not:** Gradients, glassmorphism, dark-by-default, heavy animations.

**Primary colour:** Pink (`#ec4899` — Tailwind `pink-500`)  
**Positive amounts:** Emerald (`#10b981` — Tailwind `emerald-500`)  
**Negative amounts:** Rose (`#f43f5e` — Tailwind `rose-500`)

---

## 2. Tailwind configuration

This project uses **Tailwind CSS v4**. There is no `tailwind.config.ts`. Design tokens
are defined using the `@theme` directive in `src/routes/layout.css`.

```css
/* src/routes/layout.css */
@import 'tailwindcss';
@plugin '@tailwindcss/typography';

@theme {
  /* Primary — pink */
  --color-primary-50:  #fdf2f8;
  --color-primary-100: #fce7f3;
  --color-primary-200: #fbcfe8;
  --color-primary-300: #f9a8d4;
  --color-primary-400: #f472b6;
  --color-primary-500: #ec4899;   /* main brand */
  --color-primary-600: #db2777;
  --color-primary-700: #be185d;
  --color-primary-800: #9d174d;
  --color-primary-900: #831843;

  /* Success — positive amounts */
  --color-success-50:  #ecfdf5;
  --color-success-500: #10b981;
  --color-success-600: #059669;
  --color-success-700: #047857;

  /* Danger — negative amounts */
  --color-danger-50:  #fff1f2;
  --color-danger-500: #f43f5e;
  --color-danger-600: #e11d48;
  --color-danger-700: #be123c;

  /* Surfaces & borders */
  --color-surface:         #ffffff;
  --color-surface-raised:  #f9fafb;
  --color-surface-sunken:  #f3f4f6;
  --color-border:          #e5e7eb;
  --color-border-strong:   #d1d5db;
  --color-text-primary:    #111827;
  --color-text-secondary:  #6b7280;
  --color-text-tertiary:   #9ca3af;

  /* Fonts */
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
}

body {
  @apply bg-surface text-text-primary font-sans;
  -webkit-font-smoothing: antialiased;
}
```

---

## 3. shadcn-svelte setup

```bash
# Initialise shadcn-svelte in the SvelteKit project
npx shadcn-svelte@latest init
```

When prompted, choose:
- Style: Default
- Base colour: Zinc
- CSS variables: Yes

Then add the shadcn CSS variables into `src/routes/layout.css` (after the `@theme` block):

```css
/* Add to src/routes/layout.css — shadcn-svelte CSS variable overrides */
:root {
  --background:           0 0% 100%;
  --foreground:           222 47% 7%;
  --primary:              330 81% 60%;     /* pink-500 */
  --primary-foreground:   0 0% 100%;
  --muted:                220 14% 96%;
  --muted-foreground:     220 9% 46%;
  --border:               220 13% 91%;
  --input:                220 13% 91%;
  --ring:                 330 81% 60%;
  --radius:               0.625rem;
}
```

### Install components used across the app

```bash
npx shadcn-svelte@latest add button input label card
npx shadcn-svelte@latest add dialog sheet drawer
npx shadcn-svelte@latest add select dropdown-menu
npx shadcn-svelte@latest add tabs badge
npx shadcn-svelte@latest add toast skeleton
npx shadcn-svelte@latest add alert-dialog separator
npx shadcn-svelte@latest add popover calendar   # date range picker
```

---

## 4. Shared components

### Amount.svelte

Displays a monetary amount with correct sign, colour, and monospace font.

```svelte
<!-- src/lib/components/Amount.svelte -->
<script lang="ts">
  interface Props {
    value:    number
    currency?: string
    size?:    "sm" | "md" | "lg" | "xl"
  }
  let { value, currency = "EUR", size = "md" }: Props = $props()

  const sizeMap = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
    xl: "text-3xl",
  }

  const formatted = $derived(
    new Intl.NumberFormat("es-ES", {
      style:                 "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(Math.abs(value))
  )
  const sign   = $derived(value > 0 ? "+" : value < 0 ? "−" : "")
  const colour = $derived(
    value > 0 ? "text-success-600" : value < 0 ? "text-danger-600" : "text-text-secondary"
  )
</script>

<span class="font-mono tabular-nums {sizeMap[size]} {colour}">
  {sign}{formatted}
</span>
```

### CategoryChip.svelte

```svelte
<!-- src/lib/components/CategoryChip.svelte -->
<script lang="ts">
  interface Props { category: string; size?: "sm" | "md" }
  let { category, size = "sm" }: Props = $props()

  const COLOURS: Record<string, string> = {
    restaurants:   "bg-orange-100   text-orange-700",
    coffee:        "bg-amber-100    text-amber-700",
    groceries:     "bg-green-100    text-green-700",
    transport:     "bg-blue-100     text-blue-700",
    travel:        "bg-cyan-100     text-cyan-700",
    sports:        "bg-emerald-100  text-emerald-700",
    health:        "bg-rose-100     text-rose-700",
    subscriptions: "bg-violet-100   text-violet-700",
    transfers:     "bg-gray-100     text-gray-600",
    savings:       "bg-teal-100     text-teal-700",
    shopping:      "bg-pink-100     text-pink-700",
    utilities:     "bg-slate-100    text-slate-700",
    income:        "bg-lime-100     text-lime-700",
    other:         "bg-gray-100     text-gray-500",
  }
  const cls = $derived(
    COLOURS[category.toLowerCase()] ?? "bg-gray-100 text-gray-500"
  )
  const padCls = $derived(size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm")
</script>

<span class="inline-flex items-center rounded-full font-medium {cls} {padCls}">
  {category}
</span>
```

### BankLogo.svelte

```svelte
<!-- src/lib/components/BankLogo.svelte -->
<script lang="ts">
  interface Props { name: string; class?: string }
  let { name, class: cls = "" }: Props = $props()

  const PALETTE = [
    "bg-blue-500", "bg-emerald-500", "bg-violet-500",
    "bg-orange-500", "bg-pink-500",
  ]
  const colour = $derived(PALETTE[name.charCodeAt(0) % PALETTE.length])
  const letter = $derived(name[0]?.toUpperCase() ?? "?")
</script>

<div
  class="rounded-full flex items-center justify-center
         text-white font-semibold text-sm {colour} {cls}"
>
  {letter}
</div>
```

### EmptyState.svelte

```svelte
<!-- src/lib/components/EmptyState.svelte -->
<script lang="ts">
  import type { Snippet } from "svelte"
  interface Props {
    icon:        Snippet
    title:       string
    description: string
    action?:     Snippet
  }
  let { icon, title, description, action }: Props = $props()
</script>

<div class="flex flex-col items-center justify-center py-16 text-center px-4">
  <div class="w-12 h-12 rounded-full bg-surface-sunken
              flex items-center justify-center mb-4 text-text-tertiary">
    {@render icon()}
  </div>
  <p class="text-sm font-medium text-text-primary mb-1">{title}</p>
  <p class="text-sm text-text-secondary mb-4">{description}</p>
  {#if action}{@render action()}{/if}
</div>
```

---

## 5. Navigation layout

### Desktop — left sidebar (240px)

```svelte
<!-- src/lib/components/layout/Sidebar.svelte -->
<script lang="ts">
  import { page } from "$app/state"

  const links = [
    { href: "/dashboard",    label: "Dashboard",     icon: "home" },
    { href: "/accounts",     label: "Accounts",      icon: "credit-card" },
    { href: "/transactions", label: "Transactions",  icon: "arrow-left-right" },
    { href: "/export",       label: "Export",        icon: "download" },
  ]
</script>

<nav class="hidden md:flex flex-col w-60 min-h-screen
            border-r border-border bg-surface px-3 py-6 gap-1">
  <!-- Logo -->
  <span class="text-xl font-semibold text-primary-600 px-3 mb-6">Clair</span>

  {#each links as link}
    <a
      href={link.href}
      class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm
             transition-colors
             {page.url.pathname.startsWith(link.href)
               ? 'bg-primary-50 text-primary-600 font-medium'
               : 'text-text-secondary hover:bg-surface-sunken hover:text-text-primary'}"
    >
      <!-- icon slot -->
      {link.label}
    </a>
  {/each}

  <div class="mt-auto border-t border-border pt-4 flex flex-col gap-1">
    <a href="/settings"
       class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm
              text-text-secondary hover:bg-surface-sunken">
      Settings
    </a>
    <!-- User avatar + name -->
  </div>
</nav>
```

### Mobile — bottom tab bar

```svelte
<!-- src/lib/components/layout/BottomNav.svelte -->
<script lang="ts">
  import { page } from "$app/state"
  const tabs = [
    { href: "/dashboard",    label: "Home",         icon: "home" },
    { href: "/accounts",     label: "Accounts",     icon: "credit-card" },
    { href: "/transactions", label: "Transactions", icon: "arrow-left-right" },
    { href: "/export",       label: "Export",       icon: "download" },
  ]
</script>

<nav class="md:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-border
            flex h-16 z-50">
  {#each tabs as tab}
    <a href={tab.href}
       class="flex-1 flex flex-col items-center justify-center gap-1
              {page.url.pathname.startsWith(tab.href)
                ? 'text-primary-500'
                : 'text-text-tertiary'}">
      <!-- icon -->
      <span class="text-[10px] font-medium">{tab.label}</span>
    </a>
  {/each}
</nav>
```

### Protected layout

```svelte
<!-- src/routes/(app)/+layout.svelte -->
<script lang="ts">
  import Sidebar    from "$lib/components/layout/Sidebar.svelte"
  import BottomNav  from "$lib/components/layout/BottomNav.svelte"
  import type { LayoutData } from "./$types"
  let { data, children }: { data: LayoutData; children: any } = $props()
</script>

<div class="flex min-h-screen bg-surface-raised">
  <Sidebar />
  <main class="flex-1 pb-20 md:pb-0">
    {@render children()}
  </main>
  <BottomNav />
</div>
```

---

## 6. Design rules

| Rule | Spec |
|---|---|
| Page padding mobile | `px-4 py-6` |
| Page padding desktop | `px-8 py-8` |
| Card gap | `gap-3` mobile, `gap-4` desktop |
| Section spacing | `mt-8` between major sections |
| Touch target min height | `h-11` (44px) |
| Card style | `bg-surface rounded-xl border border-border p-4 shadow-sm` |
| Heading style | `text-base font-semibold text-text-primary` — never all-caps |
| Label style | `text-sm text-text-secondary` |
| Amounts | Always `font-mono tabular-nums` — use `<Amount>` component |
| Dates in lists | `Mar 24` short form |
| Dates in detail | `Monday, 24 March 2025` full form |
| Number format | `€1,234.56` — `es-ES` locale via `Intl.NumberFormat` |
| Animation | shadcn Sheet/Dialog built-in only — no custom animations |
| Loading state | shadcn `Skeleton` component |
| Errors | shadcn `Toast` (top-right) + inline field validation |
| Destructive actions | Always via shadcn `AlertDialog` first |

---

## 7. Screen specifications

All screens are **mobile-first**. Design for 375px viewport, scale up.
Use placeholder data exactly as specified — AI tools use this to make layout decisions.

---

### Screen 1 — Login `/login`

No sidebar/nav. Full-height centred card on `bg-primary-50`.

```
[Clair — pink-600 wordmark, 24px semibold]

     Sign in to Clair

     [Email address input]
     [Password input — with show/hide toggle]

     [Sign in — full-width, primary button]

     Forgot password?

  ─────────────────────────────────────
  Access is by invitation only.          ← text-xs text-text-tertiary, centered
```

---

### Screen 2 — Accept Invite `/invite/[token]`

Same card layout as login.

```
     You've been invited to Clair
     Pablo invited you to join his workspace.    ← text-sm text-text-secondary

     [Full name input]
     [Password input]
     [Confirm password input]

     [Create account — full-width, primary]
```

Expired/used token state: full-page centred error with "This invite has expired."
and a "Back to login" link.

---

### Screen 3 — Dashboard `/dashboard`

**Balance strip** — horizontal scroll on mobile, 3-column grid on desktop.

Each account card (compact):
```
┌────────────────────────────────────┐
│ [●] BBVA Main           Active  ● │  ← logo 32px, status dot
│     ···1234                        │
│                                    │
│         €4,832.50                  │  ← Amount size="lg"
│                                    │
│ Last upload: 3 days ago            │  ← text-xs text-text-tertiary
└────────────────────────────────────┘
```

Show these 5 accounts:
```
BBVA Main      ···1234   €4,832.50    Active
CaixaBank      ···5678   €1,204.00    Active
Bankinter      ···9012   €12,500.00   Active   ← add "Shared" chip (bg-primary-100 text-primary-700)
Revolut        ···3456   €340.20      Active
MyInvestor     ···7890   €8,920.00    Active
```

**Alert banners** (only shown when relevant, below the strip):
```
⚠  3 transactions need review.        [Review →]    ← amber-50 bg, amber-600 text
⚠  2 unmatched transfers.             [Link them →] ← orange-50 bg, orange-600 text
```

**Recent transactions** ("Recent transactions" heading + "View all →" top-right):

On mobile, each row is 2 lines:
```
Line 1: [CategoryChip]  Description text
Line 2: [AccountChip]   Date (muted)     Amount (right-aligned, coloured)
```

Use this data:
```
● Groceries    Mercadona 0234 Madrid       BBVA      Mar 24   −€47.30
● Subs         Netflix.com                 Revolut   Mar 24   −€15.99
● Income       Nomina Empresa S.L.         BBVA      Mar 23   +€2,800.00
● Coffee       Cafetería Central           BBVA      Mar 23   −€3.50
↔ Transfer     Traspaso a Revolut          BBVA      Mar 22   −€500.00  ← opacity-60
↔ Transfer     Transfer from BBVA          Revolut   Mar 22   +€500.00  ← opacity-60
● Shopping     El Corte Inglés Madrid      CaixaBank Mar 21   −€89.00
● Sports       Gimnasio Holmes Place       BBVA      Mar 21   −€49.90
● Transport    Uber                        Revolut   Mar 20   −€12.40
● Restaurants  Glovo                       BBVA      Mar 19   −€24.80
```

---

### Screen 4 — Accounts List `/accounts`

Header: "Accounts" + "Add account" button (primary, small, top-right).

**Account card** (full width mobile, 2-col desktop):
```
┌──────────────────────────────────────────────────────┐
│  [●] BBVA Main                            Active  ●  │
│      ···1234 · EUR                                   │
│                                                      │
│      €4,832.50                                       │  ← Amount size="lg"
│      Last upload: Mar 24 · 312 transactions          │  ← text-xs muted
│                                                      │
│  [Upload CSV]    [Share ▾]    [···]                   │  ← button row
│                                                      │
│  🔒 Automatic sync — Coming soon · Premium           │  ← bottom strip, sunken bg
└──────────────────────────────────────────────────────┘
```

The "Coming soon" strip: `bg-surface-sunken border-t border-border text-xs
text-text-tertiary px-4 py-2 rounded-b-xl`.

**Empty state:**
```
[credit-card icon, 24px, text-tertiary]
No bank accounts yet
Add your first account to get started.
[Add bank account — primary button, small]
```

---

### Screen 5 — Account Detail `/accounts/[id]`

```
← Back to Accounts

BBVA Main                            [Edit name]
···1234 · EUR

€4,832.50                            Status: Active

─────────────────────────────────
UPLOAD HISTORY
Filename            Date range     Imported  Uploaded
march_2025.csv      Jan–Mar 2025   312       Mar 24
jan_2025.csv        Oct–Dec 2024   287       Jan 15

─────────────────────────────────
SHARING
Shared with: María García  ·  Accepted   [Revoke]

[Share with someone else...]

─────────────────────────────────
DANGER ZONE
[Remove account]  ← danger variant button
```

---

### Screen 6 — CSV Upload Flow

**Bottom Sheet on mobile, centered Dialog (max-w-lg) on desktop.**  
Step indicator at top: `Step 1 of 4` with a thin progress bar.

**Step 1 — Select file:**
```
Upload transactions
BBVA Main

┌──────────────────────────────────────────┐
│                                          │
│   ↑  Drop your CSV file here             │
│      or tap to browse                    │
│                                          │
│      Accepts .csv up to 10MB             │
│                                          │
└──────────────────────────────────────────┘

Detected format: BBVA Spain  ✓
[Wrong bank? Change format ↓]           ← opens a Select dropdown
```

**Step 2 — Preview:**
```
Looks good — here's what we found

Date          Description                Amount    Currency
24/03/2025    MERCADONA 0234 MADRID       −47.30    EUR
23/03/2025    NOMINA EMPRESA SL         +2800.00    EUR
23/03/2025    CAFETERIA CENTRAL            −3.50    EUR
22/03/2025    TRASPASO A REVOLUT          −500.00   EUR
21/03/2025    EL CORTE INGLES MADRID       −89.00   EUR

324 rows detected · Jan 2025 – Mar 2025
⚠ 3 rows could not be parsed and will be skipped   ← amber warning
```

**Step 3 — Current balance** (skip if profile has a balance column):
```
What is your current balance?

Open your BBVA Main app and enter
the balance shown right now.

    € [_______________]                ← large input, autofocus

This lets us display accurate account
balances across all your history.
```

**Step 4 — Confirm:**
```
Ready to import

┌─────────────────────────────┐
│  New transactions      312  │
│  Status updates          5  │  ← PENDING→COMPLETED upgrades (shown only if > 0)
│  Duplicates skipped      8  │
│  Needs review            4  │
│  Date range    Jan–Mar 2025 │
└─────────────────────────────┘

[Import 312 transactions — full width, primary]
         Cancel
```

"Status updates" row: only show when > 0. Tooltip on hover/tap:
`"5 transactions moved from Pending to Completed. Your notes and categories are preserved."`

**Result state (replace modal content after import):**
```
✓  312 transactions imported

   5 status updates · 8 duplicates skipped · 4 flagged for review

[View transactions →]     [Upload another file]
```

---

### Screen 7 — Transactions `/transactions`

**Filter bar** (sticky, `top-0 z-10 bg-surface border-b border-border`):

Mobile — search input full width + "Filters" button that opens a bottom drawer:
```
[🔍 Search descriptions...]    [Filters ▾]
```

Desktop — inline filters:
```
[🔍 Search...]  [Account ▾]  [Category ▾]  [Date range]  [More ▾]  [Clear]
```

**Tabs** (below filter bar):
```
All (324)    Expenses (298)    Transfers (18)    Review (4)
```
Active tab: `border-b-2 border-primary-500 text-primary-600 font-medium`

**Transaction list:**

Mobile — 2-line rows:
```
● Groceries  Mercadona 0234 Madrid                    −€47.30
             BBVA  ·  Mar 24                         [tap row]
```

Desktop — table with columns: Date | Description | Account | Category | Amount | Actions

Show these rows (use exactly this data):
```
● Groceries    Mercadona 0234 Madrid        BBVA      Mar 24   −€47.30
● Subs         Netflix.com                  Revolut   Mar 24   −€15.99
● Income       Nomina Empresa S.L.          BBVA      Mar 23   +€2,800.00
● Coffee       Cafetería Central            BBVA      Mar 23   −€3.50
↔ Transfer     Traspaso a Revolut           BBVA      Mar 22   −€500.00    ← opacity-60
↔ Transfer     Transfer from BBVA           Revolut   Mar 22   +€500.00    ← opacity-60
● Shopping     El Corte Inglés              CaixaBank Mar 21   −€89.00
● Sports       Gimnasio Holmes Place        BBVA      Mar 21   −€49.90
⚠ ? Review     Pago Bizum                   BBVA      Mar 20   −€150.00    ← amber left border
● Transport    Uber *trip                   Revolut   Mar 20   −€12.40
● Restaurants  Glovo                        BBVA      Mar 19   −€24.80
↔⚠ Unmatched  Bizum a Pablo García          BBVA      Mar 18   −€200.00    ← both ↔ and ⚠
● Health       Farmacia Cruz Verde           BBVA      Mar 18   −€18.50
● Subs         Spotify                      Revolut   Mar 17   −€9.99
● Transport    Renfe Cercanías              BBVA      Mar 17   −€5.40
```

Review rows: `border-l-2 border-amber-400 bg-amber-50/30`
Transfer rows: `opacity-70`

Each row tappable → opens Transaction Detail (Screen 8).

**Pagination:** `Showing 1–25 of 324  ←  →  25 per page`

---

### Screen 8 — Transaction Detail Panel

**Right-side panel on desktop** (400px, `border-l border-border`).  
**Full-screen Sheet on mobile** (slides from bottom).

```
← Back (mobile only)

MERCADONA 0234 MADRID
Mar 24, 2025  ·  BBVA ···1234

          −€47.30                          ← Amount size="xl", centered

─────────────────────────────────────
CATEGORY
[● Groceries  ▾]                           ← clicking opens an inline grid picker
AI confidence: 87%  ████████░░

─────────────────────────────────────
TAGS
[groceries ×]  [weekly ×]  [+ Add tag]    ← chips, inline input

─────────────────────────────────────
NOTES
[Free-form note about this transaction]   ← single-line text input, auto-save on blur
                                            placeholder: "Add a note…"

─────────────────────────────────────
CITY / TRIP
[Copenhagen ▾]                            ← free text + recent values dropdown
                                            placeholder: "City or trip name…"

─────────────────────────────────────
TRANSFER
[Mark as transfer]                         ← secondary button

─────────────────────────────────────
▸ Raw data                                ← collapsible
  booking_date   2025-03-24
  external_id    TXN-20250324-047
  sync_source    csv_upload
  status         posted

─────────────────────────────────────
▸ History                                 ← collapsible
  Category set to "groceries" by Pablo · Mar 24
```

**When `isTransfer = true` and linked:**
```
LINKED TRANSFER
┌──────────────────────────────────┐
│  Revolut ···3456                 │
│  Mar 22 · +€500.00               │
│  "Transfer from BBVA"            │
└──────────────────────────────────┘
[Unlink]                               ← danger variant, small
```

**When `isTransfer = true`, no counterpart:**
```
LINKED TRANSFER
⚠  Counterpart not uploaded yet
[Find counterpart →]                   ← opens Transfer Linking Dialog
```

---

### Screen 9 — Transfer Linking Dialog

**Modal** (`max-w-md`), triggered from transaction detail or after upload.

```
┌───────────────────────────────────────────────────────┐
│  Mark as Transfer                               [✕]   │
│                                                       │
│  ┌─────────────────────────────────────────────────┐  │
│  │  BBVA ···1234                                   │  │
│  │  22 Mar 2025  ·  −€500.00                       │  │
│  │  "Traspaso a Revolut"                           │  │
│  └─────────────────────────────────────────────────┘  │
│                                                       │
│  Link to counterpart transaction:                     │
│                                                       │
│  ◉  Revolut ···3456  ·  Mar 22  ·  +€500.00          │
│     "Transfer from BBVA"              Best match      │  ← badge: bg-success-50 text-success-700
│                                                       │
│  ○  Revolut ···3456  ·  Mar 20  ·  +€500.00          │
│     "Top up"                                          │
│                                                       │
│  ───────────────────────────────────────────         │
│                                                       │
│  ○  The other side hasn't been uploaded yet.          │
│     Mark this side only for now.                      │
│                                                       │
│  ○  This is not a transfer — remove this flag         │
│                                                       │
│                   [Cancel]   [Confirm →]              │  ← Confirm disabled until selection
└───────────────────────────────────────────────────────┘
```

Show up to 5 candidates. "Show more results" link if more exist.

---

### Screen 10 — Export `/export`

**Single column on mobile. Two-panel on desktop** (filters left, preview right).

```
Export transactions

ACCOUNTS
[✓] BBVA Main ···1234
[✓] CaixaBank ···5678
[✓] Bankinter ···9012
[✓] Revolut ···3456
[✓] MyInvestor ···7890

DATE RANGE
[Jan 1, 2025] to [Mar 24, 2025]

OPTIONS
Include transfers    [  toggle off  ]
Use my corrections   [  toggle on   ]

──────────────────────────────────
PREVIEW (first 3 rows):

Date         Description            Amount  Category
2025-03-24   Mercadona 0234 Madrid   -47.30  groceries
2025-03-23   Nomina Empresa SL     2800.00   income
2025-03-23   Cafetería Central       -3.50   coffee

──────────────────────────────────
[Download CSV — full width, primary]
```

---

### Screen 11 — Settings `/settings`

**Tabs:** Categories | CSV Columns | Members | Account

**Categories tab:**
```
[●] Restaurants    ████   [rename]  [🗑]
[●] Coffee         ████   [rename]  [🗑]
[●] Groceries      ████   [rename]  [🗑]
[●] Transport      ████   [rename]  [🗑]
[●] Travel         ████   [rename]  [🗑]
[●] Sports         ████   [rename]  [🗑]
[●] Health         ████   [rename]  [🗑]
[●] Subscriptions  ████   [rename]  [🗑]

[+ Add category]
```

Colour dot is a `<button>` that opens a small colour-picker popover.

**CSV Columns tab:**
```
[✓]  Date          booking_date    ☰
[✓]  Description   description     ☰
[✓]  Amount        amount          ☰
[✓]  Currency      currency        ☰
[✓]  Category      effective cat   ☰
[✓]  Account       display_name    ☰
[ ]  Payer         payer_name      ☰    ← toggled off by default
[✓]  Tags          tags (csv)      ☰
[ ]  Notes         notes           ☰    ← toggled off by default
[ ]  City          city            ☰    ← toggled off by default

[Restore defaults]
```

**Members tab (owner only):**
```
Pablo García    Owner    pablo@example.com
María García    Member   maria@example.com    Joined Jan 2025    [Remove]

──────────────────────────────────────
Invite someone
[email address input]     [Send invite →]

Pending invites:
  invitee@example.com  ·  Sent Mar 20  [Revoke]
```

**Account tab:**
```
Change password
[Current password]
[New password]
[Confirm new password]
[Update password — primary button, small]

──────────────────────────────────────
Notifications
[✓] Email me when bank consent is expiring
```

---

## 8. Empty states reference

Every list needs an empty state. Use `<EmptyState>` component (Section 4).

| Screen | Title | Description | CTA |
|---|---|---|---|
| Accounts | No bank accounts yet | Add your first account to get started. | Add bank account |
| Transactions | No transactions yet | Upload a CSV file to import your first transactions. | Upload CSV |
| Transactions (filtered) | No matching transactions | Try adjusting your filters. | Clear filters |
| Export | No accounts selected | Select at least one account to export. | — |
| Members | Only you so far | Invite someone to share accounts with them. | Invite someone |

---

## 9. Loading states

Use shadcn-svelte `Skeleton` for all loading states:

```svelte
<!-- Account card skeleton -->
<div class="bg-surface rounded-xl border border-border p-4 space-y-3">
  <div class="flex items-center gap-3">
    <Skeleton class="w-8 h-8 rounded-full" />
    <Skeleton class="h-4 w-32" />
  </div>
  <Skeleton class="h-7 w-24" />
  <Skeleton class="h-3 w-40" />
  <div class="flex gap-2 mt-2">
    <Skeleton class="h-9 w-28" />
    <Skeleton class="h-9 w-20" />
  </div>
</div>

<!-- Transaction row skeleton -->
<div class="flex items-center gap-3 py-3 border-b border-border">
  <Skeleton class="h-5 w-16 rounded-full" />  <!-- category chip -->
  <Skeleton class="h-4 flex-1" />              <!-- description -->
  <Skeleton class="h-4 w-16" />               <!-- amount -->
</div>
```