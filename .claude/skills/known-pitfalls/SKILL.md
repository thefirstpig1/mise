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
