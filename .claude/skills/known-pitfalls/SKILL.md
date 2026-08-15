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

### 22. Category @@unique เป็น full (ไม่ใช่ partial แบบ supplier)
- Symptom: ลบ category (soft-delete) แล้วสร้าง account/section/group triple เดิมซ้ำ → P2002 / Thai "มีอยู่แล้ว" ทั้งที่ list ไม่เห็น row นั้น
- Cause: `@@unique([tenantId, account, accountingSection, groupName])` ใน schema เป็น full unique — นับ soft-deleted row ด้วย (ต่างจาก supplier ที่ใช้ partial index `WHERE deleted_at IS NULL`)
- Status: **ยอมรับสำหรับ MVP** — category มี 16 default + user สร้างเองไม่เยอะ → โอกาส re-create-after-delete ต่ำ
- Follow-up (ถ้าเจอจริง): swap เป็น `prisma/manual/` partial unique index แบบ supplier Step 3 (ต้องเอา `@@unique` ออกจาก schema → comment ชี้ไปไฟล์ manual แทน)
- Mitigation ปัจจุบัน: action layer แปลง P2002 → Thai message ที่ใบ้ว่า "หากเคยลบไปแล้ว จะยังสร้างซ้ำไม่ได้"

### 23. Product @@unique([tenantId, sku]) เป็น full index (ไม่ partial) — ซ้ำรอย #22
- Symptom: soft-delete product แล้วสร้างใหม่ด้วย sku เดิมถูกบล็อก (Prisma P2002) ทั้งที่ list ไม่เห็น row นั้น
- Cause: `@@unique([tenantId, sku])` ใน schema เป็น full unique — นับ row ที่ `deletedAt != null` ด้วย (ต่างจาก supplier ที่ใช้ partial index `WHERE deleted_at IS NULL` ใน `prisma/manual/`). `ProductUnit @@unique([productId, unitName])` ก็ full เช่นกัน
- Status: **ยอมรับสำหรับ MVP** (Sprint 1 Part 7a) — เหมือนเหตุผล #22 (Category)
- Mitigation ปัจจุบัน: action layer แปลง P2002 → Thai message "รหัสสินค้านี้มีอยู่แล้ว (หากเคยลบไปแล้ว จะยังใช้รหัสซ้ำไม่ได้)"
- Fix (ถ้าเจอปัญหาจริง): partial unique index `WHERE deleted_at IS NULL` ผ่าน `prisma/manual/` แบบเดียวกับ `supplier_code_unique.sql` (ต้องเอา `@@unique` ออกจาก schema → comment ชี้ไปไฟล์ manual แทน)

### 24. `rethrowSkuConflict` จับ P2002 เหมาทุกตัว — แคบลงตอน 7b (multi-unit)
- Where: `src/server/product.ts` → `rethrowSkuConflict()` แปลง P2002 *ใด ๆ* → `ProductSkuConflictError` → Thai "รหัสสินค้านี้มีอยู่แล้ว"
- 7a ปลอดภัย: product มี ProductUnit แค่ 1 แถว → P2002 ในทรานแซกชันมาจาก `@@unique([tenantId, sku])` เท่านั้น
- **7b จะพัง:** multi-unit → `@@unique([productId, unitName])` ชนได้ (ผู้ใช้ใส่ชื่อหน่วยซ้ำในสินค้าเดียว) → ปัจจุบันจะถูกแปลงผิดเป็น "รหัสสินค้าซ้ำ" ทั้งที่จริงคือ "ชื่อหน่วยซ้ำ"
- **Fix ตอน 7b:** แยกด้วย `e.meta?.target` (เช่น `['tenant_id','sku']` vs `['product_id','unit_name']`) → คืน error ที่ field ถูกต้อง (sku-conflict vs unit-name-conflict)
- Status: **ยอมรับสำหรับ 7a** (unit เดียว ยิงไม่ได้). ต้องแก้ก่อน/ระหว่างทำ 7b

### 25. `generateSku` race condition — scan max+1 ไม่ lock
- Where: `src/server/product.ts` → `generateSku()` อ่าน `P-####` สูงสุดแล้ว +1 (ไม่มี row lock / advisory lock)
- Symptom: create พร้อมกัน 2 request (เว้น sku ว่าง) อ่าน max เดียวกัน → ได้ `P-####` ซ้ำ → อันหลัง P2002 → ผู้ใช้เห็น "รหัสสินค้าซ้ำ" ทั้งที่เว้นว่าง (งง เพราะไม่ได้กรอก sku เอง)
- Status: **ยอมรับสำหรับ MVP** — single-user, โอกาส concurrent create ต่ำมาก
- Fix (ตอน scale / multi-user): `pg_advisory_xact_lock(hashtext(tenant_id::text))` ต้นทรานแซกชัน หรือเปลี่ยนเป็น DB sequence ต่อ tenant
- เกี่ยวข้อง: Pitfall #24 (ถ้า race ยิง P2002 ก็จะถูก `rethrowSkuConflict` แปลงเป็น sku-conflict — ใน 7a ถูกต้องพอดี)

### 26. Neon free-tier compute-hours quota exhaustion (ต่างจาก #17 cold-start)
- Symptom: P1001 "Can't reach database server" บน **ทั้ง** `-pooler` และ direct endpoint พร้อมกัน และ **ไม่หาย** แม้ปลุกผ่าน Neon Console (ต่างจาก #17 ที่ cold-start จะ clear ใน ~10s)
- Cause: โควต้า compute-hours รายเดือนของ free-tier หมด → compute ถูก suspend ระดับ account ไม่ใช่ idle-suspend ของ endpoint
- Detection: วิธีปลุกของ #17 (SELECT 1) ไม่ช่วย; ทั้งสอง endpoint ดับพร้อมกัน = compute suspended ที่ระดับบัญชี ไม่ใช่ปัญหา network/endpoint
- Status: **CONFIRMED (2026-05-24/25, Sprint 1 Part 7b)** — DB ล่ม ~22:55 บล็อก integration test ทั้งหมดทั้ง session; กลับมาเองวันถัดมา (2026-05-25) แล้ว 16 logic tests ผ่าน
- Fix: เช็ค Neon Console → Billing/Usage; **upgrade plan ก่อน sprint หนัก / ก่อน production**. คนละเรื่องกับ #17 (idle suspend, ปลุกแล้วหาย)

### 27. `ml_per_g` terminology bug — ชื่อ field กับค่า seed สวนทาง (RESOLVED in Part 7d, 2026-05-28)
- Where: schema `Product.densityMlPerGOverride` + `LiquidDensityTemplate.mlPerG` (column `ml_per_g`), `prisma/seed-system.ts` `LIQUID_DENSITIES`, CONTEXT.md "Liquid density"
- Symptom: field/column ชื่อ `ml_per_g` (มล./กรัม) แต่ค่า seed เป็น **density g/ml มาตรฐาน** — น้ำ 1.000, นม 1.030, น้ำมัน 0.910, น้ำเชื่อม 1.300. ถ้าเป็น ml/g จริง นมต้อง ~0.971 ไม่ใช่ 1.030. CONTEXT.md เขียน "ml/g ratio ... milk=1.030" ผิดทิศเดียวกัน
- Risk: การแปลง WEIGHT↔VOLUME ใช้ ratio นี้ — ทิศผิด = แปลงกลับด้านใน Sprint 2+ (cost/consumption)
- **Status: RESOLVED in Part 7d (ADR 0008).** Chose option (a) — renamed `ml_per_g → g_per_ml` (column + Prisma field), `densityMlPerGOverride → densityGPerMlOverride`; seed values were already correct standard density (g/ml) so no value flip needed. Single migration `part_7d_density_data_capture` covers the rename + Q8 `name @unique` + Q2 XOR CHECK. CONTEXT.md "Liquid density" entry rewritten to g/ml direction. See ADR 0008 for the full decision record and the rejected alternatives (b) flip-values and (c) override-wins precedence.

### 28. depth/cycle traversal race — concurrent edit บนสาย ancestor เดียวกัน (ตระกูล #25)
- Where: `src/server/product.ts` (7c) — parentProductId guard: ancestor-walk (`ancestorDepth`) + descendant DFS (`descendantHeight`) สำหรับ check `ancestorDepth + 1 + descendantHeight ≤ 5` + cycle (ADR 0007)
- Symptom: สอง edit พร้อมกันบนสาย ancestor เดียวกัน — ต่างคนต่างอ่าน state, ต่างคนต่างผ่าน guard, แล้วเขียนทั้งคู่ → chain ใน DB ลึกเกิน 5 หรือเกิด cycle (read-then-write ไม่มี lock)
- Status: **ยอมรับสำหรับ MVP (7c)** — single-user, โอกาส concurrent edit บนสายเดียวกันต่ำมาก
- Fix (ตอน scale): `pg_advisory_xact_lock` keyed บน tenant (หรือ root ของสาย) ต้นทรานแซกชันของ create/update — ตระกูลเดียวกับ #25 (generateSku race). **ไม่ทำใน 7c**

### 29. Neon IPv6 (AAAA) record + Windows IPv6-first resolver → Prisma connect timeout (ต่างจาก #17/#26)
- Where: local dev บน Windows, ทุก Prisma query (`pnpm db:seed:system`, `pnpm vitest` integration, migrate) — host `ep-…-pooler.c-2.ap-southeast-1.aws.neon.tech`
- Symptom: Prisma `PrismaClientInitializationError` / `P1001 Can't reach database server` / "Timed out fetching a new connection from the connection pool" — fail ที่ ~5s (default connect_timeout), ดัน connect_timeout เป็น 30s ก็ fail ที่ 30s. เกิดทั้ง pooled + direct. **ทั้งที่ DB ปกติ 100%** (`SELECT 1;` ใน Neon SQL Editor ผ่าน, Usage/Billing/Status เขียวหมด — ตัด #26 ออก)
- Root cause: Neon เริ่มประกาศ **AAAA (IPv6) records**. Windows prefix policy + Node default DNS order `verbatim` คืน IPv6 ขึ้นก่อน A (IPv4). network local route IPv6 ไป AWS ไม่ได้ → Prisma **Rust query engine (library, tokio getaddrinfo)** ลอง IPv6 ก่อนแล้วค้างจน timeout (ไม่มี happy-eyeballs fallback)
- Detection (ขั้นตอนพิสูจน์):
  1. `Test-NetConnection <host> -Port 5432` → `TcpTestSucceeded=True` (หลอก! PowerShell เลือก IPv4)
  2. `node` `dns.lookup(host, {all:true})` → family 6 (IPv6) มา**ก่อน** family 4 — นี่คือตัวชี้
  3. raw `tls.connect` ไป **IPv4 address ตรง ๆ** + `servername=host` (SNI) → Postgres SSLRequest ตอบ `'S'`, TLS `authorized=true` → ยืนยัน IPv4 path ดีทุกอย่าง
- สิ่งที่ **ไม่ช่วย**: `--dns-result-order=ipv4first` (env หรือ `dns.setDefaultResultOrder()` programmatic) — Prisma library engine เป็น Rust ทำ DNS เองผ่าน OS resolver ไม่สน Node DNS setting; เคลียร์ `node_modules/.prisma` + `prisma generate` ก็ไม่ช่วย
- Fix (workaround, ใช้อยู่ Sprint 1 Part 7d, 2026-05-30): pin hosts file → IPv4 (PowerShell **Run as Administrator**):
```powershell
$h = "$env:windir\System32\drivers\etc\hosts"
$pins = @(
  "13.251.17.193 ep-sparkling-violet-aosni4te-pooler.c-2.ap-southeast-1.aws.neon.tech",
  "18.138.49.39 ep-sparkling-violet-aosni4te.c-2.ap-southeast-1.aws.neon.tech"
)
$cur = Get-Content $h -ErrorAction SilentlyContinue
foreach ($p in $pins) { if ($cur -notcontains $p) { Add-Content -Path $h -Value $p } }
```
  ผลทันที ไม่ต้อง reboot (hosts มีแค่บรรทัด IPv4 → getaddrinfo คืน IPv4 อย่างเดียว). revert = ลบ 2 บรรทัด. หลัง pin: Prisma connect ~327ms
- ข้อจำกัด/permanent: IP อาจเปลี่ยนถ้า Neon หมุน proxy → ต้อง re-resolve (`dns.lookup` เอา IPv4 ใหม่). ทางถาวร: upgrade plan + dedicated IP, แก้ IPv6 routing ฝั่ง network, หรือ Windows prefer-IPv4 ทั้งเครื่อง (`netsh interface ipv6 set prefixpolicy ::ffff:0:0/96 60 4`, elevated — กระทบทุก connection)

---

## Sprint 2 Pitfalls (DO NOT REPEAT)

### 30. เช็คจำนวนทศนิยมด้วยการคูณ float — ปฏิเสธค่าที่ถูกต้อง (Part 10, FIXED `85b38a3`)
- Where: `src/lib/validations/stock-movement.ts` `hasAtMostThreeDecimals` (Part 10 L2). **ทุก zod schema ที่ต้องจำกัดทศนิยมให้ตรงกับ `Decimal(p,s)` ของ Postgres เสี่ยงซ้ำรอย** — Part 13 (GR `received_qty`) และ Part 14 เป็นรายต่อไป
- Symptom: กรอก `1.005` แล้วโดนเด้ง **"จำนวนต้องมีทศนิยมไม่เกิน 3 ตำแหน่ง"** ทั้งที่มี 3 ตำแหน่งพอดี. ฟอร์มตั้ง `step="0.001"` เบราว์เซอร์เลยยอมให้ส่ง → browser กับ server เห็นไม่ตรงกัน ผู้ใช้ตัน แก้ตามข้อความไม่ได้
- Root cause: `Number.isInteger(n * 10 ** 3)` — binary float ทำให้ `1.005 * 1000 = 1004.9999999999999` **พลาด 11,791 ค่า จาก 1,000,000 ค่าแรก (~1.2%)** ไม่ได้จำกัดแค่เลขน้อย ๆ (1234.005 ก็โดน)
- Fix: round-trip ผ่าน `toFixed` — `Number(n.toFixed(3)) === n` (ปฏิเสธผิดพลาด **0 จาก 1,000,000**, ทศนิยมตำแหน่งที่ 4 ยังโดนปฏิเสธถูกต้อง). `toFixed` ปัดจาก decimal expansion ไม่ใช่ผลคูณ binary
- **ของเดิมที่ทำถูกอยู่แล้ว: `src/lib/validations/supplier.ts:60`** (`Number(n.toFixed(2)) === n` สำหรับ rate 2 ตำแหน่ง, Sprint 1) — Part 10 เขียนใหม่แล้วถอยหลัง ก่อนเขียน validator ตัวใหม่ให้ลอกอันนี้
- บทเรียนเรื่องเทสต์: L2 มีเทสต์ "accepts exactly 3 decimal places" อยู่แล้วแต่ **บังเอิญเลือก `1.234` ซึ่งเป็นค่าที่ผ่าน** — เทสต์ float ต้องหยิบค่าที่ binary แทนไม่ลงตัว (`1.005`, `1.001`, `2.675`) ไม่ใช่ค่าแรกที่นึกออก
