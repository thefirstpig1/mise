# Mise Code Conventions

Read this skill before writing ANY new code in this project.

## Database conventions

### Model naming
- User model: MUST be named `User` (Auth.js requirement)
- All other models: PascalCase, English, descriptive
- Table names in DB: snake_case via `@@map("table_name")`

### ID types
- User.id: cuid String (Auth.js compatibility)
- All other tables: uuid String @db.Uuid @default(uuid())
- FK to User: String (NO @db.Uuid)
- FK to other tables: String @db.Uuid

### Field conventions
- Timestamps: createdAt, updatedAt, deletedAt (DateTime)
- Soft delete: deletedAt nullable
- Tenant scope: tenantId String @db.Uuid + index
- Branch scope: branchId String @db.Uuid + index (NOT NULL on operational tables)
- Money: Decimal(15, 4)
- Quantity: Decimal(15, 6)
- Percentage: Decimal(5, 2)

### Relations
- One-to-many: Define both sides with @relation
- Many-to-many: Use junction table with explicit fields
- Cascade: Avoid onDelete: Cascade — use soft delete instead

### RLS pattern (MANDATORY for tenant-scoped tables)
After migration, add to prisma/manual/enable_rls.sql:

```sql
ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON table_name
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

For child tables without direct tenant_id, JOIN to parent:

```sql
ALTER TABLE child_table ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON child_table
USING (EXISTS (
  SELECT 1 FROM parent_table p
  WHERE p.id = child_table.parent_id
    AND p.tenant_id = current_setting('app.current_tenant_id', true)::uuid
));
```

## Frontend conventions

### UI text
- ภาษาไทย is preferred for user-facing strings
- Keep button labels short (เพิ่ม, แก้ไข, ลบ, บันทึก)
- Use formal tone (คุณ, กรุณา) not casual

### Component patterns
- Server Components by default (no "use client")
- Use Client Components only when needed (forms, interactivity)
- Forms: use Server Actions, not API routes

### Style
- Tailwind utility classes only
- No inline styles
- Spacing: use Tailwind scale (p-2, p-4, p-6, p-8)
- Colors: use defined palette in tailwind.config.ts

## Numeric handling

### Money
- Always Decimal(15, 4)
- Display with 2 decimals: ฿123.45
- Storage in THB (no multi-currency in MVP — Open Question O20)

### Quantity
- Always Decimal(15, 6)
- Display with smart decimals (1.5kg not 1.500000kg)

### Yield math (CRITICAL — Decision #59)
- ✅ raw_qty = recipe_qty × (100 / yield_percent)
- ❌ raw_qty = recipe_qty × (1 + loss_percent)
- NEVER confuse yield (output/input ratio) with loss (waste percent)

## Date/time

### Timezone (Decision #60)
- All DATE_TRUNC on user dates: use tenant timezone
- `DATE_TRUNC('month', col AT TIME ZONE (SELECT timezone FROM tenant WHERE id = X))`
- Stored as timestamptz (UTC internally)
- Display in user's timezone (Asia/Bangkok default)
