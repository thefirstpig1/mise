---
name: mise-ui-review
description: Kong's standing UI rules for คิดครัว/Mise and the page-by-page review loop — load BEFORE building or changing any screen, chart, list, table, form picker or popup, and whenever Kong says "มาต่อที่หน้า…" or reviews a page. Covers clickability, lists, pickers, charts, popups, comparisons, copy, and how to verify.
---

# Mise UI review — rules Kong has already given (do not make him repeat them)

Kong reviews the app one page at a time and says what is wrong. Everything
below was decided in those reviews (2026-09-28 session). Apply it everywhere
you touch, **without being told page by page** — Kong: "อย่าให้ต้องบอกทีละจุด
ถ้าทำตรงไหนแล้วมันดีก็ทำ แล้วก็แค่บอก".

## 0. How to work a review
- Reply in **Thai**, polite customer-facing register (never dev-casual). Kong
  once had to say "เอ็ง reply มาเป็นภาษาอังกฤษ แปลดิ้" — never again.
- Fix what he names, then **apply the same fix to every other place with the
  same shape** and list those in the reply.
- Verify with **real clicks in Chrome** (claude-in-chrome), not by reading code.
  Record numbers you checked. Clean up any test data you created.
- Before reporting: `pnpm tsc` → build procedure (below) → commit with a message
  that quotes Kong's point. Report in Thai: what changed, what you verified,
  what you found on the way, and anything you did NOT do.
- If he asks "can the system answer X?" — answer from real data, and say
  honestly whether the SCREEN can answer it. Then propose what is missing.

## 1. Clickable things
- **A row that opens something is clickable ANYWHERE on the row**, not just its
  name. Tables: stretched link — `<tr className="group relative … hover:bg-muted/50">`,
  main link gets `after:absolute after:inset-0 after:content-['']`, any second
  link/button in the row gets `relative z-10`. Card rows: the whole card is the
  `<a>`/`<button>`. Client tables: `onClick` on the `<tr>` + `cursor-pointer`.
- **No arrows/chevrons on rows in a list.** Hover highlight + pointer cursor is
  enough. `RowChevron` renders nothing without a label; use a label only for a
  STATUS the row is waiting on ("นับต่อ", "กดรับ", "รอรับ") — never "ดูรายละเอียด".
- An inline dish/item name that opens something (not a whole row) = `MenuLink`
  style: dotted underline at rest, solid + brand colour on hover.
- Pills that would wrap: `whitespace-nowrap`.

## 2. Choosing an item (products, menus, orders)
- **Never a `<select>` of every product/menu** ("หากันตาแตกถ้ามี 1000 รายการ").
  Use `ProductPicker` (`src/components/ui/ProductPicker.tsx`): type-to-search,
  browse grouped by category (categories A→Z, items A→Z within), optional quick
  picks. It posts a hidden input by `name`. Works for POs too (PO number in `sku`,
  branch as `section`).
- A single-option choice (e.g. one branch in reach) is plain text, not a select.
- Responsibility is the **logged-in account** (counter, recorder, requester) —
  never a free-text/dropdown "who" that could name someone else. A free-text
  name is kept only when it means something else, and is labelled as such.

## 3. Charts (all live in `src/components/charts/chart-theme.tsx`)
- One look everywhere: olive-family **gradients**, **terracotta (clay) marks the
  one thing the chart points at** (best day, open day, best seller), status
  good/bad only for good/bad for the shop. Categories keep ONE colour across the
  whole page (tones assigned in sales order), shown as a dot.
- **Motion on every chart**: spread `ANIM` on Bar/Line/Area (Recharts' default
  `"auto"` showed nothing moving); key the chart by its data so a new filter
  replays it; CSS bars use `animate-grow-x` (scaleX) with a small stagger;
  popups use `animate-fade-in` / `animate-pop-in`.
- Heatmaps: ONE sequential scale (cream → deep olive), never per-row hues ("looked
  made by different vendors"); readable medium-weight numbers; mark the best cell
  with **★**, not bold; include a legend.
- Values on bars when it helps (LabelList); a dashed average line on daily charts;
  weekends visibly different in daily sales.
- Click a bar to open detail: put `clickableBar(...)` on the **Bar**, never the
  chart-level onClick (Recharts 3 reads hover state → silent in background tabs).
- Never ฿0 for "no data" — show "—" and say why ("ยังไม่มีไฟล์", "ไม่มีสูตร").

## 4. Popups
- Kong likes popups ("ประหยัดเนื้อที่ ดูเชื่อมโยงกับข้อมูล"): open detail as a
  popup over the page instead of a panel further down. Shared pieces:
  `ModalShell`, `BreakdownPanes` (categories left, menus right) in
  `src/app/(app)/sales/_components/Breakdown.tsx`. Esc / click outside closes.
- No 100% "ทุกหมวด" row — the total goes in the title; clicking the selected
  category again returns to all.
- Any popup that RANKS several items carries the **measure switch** in its
  header (`PopupMetricSwitch`) — ยอดขาย read as กำไร is the worst confusion.
  **Exception — a popup about ONE item** (the menu insight popup): no switch.
  Its sales, plates, cost and profit are all on screen at once, so switching
  only repeats them (Kong 2026-09-29). It reads in ยอดขาย.

## 5. Numbers and comparisons (see docs/calculation-rules.md SI1–SI3)
- Offer **ยอดขาย / จำนวนจาน / กำไร** wherever a ranking is shown — a cheap dish
  customers eat daily matters as much as the top earner. Switching must NOT
  reload the page: `router.push(href, { scroll: false })` inside `useTransition`
  (`MetricSwitch`), old screen stays up, show "กำลังคำนวณ…".
- Compare periods **per day with data**, never totals (Aug had 19 days, Sep 26).
- **Every % names what it is compared with**: "▼ 9.9% เทียบ ส.ค. 69", period
  chips on section headers (`periodLabelTh`). "จากช่วงก่อน" alone is not allowed.
- Sales figures are after discount, excl VAT & service charge; profit per dish =
  price after discount − recipe cost (as of period end), and a cost never
  appears without its confidence. Only people with cost access see profit.

## 5b. Speed (Kong: "ช้ากว่าเฟซบุ้คสมัยก่อน")
- **Measure before changing anything**: time the page with
  `fetch(url, {headers: {RSC: "1"}})` from the tab, count `prisma:query` lines
  in the dev log per load, and time one `select 1` (dev ↔ Neon ≈ 32 ms). A
  `next start` build was just as slow — dev mode was NOT the cause.
- Cost is round trips × 32 ms. Each `withTenantContext` = BEGIN + set_config +
  queries (sequential) + COMMIT. Keep independent reads in PARALLEL
  transactions; never fold them into one (that serialises them).
- A view switch must not go to the server: build every cheap measure in one
  pass (`sales-views.ts`) and switch with state; fetch the expensive one
  (profit = recipe cost walk) in the background after first paint, keyed by
  the filters. Keep `?by=` in the URL with `history.replaceState`.
- `requireTenant` identity is cached per request (layout + page share it).
- Background tabs throttle timers to ~1 s — measure UI switches with a
  MutationObserver, not setTimeout polling.
- **Every press answers at once, even if the figures cannot** (Kong 2026-09-29,
  dashboard): the pressed chip/bar lights up immediately (local state while
  `useTransition` is pending) and a "กำลังคำนวณ…" shows. A `router.push`
  outside a transition, with nothing changing on screen, reads as "stuck".
- **Don't recompute what a click cannot change.** The dashboard's 6-month chart
  was 6 full P&Ls rerun on every period click; it now loads itself (from a
  client component) once per BRANCH choice. Before adding work to a Server
  Component page, ask which URL params actually change it.
- **Reuse what the page already holds.** The menu popup walked every recipe of
  every branch to price one dish; the profit view had that cost already
  (`withDishCost`). Cache popup results per key for re-opens.
- Slow reads belong in their own `<Suspense>` so the frame appears first.

### 5c. Speed rules from /menus (Kong 2026-10-04: "จะได้ไม่ต้องคอยแก้ทุกรอบ")
Apply these to EVERY new screen from the start, and to an old one whenever you
touch it. Each one was a measured second on a real page.
- **Reads a client component makes after paint go through a GET route handler,
  NOT a Server Action.** Server Actions are for writes. Next runs them one at a
  time through the router's queue, so three reads fired together wait on each
  other — and a URL change (`history.replaceState`, `router.push`) while one is
  queued DROPS its answer with no error: /menus sat on "กำลังคำนวณ…" for ever.
  Pattern: `src/app/api/<area>/route.ts` (`GET`, `?what=…`, the same
  `requireTenant` + `assertBranch` gates, `Cache-Control: no-store`) and a tiny
  client `read()` helper that treats a redirect/HTML answer as "refresh"
  (`menus/_components/prefetch.ts`). GET reads run side by side for real.
  Helpers: `readApi()` / `readInput()` / `guardRead()` in `src/lib/read-api.ts`
  (a redirect or HTML answer becomes `{ ok:false }`; malformed input a 400, never
  a 500; a redirect to /login or /denied passes through). Moved 2026-10-04:
  /sales profit view, menu insight, compare (`/api/sales`), dashboard trend
  (`/api/dashboard`), /menus (`/api/menus`). The rest still on actions are
  listed in docs/sprint-progress.md — move each when its page is reviewed.
- **Never block first paint on the expensive part.** Paint the list from cheap
  reads; load the costly one (a FIFO replay, a recipe walk) after paint. Money
  that has not arrived shows a pulse bar or "…"/"กำลังคำนวณ…" — NEVER ฿0, never
  "ไม่มีราคา", which are claims about the data.
- **Compute an expensive thing ONCE per key and share it.** /menus priced every
  recipe three times (page, sheet, adder). One "price book" per branch, kept
  in client state keyed by branch, now feeds the table, the sheet, the adder and
  the stacked sheet. After any WRITE, drop it (a central recipe moves every
  branch's prices) and refetch.
- **Run what does not depend on each other in parallel** — including the
  awaits BEFORE a `Promise.all` (`branches` then `freshest` was two round trips
  for no reason). **Fold what does depend** into the SAME transaction
  (`ingredientFactsInTx`): a second `withTenantContext` is ~4 extra round trips.
- **Don't compute what the screen hides.** /recipes priced every dish while
  showing only prepped items; a flag (`only: "prepped"`) skipped it.
- **Start a popup/sheet's read on hover-intent** (pointer rests 150 ms on the
  row), cache the promise per key, and let the click reuse it. Drop the cache
  after a write. Hovering across a list must not fire a read per row.
- **Pin a new fast read to the old slow one with a test, and watch it go red**
  (nudge a number 1 %). Run the WHOLE file when you do: `-t "one test"` skips
  the tests that create the data, and the assertion passes on an empty loop.
- **Measuring:** time each `*Logic` with a throwaway `tsx` probe from the repo
  root (repeat twice; the first call pays connection warm-up); in the browser
  read `performance.getEntriesByType("resource")` for real request durations.
  A hidden tab throttles timers, so UI timings taken there are wrong.

## 6. Permissions on any read
- "ทุกสาขา" means every branch **the reader may see**. Sales reads take a
  required `reach` (`branchWhere`); a branch id from the URL is never trusted.

## 7. Traps that cost time this session
- **Never import a value (constant, helper) from a `"use client"` file into a
  Server Component** — you get a client reference: colours silently undefined,
  or "Attempted to call X() from the server". Shared values live in plain
  modules (`chart-theme.tsx`, `src/lib/sales-insight.ts`). tsc and build pass;
  only loading the page in the affected mode shows it.
- **A tab older than the server** (every dev restart, every deploy) calls a
  Server Action id the server no longer has. Next does NOT throw — the call
  resolves to `undefined`, and `res.ok` crashes the page to the error screen.
  Wrap every client-side action call: `await orStale(someAction(...))`
  (`src/lib/stale-tab.ts`) — it returns a normal `{ ok:false, formError, error }`
  and raises the app-wide `VersionBanner`, which also polls `/api/version` on
  tab focus. Actions returning a non-`{ok}` shape: `.catch(() => undefined)` +
  `announceStale()`.
  Reproduce by loading the page, restarting dev, then clicking — not by a
  fresh load, which always works.
- **A NEW Server Action is unknown to a running dev server** until it restarts:
  the dev log says `Failed to find Server Action`, and `orStale` turns it into
  a silent `ok:false`. Restart dev after adding an action, before testing.
- **`position: fixed` inside the page frame is fixed to the FRAME** (it animates
  in with a transform), so a sheet or toast starts below the top or lands
  off-screen. Render overlays through a portal into `<body>` (`Portal` in
  `menus/_components/sheet-parts.tsx`).
- typedRoutes: cast built strings `as Route` for `router.push`/`Link`.
- Prisma `Decimal` cannot cross to a Client Component — convert to numbers.
- Every tenant-table read goes through `withTenantContext` (RLS); only
  `src/lib/require-tenant.ts` may use `prismaBypass`.
- Long Thai source edits: write a Python script to the scratchpad and run it
  (bash heredocs choke on long Thai); `git commit -F -` with a heredoc for
  messages. Delete files with PowerShell `Remove-Item`.

## 8. Build / dev procedure (Windows)
1. Stop node (`Get-Process node | Stop-Process -Force`) — the dev server locks
   Prisma's DLL and `.next`.
2. Remove `.next`, `pnpm build` (check "Generating static pages (N/N)" and no
   "Type error"; "Compiled successfully" alone proves nothing), remove `.next`.
3. Restart `pnpm dev` in the background.
- While dev runs, `pnpm tsc` may show `RouteImpl` errors from the dev server's
  partial route types — filter them (`grep -v RouteImpl`); the build is the truth.
- Chrome screenshots of a background tab often time out; use DOM checks
  (`javascript_tool`) and `document.visibilityState`, retry the screenshot once.

## 9. Deferred on purpose (do not build without asking)
- Photos (products, menus, transfer evidence) — waiting for Tigris object
  storage, after the UI pass. Leave a visible slot.
- Promotion log (menu + dates → before/during/after) — needs a new table; ask.
- /categories as boxes per group — Kong: do it when we reach that page.
