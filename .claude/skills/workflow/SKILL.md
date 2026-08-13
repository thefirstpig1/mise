# Mise Workflow

How to do common tasks in this project.

## Starting a new sprint

1. Read docs/sprint-progress.md to confirm current state
2. Read relevant section of docs/master-spec.md
3. Read .claude/skills/mise-conventions/SKILL.md
4. Read .claude/skills/known-pitfalls/SKILL.md
5. Plan schema changes (if any) — list new tables
6. Plan UI changes — list new pages/components

## Adding new schema (per sprint)

### Step 1: Update prisma/schema.prisma
- Follow conventions (cuid for User, uuid for others, etc.)
- Add @map for snake_case DB names
- Add indexes for FKs and query patterns

### Step 2: Generate migration
```bash
npx prisma migrate dev
# Type migration name when prompted (e.g., "sprint_1_master_data")
```

### Step 3: Add RLS policies
Edit prisma/manual/enable_rls.sql, append new tables:
```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON new_table
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

### Step 4: Apply RLS to Neon
Copy enable_rls.sql contents → Neon SQL Editor → Run

### Step 5: Run seed (if new seed data)
```bash
npm run db:seed
```

### Step 6: Update Prisma Client
```bash
npx prisma generate
```
(Usually runs automatically with migrate)

## Adding new CRUD pages

### Naming convention
- /suppliers (list)
- /suppliers/new (create form)
- /suppliers/[id] (detail/edit)
- /suppliers/[id]/edit (edit form, optional separate page)

### Pattern
1. Page = Server Component, fetch data via prisma
2. Forms = Server Actions ("use server")
3. Use withTenantContext for all queries
4. Soft delete (set deletedAt), no hard delete

## Testing checklist (before committing)

- [ ] `npm run dev` starts without errors
- [ ] New pages render
- [ ] Forms submit successfully
- [ ] Data appears in Neon (check via Prisma Studio or Neon dashboard)
- [ ] No console errors in browser
- [ ] `npm run test` passes (especially tenant isolation)
- [ ] RLS applied for new tables (verify in Neon SQL editor)

## Git workflow

After verifying:
```bash
git add .
git commit -m "Sprint X: <feature description>"
git push origin main
```

Commit messages format:
- "Sprint 1: Add Supplier CRUD"
- "Sprint 1: Multi-unit support for Products"
- "Fix: Tenant isolation in Product list"
