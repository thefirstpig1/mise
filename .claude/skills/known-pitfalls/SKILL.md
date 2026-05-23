# Known Pitfalls — Avoid these mistakes

This skill grows over time. Read before making decisions about:
- Environment setup
- Dependency selection
- Schema design
- Auth integration
- Database setup

## Sprint 0 Pitfalls (DO NOT REPEAT)

### 1. React 19 + Next.js 15.0.3 peer dependency conflict
- Symptom: `npm install` fails with ERESOLVE
- Cause: Next 15.0.3 expects React 19.0.0-rc, but package.json pins React 19.0.0 stable
- Fix: Use `npm install --legacy-peer-deps`
- Long-term: Upgrade to Next 15.1+

### 2. Docker Postgres on Windows = auth failures
- Symptom: P1000 from Prisma despite psql exec working
- Root cause: Unknown (likely Windows TCP networking issue between Node.js and Docker)
- Solution: Use Neon cloud instead (production target anyway)
- Lesson: Don't fight Windows-specific dev environment quirks

### 3. .env encoding on Windows
- Symptom: Prisma reads wrong values despite .env looking correct
- Cause: cmd `echo` creates files with non-UTF8 encoding
- Fix: Use PowerShell `Out-File -Encoding ASCII` to create .env
- Or: Edit via VS Code which handles encoding properly

### 4. Auth.js Prisma Adapter requires model named `User`
- Symptom: "Cannot read properties of undefined (reading 'findUnique')"
- Cause: Adapter hardcoded to use `prisma.user`
- Fix: Always name the user model `User` (not `AppUser` or others)

### 5. Foreign keys from Auth.js tables to User
- Symptom: "Key columns are of incompatible types: text and uuid"
- Cause: Auth.js Account/Session use cuid String, but User had @db.Uuid
- Fix: User.id = cuid String (no @db.Uuid)
- Other tables can still use @db.Uuid for their own ids

### 6. Manual SQL in prisma/migrations/ folder
- Symptom: P3015 "Could not find migration file"
- Cause: Prisma interprets any folder in migrations/ as a migration
- Fix: Put manual SQL in prisma/manual/ (outside migrations/)

### 7. Schema reset doesn't drop existing tables in Neon
- Symptom: Migration fails because tables still exist
- Fix: Run in Neon SQL Editor:
```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO neondb_owner;
GRANT ALL ON SCHEMA public TO public;
```

### 8. RLS policies persist after schema drop
- Symptom: "policy already exists" when re-applying
- Cause: RLS metadata in pg_catalog, not user schema
- Fix: Schema drop + recreate clears them (or DROP POLICY explicitly)

### 9. Windows Environment Variables persist across cmd sessions
- Symptom: `set DATABASE_URL=X` in one session affects new sessions
- Fix: Use `setx DATABASE_URL ""` to clear permanently, restart cmd

### 10. Next.js 15.0.3 has security vulnerability (CVE-2025-66478)
- Action: Upgrade to patched version before production (Sprint 7)
- For now: OK in dev

## Sprint 1 Pitfalls (DO NOT REPEAT)

### 11. pnpm 11 ignores `pnpm` field in package.json
- Symptom: `[WARN] The "pnpm" field in package.json is no longer read by pnpm`
- Cause: pnpm 10+ moved settings out of package.json
- Fix: Put settings in `pnpm-workspace.yaml` at repo root (works even for non-workspace projects)

### 12. pnpm 11 build-script approval uses NEW syntax
- Symptom: After adding `onlyBuiltDependencies: [...]` (array), builds still ignored
- Cause: pnpm 11 renamed the setting to `allowBuilds:` and uses an object (pkg → true/false), not an array
- Fix: In `pnpm-workspace.yaml`:
  ```yaml
  allowBuilds:
    '@prisma/client': true
    '@prisma/engines': true
    esbuild: true
    prisma: true
    sharp: true
    unrs-resolver: true
  ```
- Reference: pnpm install auto-generates a stub with `: set this to true or false` placeholders — replace with `true`

### 13. pnpm blocks build scripts by default = Prisma client not generated
- Symptom: `ERR_PNPM_IGNORED_BUILDS` after `pnpm install`; later `import { PrismaClient }` fails at runtime
- Cause: pnpm 8+ blocks `postinstall` scripts as a security default. Prisma's postinstall runs `prisma generate` — without it, `node_modules/.prisma/client/` is missing
- Check: `Test-Path node_modules\.prisma\client` should be `True`
- Fix: Add Prisma (and esbuild/sharp/unrs-resolver) to `allowBuilds:` in pnpm-workspace.yaml — see pitfall #12

### 14. Migration npm → pnpm: must wipe node_modules + lockfile first
- Don't run `pnpm install` on top of an npm-installed tree — lockfile mismatch
- Steps: delete `node_modules/` + `package-lock.json`, then `pnpm install`
- Commit `pnpm-lock.yaml`, remove `package-lock.json` from git

### 15. Auth.js v5 beta wants nodemailer ^7, project pins ^6
- Symptom: `unmet peer nodemailer Wanted: ^7.0.7 from @auth/core@0.41.2`
- Status: WARN only (pnpm install still succeeds, app runs)
- Risk: Magic link email *might* misbehave if @auth/core uses v7-only nodemailer APIs
- Action: Leave at ^6 for now; if magic link breaks in testing, upgrade nodemailer to ^7 + retest auth flow

### 16. `prisma db push` ≠ test connection
- Symptom: User/AI uses `prisma db push` thinking it's read-only
- Reality: It applies schema changes immediately, BYPASSES migration history
- Risk: Migration drift on next `migrate dev`, may prompt destructive reset (Sprint 0 data could be wiped)
- Safe alternative: `prisma db execute --stdin <<< "SELECT 1;"` for connection test
- Or just run `prisma migrate dev` directly — has built-in connection check, no side effects on fail

### 17. Neon free tier auto-suspends after 5 min idle
- Symptom: P1001 "Can't reach database server" even though DNS resolves and TCP/5432 is open
- Cause: Neon free-tier compute pauses idle DBs to save cost; TCP accepts but PostgreSQL handshake fails during cold start
- Fix: Run `SELECT 1` in Neon SQL Editor (or `prisma db execute --stdin <<< "SELECT 1;"`) to wake — wait ~10s for cold start, then retry the failing command
- Diagnose: If `Test-NetConnection` returns True on :5432 but Prisma gets P1001, it's a suspended endpoint, not a network issue
- Long-term: Add `predev` npm script with SELECT 1, or upgrade to Neon paid plan (no auto-suspend)

### 18. Neon pooled endpoint doesn't work for Prisma migrations
- Symptom: P1001 "Can't reach database server" even when Neon is awake
- Cause: Pooled connections (port 5432 via pgBouncer) don't support session-level
  commands needed by migrations (transactions, advisory locks, prepared statements)
- Detection: Check if DATABASE_URL has "-pooler" in hostname
- Fix: Use BOTH URLs in .env
  - DATABASE_URL = pooled (app runtime, recommended for Vercel/serverless)
  - DIRECT_URL = direct (migrations only — no "-pooler" in hostname)
- Schema declares both:
```prisma
datasource db {
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```
- Identify URL type: pooled has "-pooler" in hostname, direct doesn't
- Reference: https://neon.tech/docs/guides/prisma, ADR 0003, Sprint 1 Part 3a (~1hr debug)
- Severity: BLOCKER for migrations

### 19. Git guardrails hook ต้องใช้ jq บน Windows
- Symptom: Hook script ไม่ block git command ที่ควร block
- Cause: block-dangerous-git.sh ใช้ bash + jq เป็น parser
- Status on Windows: Git Bash มากับ Git for Windows แต่ jq ไม่ได้ติดมา
- Detection: Hook fails silently — Claude Code อาจรัน command ที่ควร block
- Fix Options:
  A. ติดตั้ง jq: `winget install jqlang.jq` หรือ `choco install jq`
  B. Re-write hook เป็น PowerShell (no external deps)
  C. ใช้ Node.js script แทน (Node มีอยู่แล้ว)
- Test: หลัง install jq ลอง prompt "git push" ใน Claude Code — ต้องเห็น BLOCKED
- Priority: MEDIUM — ตอนนี้ user เป็น solo dev ระวังตัวเองได้, แต่ควร fix ก่อน team scale
- **CONFIRMED broken (2026-05-20, Sprint 1 Part 5):** `git push` ผ่านโดยไม่ถูก block. ยืนยันด้วย `where.exe jq` (ไม่เจอ) + อ่าน hook line 4 (`jq -r '.tool_input.command'`) → เมื่อ jq หาย $COMMAND เป็นค่าว่าง → ไม่ match pattern → `exit 0` (fails OPEN, ปล่อยผ่านทุกคำสั่ง)
- **Deferred fix (Tier 2 task):** rewrite hook ด้วย grep/sed (no jq dep) — เลือกแนวนี้แทน Option A (install jq) เพื่อไม่ผูกกับ external dep บนเครื่อง dev. ยังไม่เร่งเพราะ solo dev (ระวังตัวเองได้)

### 20. Prisma Decimal ข้าม Server→Client boundary ไม่ได้
- Symptom: รันแล้ว throw `"Only plain objects can be passed to Client Components from Server Components"` (หรือเงียบ ๆ พังตอน render)
- Cause: Prisma `Decimal` เป็น class instance (decimal.js) — RSC serialize ได้เฉพาะ plain object / built-ins (Date ผ่าน, class ไม่ผ่าน). ส่ง row ที่มี Decimal field เข้า `"use client"` component ตรง ๆ ไม่ได้
- Fix: ใน Server Component map row ผ่าน serializer ที่ `.toString()` ทุก Decimal field ก่อนส่งเข้า client (ref: `src/app/suppliers/_components/supplier-view.ts` → `toSupplierView`). ฝั่ง form ใช้ string เป็น `defaultValue` ได้เลย
- Detection: field ชนิด `Decimal?` / `@db.Decimal` ใน schema = ต้องมี serializer ถ้า row นั้นถูกส่งข้าม boundary
- Confirmed: Sprint 1 Part 5 (Suppliers — rate fields). **Part 6 (Category) ไม่มี Decimal → ข้าม serializer ได้**

### 21. Next 15 typedRoutes manifest stale จนกว่า dev รันรอบแรก
- Symptom: `pnpm exec tsc --noEmit` ขึ้น error `RouteImpl<"/x">` / `not assignable` บน `<Link href="/new-route">` หรือ `router.push("/new-route")` ทั้งที่ route ใหม่ถูกสร้างแล้ว
- Cause: `experimental.typedRoutes` (next.config.ts) gen route-type union จาก `.next/types/**` ซึ่ง stale — route ใหม่ยังไม่อยู่ใน manifest จนกว่าจะ compile
- Fix: รัน `pnpm dev` หนึ่งรอบ + curl/เปิด route ใหม่ (ให้มัน compile) ก่อน → แล้วค่อย `tsc` (manifest จะ include route ใหม่)
- Detection: tsc error เป็น `RouteImpl<...>` เท่านั้น (ไม่ใช่ logic error) บนไฟล์ใหม่ = false alarm จาก manifest stale
- Workaround เดิม: page เก่าใช้ `<a href>` เลี่ยง typed routes ได้ แต่ `<Link>` / `router.push` ต้อง manifest current
