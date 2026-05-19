# Mise — Restaurant Back-Office Platform

## What is this project
B2B SaaS for Thailand restaurant SMEs. "MarketMan-for-Thailand-SME" — 90% cheaper, 30-min setup, works without recipes.

## Project Status
- Sprint 0: ✅ COMPLETE (May 17, 2026) — Auth, Tenant, Branch, Department, RLS
- Sprint 1: 🚧 IN PROGRESS — Master Data (Suppliers, Products, Categories, Multi-unit)
- Sprint 2-7: Planned per docs/master-spec-v1.4.md section 32

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

## Reference Documents (read when needed)
- docs/master-spec-v1.4.md — Full architecture spec (60 decisions locked)
- docs/changelog-v5.md — Decision history
- docs/pending-features-v1.5.md — Price Volatility + Menu Lab (Sprint 5-6)
- docs/sprint-progress.md — Current sprint status (LIVE)
- .claude/skills/ — Task-specific skills (load as needed)

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
