# Mise — Restaurant Back-Office Platform

## What is this project
B2B SaaS for Thailand restaurant SMEs. "MarketMan-for-Thailand-SME" — 90% cheaper, 30-min setup, works without recipes.

## Project Status
- Sprint 0: ✅ COMPLETE (May 17, 2026) — Auth, Tenant, Branch, Department, RLS
- Sprint 1: ✅ COMPLETE (June 7, 2026) — Master Data (Suppliers, Products, Categories, Multi-unit, Supplier-Product Mapping)
- Sprint 2: 🚧 IN PROGRESS — Part 10 Stock Movement (append-only ledger, ADR 0011) ✅ COMPLETE 2026-08-15 · Part 11 Purchase Order (ADR 0012) ✅ COMPLETE 2026-08-16; next: **Part 13 Goods Receipt** (Part 12 unallocated — Part 11 absorbed it; see docs/sprint-progress.md)
- Sprint 3-7: Planned per docs/master-spec.md (Part IV — Sprint Plan)

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
