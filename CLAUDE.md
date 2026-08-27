# Mise — Restaurant Back-Office Platform

## What is this project
B2B SaaS for Thailand restaurant SMEs. "MarketMan-for-Thailand-SME" — 90% cheaper, 30-min setup, works without recipes.

## Project Status
- Sprint 0: ✅ COMPLETE (May 17, 2026) — Auth, Tenant, Branch, Department, RLS
- Sprint 1: ✅ COMPLETE (June 7, 2026) — Master Data (Suppliers, Products, Categories, Multi-unit, Supplier-Product Mapping)
- Sprint 2: ✅ COMPLETE (2026-08-17) — Part 10 Stock Movement (append-only ledger, ADR 0011) · Part 11 Purchase Order (ADR 0012) · Part 13 Goods Receipt (ADR 0013) · Part 13.5 carry-forward debt payoff (adjust `submit_key` + advisory-lock counters, closes Pitfall #25) · Part 14 Cost Engine (**FIFO by ledger replay, stored nowhere** — ADR 0014). Part 12 unallocated (Part 11 absorbed it). Next: **Sprint 3 — Stock Count + Expense + yield-correct CONSUMPTION**; see docs/sprint-progress.md
- Sprint 3: ✅ COMPLETE (2026-08-18) — Step 0 Neon cleanup ✅ · Part 15 Stock Count (ADR 0015) ✅ COMPLETE 2026-08-17 · Part 16 Expense (ADR 0016) ✅ COMPLETE 2026-08-17 — `expense`/`expense_item`/`recurring_expense`, VAT + WHT (withheld on the **pre-VAT** base), a confirmed goods receipt writes its own expense, and stock now carries the VAT an unregistered shop cannot reclaim; Part 17 Waste + par level (ADR 0017) ✅ **COMPLETE 2026-08-18** (L0–L6 + UX pass) — `waste_log` is a document with `SourceType.WASTE_LOG` posting an ordinary `ADJUST_LOSS` (**not** a new MovementType), `par_level` per product×branch with a three-state alert and a freshness line; `/cost`'s ของเสีย column now means `WASTE_LOG` alone and `SPOILAGE`/`DAMAGE` left the adjustment form. Part 18 inter-branch transfer (ADR 0018) ✅ **COMPLETE 2026-08-18** (L0–L6) — `stock_transfer`/`stock_transfer_item` where **both legs post at dispatch** (stock in transit belongs to the RECEIVING branch; the `SENT`/`RECEIVED` status is about paperwork, **not** stock), the ledger gained **four real movement types** `TRANSFER_*` (unlike waste — FIFO must cut the layer a transfer pushed, ADR 0014 Q8), the sending branch's FIFO money is **frozen onto the line with its `cost_source`** (the one deliberate exception to ADR 0014's "cost is stored nowhere"), what never arrives posts as `TRANSFER_SHORTAGE` at the receiver, and a transfer writes **no expense**. Next: **Sprint 4 — POS sync / `sales_transaction`**; needs a grill first. ⚠️ H.5 yield-correct CONSUMPTION is NOT in Sprint 3 — it needs `sales_transaction` (Sprint 4) and `recipe` (Sprint 5)
- Sprint 4: ✅ COMPLETE (2026-08-20, except Part 20b) — Part 19 POS sales import (ADR 0019) ✅ **COMPLETE 2026-08-20** (L0–L6) — sales arrive as a **file**, and the ledger does not move. `sales_line` at the grain **menu × sales day × branch** (bill id / time / channel nullable), so a per-bill export and a daily-summary export share one code path; `sales_day` UNIQUE(branch, business_date) makes **re-importing REPLACE a day** a database fact, and replaced rows are kept marked superseded (Sprint 5 posts CONSUMPTION from them). Revenue = **after discount, excl VAT, excl service charge**. `sales_import_profile` holds the column map + a header fingerprint, so a POS format change **stops** the import instead of shifting every figure. Menu identity is the **POS code**, never the name; `pg_trgm` only ever SUGGESTS. **No `MovementType.CONSUMPTION`** — it needs `recipe` (Sprint 5). `/cost` gained **revenue**, and **gross profit with two methods switchable per shop** (`tenant.gross_profit_method`: นับสต๊อก = opening + purchases − closing, works with no recipes; สูตรอาหาร = Sprint 5). Part 20a daily pulse (ADR 0020) ✅ **COMPLETE 2026-08-20** (L0–L6) — one number per branch per day, **what the customer paid** (incl VAT + SC, so NOT the revenue figure), living in five columns on `sales_day`. Editable until a detail file lands, then **frozen as evidence**. It catches the one thing no Part 19 defence can see: **a POS export that covered only part of a day** — every row real, header matching, no blank cells, and nothing inside it saying it is incomplete. Warns on the import preview, never blocks. **Part 20b (email intake) is BLOCKED** on choosing an inbound-mail vendor (new dependency + `.env` edit = 🛑). Verified at close: `tsc` clean · `build` green (49 routes) · vitest **726 passed / 4 skipped** · Neon swept to 0
- Sprint 5: 🚧 IN PROGRESS — **Recipe + `CONSUMPTION`**, split into **five Parts** (ADR 0021, grill Q1–Q18, 2026-08-20/21; Part 23 added 2026-08-25 per ADR 0023). **Part 21 สูตรอาหาร + ต้นทุนสูตร** = `recipe` / `recipe_ingredient` / `recipe_branch`, recursive yield-correct cost, cost confidence — **writes nothing to the ledger** — ✅ **COMPLETE 2026-08-24** (L0–L6): a recipe is **append + supersede**, so a past day is costed against the recipe true that day; ingredients point at a product **or a menu**, so a **set menu** is an ordinary recipe one level up; a branch that copies a recipe **never follows central again** (`recipe_branch`); cost is **recursive, yield-correct and stored nowhere**, and never leaves the serializer without its **confidence**; the substitution flow rewrites an ingredient across many recipes and **names the branch recipes it is about to touch before it writes**. Verified at close: `tsc` clean · `build` green (53 routes) · vitest **884 passed / 4 skipped** · Neon swept to 0. **Part 22 ตัดสต๊อกตามยอดขาย** = `MovementType.CONSUMPTION` (+ `CONSUMPTION_REVERSAL`) — **ADR 0022 written 2026-08-24 (Q1–Q11), L0 ✅, L1 next**: the source is a document of its own, `sales_consumption_run`/`_item` at the grain **product × branch × day**, because `stock_movement` is keyed on the `(source_type, source_id)` **pair** and one sales line explodes into N products · **posting is an explicit step, not part of the import** (a recipe problem must not sink a good file), and posting a day again **voids the whole day and posts it afresh** · a **re-import voids automatically inside the commit** (voiding needs no recipe, so it cannot fail on one) · a menu posts **whole or not at all** and coverage is a **share of revenue** · what a cancelled bill does to stock is a **tenant setting** (`cancelled_sale_policy`, default = ปรุงไปแล้ว) · gross profit by สูตรอาหาร prints **with its coverage**, never as a bare number. Rules **N1–N12** in §10. ✅ **COMPLETE 2026-08-25** (L0–L6) — the ledger finally FALLS from a sale: `cogsSold` by สูตรอาหาร is asked of the **runs that still stand**, not of movements by date, so a day a re-import voided drops out whole and a re-posted day counts once · `fifo-replay.ts` changed for the first time since Part 18 · a partly-posted period prints its figure **with its coverage**. Verified at close: `tsc` clean · `build` green (54 routes) · vitest **964 passed / 4 skipped** · Neon swept to 0. **Part 23 ความน่าเชื่อถือของ test suite** (ADR 0023, grill Q1–Q6, 2026-08-25) — not a feature: the debugging session that found why the suite went red at random. It was **never the advisory lock**. The captured error is `Unable to start a transaction in the given time` — Prisma's `maxWait`, whose 2 s default is tuned for a Postgres on the same machine, not Neon Singapore through pgbouncer. A green run's 1,771 transaction starts average **32 ms** and never pass **279 ms**, and the slow ones (503–542 ms) all happen at **`inflight=1`** — so it is not our pool, our parallelism, or the lock, and capping `maxForks` was rejected on that evidence. `withTenantContext` now defaults `maxWait` to **10 s** — the value this codebase already chose six times and never made the default — while `timeout` stays at 5 s on purpose: a transaction waiting to begin holds nothing, one that is running pins a pgbouncer connection. A sweep module deletes residue two ways (`globalTeardown` within the run's own time window, `pnpm test:sweep` by hand), a dmmf-driven test fails when a new `tenantId` table is missing from its delete order, and **16 orphaned test users** that "Neon swept to 0" never saw — it counts tenants, and `User` has no `tenantId` — are now swept too. **Part 23.5 connection ที่ค้าง** (ADR 0024, 2026-08-25) — Part 23's verification uncovered a SECOND failure, `Can't reach database server`, and it is not the same lever. Ruled out by measurement, not argument: server capacity (peak **19** vs `max_connections` **901**) · Windows ephemeral ports (**11** in TIME_WAIT of 16,384) · `$disconnect` poisoning a reused client (**54 files = 54 pids**, nothing is ever reused) · the link (probe **205:1**, DNS never failed, zero failures during a red window) · the Part 23 change (interleaved **1/11 vs 0/11**). What it is: a cold connection **hangs ~0.3 % of the time and never completes**. Three instruments failed at **5.0–5.1 s** and nowhere else; raising `connect_timeout` to 20 s moved the failure to `pool_timeout` at 10 s and left the rate at 0.28 %. **One immediate retry recovered 7 of 7, in 266–315 ms.** So: a Prisma **extension** retries `P1001`/`P2024` only — safe because both mean the query never reached the server — plus the same retry at the transaction layer (the extension cannot see a BEGIN that dies), fired **only while the callback has not started**, because after that a lost connection could have followed a sent COMMIT. `connect_timeout` goes **DOWN** 5 s → 3 s: opposite to ADR 0023's `maxWait` and consistent with it, since `maxWait` bounds a wait that succeeds and this bounds an attempt that will not. ⚠️ **This is tolerance, not a cure** — raw TCP/TLS connects exceeding **8 s** were caught twice, both exactly on the minute; the cause is outside Mise. **Part 24 Menu Lab + ความครอบคลุมของสูตร** (ADR 0025, grill Q1–Q6, 2026-08-25) ✅ **COMPLETE 2026-08-26** (L0–L6) — the one screen where **nothing has happened yet**: *"฿89 or ฿99?"* is a question about a dish nobody has cooked. **No new table** — a draft is a `recipe` row with `is_draft`, filtered in **exactly two places** (`recipe-resolve.ts`, the single route by which a recipe reaches `stock_movement`, and `liveLinesFor`), and **the filters were built BEFORE the write path**, each verified by removing it and watching the test go red. A draft is **not a line** (no uniqueness check), **an edit writes no version** (it is true on no day), **the graph is checked at publish**, and **publishing ADOPTS the live line** so yesterday stays costed by yesterday's recipe. The live what-if **splices a virtual root into the real graph** rather than owning any arithmetic — a lab with its own cost engine is the second engine ADR 0025 Q4 refused, and the day it disagreed nothing would report it; W1 pins that an unsaved what-if and the identical saved recipe agree to the satang. **ราคาที่ตั้งใจ, never ราคา** (Q2): once the dish sells, the sold price IS the price. Cost needs a branch (ADR 0014 Q9), so the lab opens on the branch with the freshest `PO_RECEIVE` and **names it beside the number**; the food-cost % never appears without its confidence. Coverage ranks menus with no recipe **by REVENUE**, prints `null` not 0% for a period that earned nothing, counts **no draft as coverage**, and groups/merges nothing — a trigram score suggests, a person decides. Rules **M1–M10** in §11. Verified at close: `tsc` clean · `build` green (**58 routes**) · vitest **1033 passed / 4 skipped** · 14-case action-stack E2E green. **Menu merging became Part 25 and staff meal Part 26** (ADR 0025 Q1). **Part 25 การรวมเมนู** (ADR 0026, grill Q1–Q7, 2026-08-26) ✅ **COMPLETE 2026-08-27** (L0–L6) — and the grill **reversed the premise it was split off on**: merging does NOT rewrite `sales_line`. `PosIntegration.branchId` is NOT NULL and `menu` is unique on `(pos_integration_id, pos_menu_id)`, so **a two-branch shop gets two `menu` rows for one dish on its first import and a five-branch shop gets five** — duplicate menus are the DEFAULT past one branch, not an edge case, and until this Part such a shop wrote every recipe twice and half its stock deduction was silently skipped. A merge is **one row in `menu_merge`** saying one menu is another's spelling from a date: **no sale moves and the losing menu never dies** — it holds its POS code for ever (`menu_pos_identity_unique` has no `deleted_at` predicate, deliberately) and goes on collecting sales, so **soft-deleting either side breaks the next import**. **Reporting folds retroactively and always; the ledger folds only from `effective_from`** (default today) — two rules, one table, because reporting stores nothing and reverses instantly while movements do not. Resolution gains a **third fallback level** (สาขา → กลาง → เมนูที่ถูกรวมเข้าไป) living ONLY in `recipe-resolve.ts` and **filling gaps only**, so a merge can never falsify a posted day and nobody is asked which recipe survives. **No chains** — a star, never a chain, so folding is always one hop. Revoking sets `revoked_at`, never deletes, and the partial unique is on `revoked_at IS NULL`. Two reads must **never** fold — `planMenuResolutionLogic` and the merge screen — and are pinned as hard as the four that must. Rules **G1–G6** in §11.5. Verified at close: `tsc` clean · `build` green (**59 routes**) · vitest **1071 passed / 4 skipped** · 15-case action-stack E2E green · Neon swept to 0. ⚠️ **Part 25 owes a guard on recipe delete** — deleting the winner's recipe silently stops the losers' stock deduction (ADR 0026 Consequence 3). **Part 26 staff meal** still owed; it writes to the ledger with its own `source_type`. **Part 27 วงจรชีวิตของเมนู** reserved — `menu.isActive` is the only safe "stop selling" and still has zero readers.
  Key reversals ADR 0021 makes to the spec: a PREPPED product is made by **one parent + yield OR a production recipe with many inputs, never both** (amends ADR 0007) · recipe ingredients point at a **product or a menu**, so a **set menu** is an ordinary recipe one level up · recipes attach to branches via **`recipe_branch`**, and copying to a branch means that branch **never follows central again** · **append + supersede with an effective date**, because a periodic import must post each past day against the recipe true then · **nothing is stored** (no `recipe_cost_snapshot`; H.9 dissolves per ADR 0014) · Section B's three-layer mirror and `recipe_change_diff` are **removed** — no POS in scope pushes recipes.
  ⚠️ **NOT in Sprint 5:** H.8 theoretical-vs-actual variance (→ Sprint 6, per spec O16) · joint products (pending Feature 7) · **the set menu's department split — withdrawn from Part 22 at the grill, since the ledger has no `department_id` at all** (ADR 0022 Q8) · production movements, so **nothing can raise a PREPPED balance and counting one always reports a gain** — say so on screen.
  🛑 **Owed before Beta:** `canPerform` has **zero call sites in the whole project** — any authenticated member can do anything, including a `viewer`. Permissions must be a Part of its own (ADR 0021 Q18). · ~~test suite flaky under load~~ — **diagnosed and fixed in Part 23** (ADR 0023): it was Prisma's 2 s `maxWait` default, not the advisory lock. If it recurs, run `MISE_TX_TRACE=1` **before** forming a hypothesis — the instrumentation that cracked it is still in `withTenantContext`. · The suite is still **slow**: every read opens an interactive transaction so `SET LOCAL` has somewhere to live — four round trips to Singapore per row — and per ADR 0004 that `SET LOCAL` protects nothing until Sprint 7 (ADR 0023 Consequence 5).
- Sprint 6-7: Planned per docs/master-spec.md (Part IV — Sprint Plan)

## Tech Stack
- Next.js 15.0.3 + React 19 + TypeScript
- Prisma ORM 5.22 + PostgreSQL (Neon cloud, Singapore region)
- Auth.js v5.0.0-beta.25 (email magic link)
- Tailwind CSS
- Vitest (testing)
- **Package Manager: pnpm 11.x** (migrated from npm on 2026-05-19)

## Package Manager (pnpm)
- Install command: `pnpm install` (NOT `npm install`, NOT `--legacy-peer-deps`)
- Add dependency: `pnpm add <pkg>` / dev: `pnpm add -D <pkg>`
- Run script: `pnpm run <script>` or `pnpm <script>`
- Build scripts are blocked by default — allowed packages declared in `pnpm-workspace.yaml` under `allowBuilds:` (Prisma, esbuild, sharp, unrs-resolver)
- If new dep needs postinstall scripts: pnpm prints `ERR_PNPM_IGNORED_BUILDS` → add package name to `pnpm-workspace.yaml`, re-run `pnpm install`
- Peer dep warnings for react/react-dom/nodemailer are known and safe to ignore (install succeeds, app works) — see Sprint 0 lesson #1
- Lockfile: `pnpm-lock.yaml` (commit this; `package-lock.json` removed)

## Critical Conventions (READ BEFORE CODING)

### Database
- User model name: `User` (Auth.js requirement — NOT `AppUser`)
- User.id type: cuid String (NOT uuid — Auth.js requirement)
- Other models: id = uuid String @db.Uuid
- All tenant-scoped tables: enable RLS via prisma/manual/enable_rls.sql
- Manual SQL files: prisma/manual/ (OUTSIDE prisma/migrations/)

### Code Style
- UI strings: Thai language preferred
- Code, comments, variable names: English
- Error messages: Log in English, display in Thai
- Server Actions: prefer "use server" over API routes
- Use Prisma transactions for multi-step writes

### What NOT to do
- ❌ Don't use `qty × (1 + yield_loss%)` for yield math
   → Use `qty / (yield_percent/100)` (Decision #59)
- ❌ Don't use DATE_TRUNC without tenant timezone (Decision #60)
- ❌ Don't put manual SQL in prisma/migrations/ folder
- ❌ Don't add new tenant-scoped tables without RLS policy
- ❌ Don't use `prisma.appUser` — it's `prisma.user`

## Source-of-truth precedence
**When the master spec conflicts with an ADR, the ADR wins.** ADRs come from grill decisions — more solid and more recent; treat the spec as the stale side and reconcile the spec toward the ADR. Known example: `stock_movement` in the master spec is the old Sprint 1 shape — **ADR 0011 (append-only ledger) is authoritative** for Sprint 2+.

## Working autonomy & when to stop
Once a plan is approved, run to the end of the slice WITHOUT asking step by step:
- Write/edit code per the plan; refactor within a single layer.
- Run `pnpm tsc` / `pnpm vitest`; fix failing tests; fix bugs you introduced.
- **Touching a page/route/UI? Run `pnpm build` too — `pnpm tsc` is NOT enough.** Next's generated `.next/types/**` route types sit outside the tsconfig scope, so tsc can be fully green while `next build` fails. (A Sprint-0 `searchParams` signature blocked production builds for 9 parts before the Part 10 L5a build check caught it.) Note that `next build` prints `✓ Compiled successfully` BEFORE the type-check pass — that line alone does not mean the build passed.
- Commit at layer boundaries (L0→L6; never push until the L6 batch push).

🛑 STOP and ask Kong first — even when context is clear — when you hit:
- A schema change / new migration.
- A new dependency (especially native modules).
- More than one viable approach that affects multiple files, with no ADR covering it.
- A need to deviate from the approved plan.
- A spec-vs-ADR conflict not yet decided (beyond the ADR-wins rule above).
- Ambiguous product intent / unclear requirement.
- A destructive command: DROP, TRUNCATE, RESET, DELETE affecting > 1 row, `rm -rf`.
- Editing `.env` (holds DATABASE_URL / DIRECT_URL / AUTH_SECRET).
- Editing `.claude/skills/` or the spec docs — they are project memory and change how future sessions behave.
- The same error twice with root cause still unclear — stop and re-think rather than chaining hypotheses.
- A plan that exceeds 5 sub-steps.

Stop format: `🛑 Needs review: <topic> — options A / B, I recommend ... because ...`
For complex / multi-file work, enter Plan mode first: propose the plan, wait for approval, then implement.

## Test suite (Part 23, ADR 0023)
- `pnpm vitest run` — the suite sweeps its own residue at the end. A `[mise-sweep]` warning after a **green** run means some spec's `afterAll` is incomplete; the warning names what it deleted.
- `pnpm test:sweep` — delete every tenant and every unclaimed user by hand. **Dev branch only.**
- `MISE_TX_TRACE=1` — report how long each transaction took to START. `MISE_TX_TRACE_MS=400` reports only the spikes. Use this BEFORE hypothesising about a flake; "could not begin" and "ran too long" are different failures with the same-looking symptom.
- **`Can't reach database server`?** That one sentence is Prisma's report for DNS failure, TCP failure AND TLS failure alike, so it names no layer. Before hypothesising, measure the layers separately — ADR 0024 Consequence 2 describes the four probes that cracked it. A cold connection hangs ~0.3 % of the time; the retry in `db.ts` now absorbs that, so if you see it again the rate has WORSENED and the cause is worth finding.
- **Verify against what reproduces the failure, not a convenient proxy.** ADR 0024 Consequence 3: a harness reusing one client reported 3,262 successes and proved nothing, because it never opened a cold connection.
- Adding a table with a `tenantId`? `tests/sweep-coverage.test.ts` goes red until it is in `TENANT_SCOPED_DELETE_ORDER` (`tests/support/sweep.ts`), children before parents.

## Reference Documents (read when needed)
- docs/master-spec.md — Full consolidated architecture & schema spec (60 decisions; supersedes the old v1.x chain)
- docs/changelog-v5-summary.md — Decision history
- docs/pending-features-v1.5.md — Price Volatility + Menu Lab (Sprint 5-6)
- docs/sprint-progress.md — Current sprint status (LIVE)
- docs/calculation-rules.md — Calculation Rules Register: every calculation/valuation rule in one table, flagged for whether users must be told. Index only — ADRs win on conflict. **Append a row whenever a calculation rule is decided, not at sprint end.**
- .claude/skills/ — Task-specific skills (load as needed)
- .claude/skills/grill-with-docs/SKILL.md — pre-sprint alignment interviews
- .claude/skills/tdd/SKILL.md — test-driven development with vertical slices
- .claude/skills/handoff/SKILL.md — session compaction for next agent
- .claude/skills/git-guardrails/SKILL.md — git safety hook documentation
- .claude/skills/ai-collaboration/SKILL.md — behavioral baseline (read every session)
- .claude/skills/token-awareness/SKILL.md — context budget monitoring + warn before exhaustion
- .claude/skills/debug-mantra/SKILL.md — 4-step debug discipline (reproduce → fail path → falsify → ledger)
- .claude/skills/scrutinize/SKILL.md — outsider review of plans/PRs (intent → trace → verify)
- .claude/skills/management-talk/SKILL.md — translate eng content for leadership/team/investors
- CONTEXT.md — Mise domain glossary
- docs/adr/ — Architecture Decision Records

## User Profile
- Beginner coder, learning by doing
- Prefers Thai language explanations
- Uses Windows + Command Prompt
- Database: Neon cloud (NOT local Docker — abandoned in Sprint 0)
- GitHub: thefirstpig1/mise

## Sprint 0 Lessons Learned
1. React 19 + Next 15.0.3 = peer dependency conflict — solved by migrating to pnpm (2026-05-19). pnpm prints WARN but install succeeds. (Old npm workaround: `--legacy-peer-deps`)
2. Docker Postgres on Windows = auth issues → use Neon cloud instead
3. .env encoding matters on Windows — use PowerShell ASCII for safety
4. Auth.js Prisma Adapter requires exact model name `User` (not `AppUser`)
5. Foreign keys to User must use String (cuid), not @db.Uuid
6. Don't init RLS policies inside Prisma migrations folder
