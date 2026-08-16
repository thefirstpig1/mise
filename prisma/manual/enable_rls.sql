-- ============================================================
-- Mise — RLS Policies for Sprint 0 (Section H.10)
-- ============================================================
-- Run this AFTER `prisma migrate dev` creates the tables.
-- Command: docker exec -i mise-postgres psql -U mise -d mise_db < prisma/migrations/manual/enable_rls.sql
-- ============================================================

-- Enable RLS on all tenant-scoped tables (Sprint 0 set)
ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_branch_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE department ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_department_assignment ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLICIES — Direct tenant_id tables
-- ============================================================

CREATE POLICY tenant_isolation ON tenant
USING (id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON branch
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON tenant_membership
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON department
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- POLICIES — Child tables (no tenant_id, inherited from parent)
-- ============================================================

CREATE POLICY tenant_isolation ON user_branch_access
USING (
  EXISTS (
    SELECT 1 FROM tenant_membership tm
    WHERE tm.id = user_branch_access.tenant_membership_id
      AND tm.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  )
);

CREATE POLICY tenant_isolation ON user_department_assignment
USING (
  EXISTS (
    SELECT 1 FROM tenant_membership tm
    WHERE tm.id = user_department_assignment.tenant_membership_id
      AND tm.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  )
);

-- ============================================================
-- BYPASS ROLE (for migrations + admin tools)
-- ============================================================

-- Note: For Sprint 0 dev, the default postgres user has BYPASSRLS.
-- For production (Neon), create explicit bypass role:
-- CREATE ROLE mise_admin BYPASSRLS;
-- GRANT mise_admin TO mise;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- After running, verify with:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public';
-- (Should show rowsecurity=true for all tables above)

-- ============================================================
-- Sprint 1: Master Data RLS Policies
-- ============================================================

-- supplier (direct tenant_id)
ALTER TABLE supplier ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- category (direct tenant_id)
ALTER TABLE category ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON category
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- product (direct tenant_id)
ALTER TABLE product ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- supplier_product_mapping (direct tenant_id)
ALTER TABLE supplier_product_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON supplier_product_mapping
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- product_unit (NO direct tenant_id — inherits via product)
ALTER TABLE product_unit ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_unit
USING (
  EXISTS (
    SELECT 1 FROM product p
    WHERE p.id = product_unit.product_id
      AND p.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  )
);

-- NOTE: unit_template และ liquid_density_template ไม่ต้อง RLS
-- เพราะเป็น system reference tables ทุก tenant ต้องอ่านได้

-- ============================================================
-- End Sprint 1 RLS
-- ============================================================

-- ============================================================
-- Sprint 2 Part 10: Stock ledger RLS Policies (ADR 0011)
-- ============================================================
-- APPEND-ONLY FILE: ไฟล์นี้ไม่ idempotent (CREATE POLICY ไม่มี IF NOT EXISTS)
-- → apply "เฉพาะ section นี้" เท่านั้น อย่ารันทั้งไฟล์ซ้ำ (Sprint 1 pattern):
--   คัดลอก section นี้ไปไฟล์ชั่วคราว แล้ว
--   pnpm exec prisma db execute --file <tmp>.sql --schema prisma/schema.prisma
--
-- Policy ยัง inert จนถึง Sprint 7 (ADR 0004 — explicit tenantId filter ใน
-- withTenantContext คือ guard ที่ทำงานจริงตอนนี้); นี่คือ RLS-prep.
--
-- ทั้ง 2 ตารางมี tenant_id ตรง ๆ → ไม่ต้องใช้ EXISTS แบบ product_unit.
-- ============================================================

-- stock_movement (direct tenant_id)
ALTER TABLE stock_movement ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_movement
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- stock_adjustment (direct tenant_id)
ALTER TABLE stock_adjustment ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stock_adjustment
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 2 Part 10 RLS
-- ============================================================

-- ============================================================
-- Sprint 2 Part 11: Purchase Order RLS Policies (ADR 0012)
-- ============================================================
-- APPEND-ONLY FILE — apply THIS SECTION ONLY, never re-run the whole file
-- (CREATE POLICY has no IF NOT EXISTS). Same procedure as the Part 10 section.
--
-- All three tables carry tenant_id directly — including the two the spec models
-- as child tables (ADR 0012): app-layer isolation works by filtering tenantId
-- explicitly, and a column that isn't there cannot be filtered. So no EXISTS
-- indirection is needed here.
--
-- Still inert until Sprint 7 (ADR 0004) — this is RLS-prep.
-- ============================================================

-- purchase_order (direct tenant_id)
ALTER TABLE purchase_order ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- purchase_order_item (direct tenant_id)
ALTER TABLE purchase_order_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- purchase_order_item_allocation (direct tenant_id)
ALTER TABLE purchase_order_item_allocation ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON purchase_order_item_allocation
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 2 Part 11 RLS
-- ============================================================

-- ============================================================
-- Sprint 2 Part 13: Goods Receipt RLS Policies (ADR 0013)
-- ============================================================
-- APPEND-ONLY FILE — apply THIS SECTION ONLY, never re-run the whole file
-- (CREATE POLICY has no IF NOT EXISTS). Same procedure as Part 10 / 11.
--
-- All three tables carry tenant_id directly (ADR 0013, following ADR 0012):
-- app-layer isolation works by filtering tenantId explicitly, and a column that
-- isn't there cannot be filtered. No EXISTS indirection needed.
--
-- Still inert until Sprint 7 (ADR 0004) — this is RLS-prep.
-- ============================================================

-- goods_receipt (direct tenant_id)
ALTER TABLE goods_receipt ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON goods_receipt
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- goods_receipt_item (direct tenant_id)
ALTER TABLE goods_receipt_item ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON goods_receipt_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- goods_receipt_item_allocation (direct tenant_id)
ALTER TABLE goods_receipt_item_allocation ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON goods_receipt_item_allocation
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 2 Part 13 RLS
-- ============================================================
