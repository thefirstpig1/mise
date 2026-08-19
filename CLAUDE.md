# Mise — Restaurant Back-Office Platform

## What is this project
B2B SaaS for Thailand restaurant SMEs. "MarketMan-for-Thailand-SME" — 90% cheaper, 30-min setup, works without recipes.

## Project Status
- Sprint 0: ✅ COMPLETE (May 17, 2026) — Auth, Tenant, Branch, Department, RLS
- Sprint 1: ✅ COMPLETE (June 7, 2026) — Master Data (Suppliers, Products, Categories, Multi-unit, Supplier-Product Mapping)
- Sprint 2: ✅ COMPLETE (2026-08-17) — Part 10 Stock Movement (append-only ledger, ADR 0011) · Part 11 Purchase Order (ADR 0012) · Part 13 Goods Receipt (ADR 0013) · Part 13.5 carry-forward debt payoff (adjust `submit_key` + advisory-lock counters, closes Pitfall #25) · Part 14 Cost Engine (**FIFO by ledger replay, stored nowhere** — ADR 0014). Part 12 unallocated (Part 11 absorbed it). Next: **Sprint 3 — Stock Count + Expense + yield-correct CONSUMPTION**; see docs/sprint-progress.md
- Sprint 3: ✅ COMPLETE (2026-08-18) — Step 0 Neon cleanup ✅ · Part 15 Stock Count (ADR 0015) ✅ COMPLETE 2026-08-17 · Part 16 Expense (ADR 0016) ✅ COMPLETE 2026-08-17 — `expense`/`expense_item`/`recurring_expense`, VAT + WHT (withheld on the **pre-VAT** base), a confirmed goods receipt writes its own expense, and stock now carries the VAT an unregistered shop cannot reclaim; Part 17 Waste + par level (ADR 0017) ✅ **COMPLETE 2026-08-18** (L0–L6 + UX pass) — `waste_log` is a document with `SourceType.WASTE_LOG` posting an ordinary `ADJUST_LOSS` (**not** a new MovementType), `par_level` per product×branch with a three-state alert and a freshness line; `/cost`'s ของเสีย column now means `WASTE_LOG` alone and `SPOILAGE`/`DAMAGE` left the adjustment form. Part 18 inter-branch transfer (ADR 0018) ✅ **COMPLETE 2026-08-18** (L0–L6) — `stock_transfer`/`stock_transfer_item` where **both legs post at dispatch** (stock in transit belongs to the RECEIVING branch; the `SENT`/`RECEIVED` status is about paperwork, **not** stock), the ledger gained **four real movement types** `TRANSFER_*` (unlike waste — FIFO must cut the layer a transfer pushed, ADR 0014 Q8), the sending branch's FIFO money is **frozen onto the line with its `cost_source`** (the one deliberate exception to ADR 0014's "cost is stored nowhere"), what never arrives posts as `TRANSFER_SHORTAGE` at the receiver, and a transfer writes **no expense**. Next: **Sprint 4 — POS sync / `sales_transaction`**; needs a grill first. ⚠️ H.5 yield-correct CONSUMPTION is NOT in Sprint 3 — it needs `sales_transaction` (Sprint 4) and `recipe` (Sprint 5)
- Sprint 4: 🚧 IN PROGRESS — Part 19 POS sales import (ADR 0019) ✅ **COMPLETE 2026-08-20** (L0–L6) — sales arrive as a **file**, and the ledger does not move. `sales_line` at the grain **menu × sales day × branch** (bill id / time / channel nullable), so a per-bill export and a daily-summary export share one code path; `sales_day` UNIQUE(branch, business_date) makes **re-importing REPLACE a day** a database fact, and replaced rows are kept marked superseded (Sprint 5 posts CONSUMPTION from them). Revenue = **after discount, excl VAT, excl service charge**. `sales_import_profile` holds the column map + a header fingerprint, so a POS format change **stops** the import instead of shifting every figure. Menu identity is the **POS code**, never the name; `pg_trgm` only ever SUGGESTS. **No `MovementType.CONSUMPTION`** — it needs `recipe` (Sprint 5). `/cost` gained **revenue**, and **gross profit with two methods switchable per shop** (`tenant.gross_profit_method`: นับสต๊อก = opening + purchases − closing, works with no recipes; สูตรอาหาร = Sprint 5). Part 20a daily pulse (ADR 0020) ✅ **COMPLETE 2026-08-20** (L0–L6) — one number per branch per day, **what the customer paid** (incl VAT + SC, so NOT the revenue figure), living in five columns on `sales_day`. Editable until a detail file lands, then **frozen as evidence**. It catches the one thing no Part 19 defence can see: **a POS export that covered only part of a day** — every row real, header matching, no blank cells, and nothing inside it saying it is incomplete. Warns on the import preview, never blocks. **Part 20b (email intake) is BLOCKED** on choosing an inbound-mail vendor (new dependency + `.env` edit = 🛑). Next: **Sprint 5 — Recipe + `CONSUMPTION`** (grill first, no ADR 0021)
- Sprint 5-7: Planned per docs/master-spec.md (Part IV — Sprint Plan)

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
