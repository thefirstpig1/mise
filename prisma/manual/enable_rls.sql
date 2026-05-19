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
