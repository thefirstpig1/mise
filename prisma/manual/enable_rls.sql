-- ============================================================
-- Mise — RLS Policies for Sprint 0 (Section H.10)
-- ============================================================
-- Run this AFTER `prisma migrate deploy` creates the tables, and BEFORE
-- enforce_rls.sql — whose section 4 ALTERs every policy this file creates, and
-- which therefore fails on a policy that does not exist yet.
--
-- Applied automatically by `scripts/apply-manual-sql.mjs`, which Fly runs as
-- the release command on every deploy (ADR 0033 Q6/Q9).
--
-- RE-RUNNABLE SINCE PART 34, AND IT HAD TO BECOME SO. This file was written
-- append-only, because Postgres has no `CREATE POLICY IF NOT EXISTS` — each
-- section carried "apply this section only, never re-run the whole file".
-- That instruction survives below for the record; it is no longer true.
--
-- A release command that runs on EVERY deploy cannot have a file that fails
-- the second time: the deploy would be cancelled and the shop would stay on
-- the old version with no obvious reason. So every CREATE POLICY is now
-- preceded by `DROP POLICY IF EXISTS`.
--
-- WHY DROP + CREATE IS SAFE HERE, THOUGH enforce_rls.sql REFUSES IT. That file
-- deliberately uses ALTER POLICY, on the grounds that a dropped policy leaves a
-- table with none. The grounds are right and the conclusion does not carry to
-- this file: RLS is ENABLED on the line above each policy, and a table with RLS
-- enabled and no policy DENIES EVERY ROW to a non-owner role. The window is
-- fail-closed, it lasts one statement, and mise_app is not the owner.
--
-- The other half is ordering: this file runs before enforce_rls.sql on every
-- release, so the policies it recreates in their original "polite" form
-- (`current_setting(..., true)`) are tightened again moments later by
-- enforce_rls.sql section 4. Reversing the two would leave them polite —
-- returning zero rows instead of raising — which is the exact failure ADR 0030
-- went to the trouble of removing.
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

DROP POLICY IF EXISTS tenant_isolation ON tenant;
CREATE POLICY tenant_isolation ON tenant
USING (id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON branch;
CREATE POLICY tenant_isolation ON branch
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON tenant_membership;
CREATE POLICY tenant_isolation ON tenant_membership
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation ON department;
CREATE POLICY tenant_isolation ON department
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- POLICIES — Child tables (no tenant_id, inherited from parent)
-- ============================================================

DROP POLICY IF EXISTS tenant_isolation ON user_branch_access;
CREATE POLICY tenant_isolation ON user_branch_access
USING (
  EXISTS (
    SELECT 1 FROM tenant_membership tm
    WHERE tm.id = user_branch_access.tenant_membership_id
      AND tm.tenant_id = current_setting('app.current_tenant_id', true)::uuid
  )
);

DROP POLICY IF EXISTS tenant_isolation ON user_department_assignment;
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
DROP POLICY IF EXISTS tenant_isolation ON supplier;
CREATE POLICY tenant_isolation ON supplier
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- category (direct tenant_id)
ALTER TABLE category ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON category;
CREATE POLICY tenant_isolation ON category
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- product (direct tenant_id)
ALTER TABLE product ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product;
CREATE POLICY tenant_isolation ON product
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- supplier_product_mapping (direct tenant_id)
ALTER TABLE supplier_product_mapping ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_product_mapping;
CREATE POLICY tenant_isolation ON supplier_product_mapping
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- product_unit (NO direct tenant_id — inherits via product)
ALTER TABLE product_unit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_unit;
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
DROP POLICY IF EXISTS tenant_isolation ON stock_movement;
CREATE POLICY tenant_isolation ON stock_movement
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- stock_adjustment (direct tenant_id)
ALTER TABLE stock_adjustment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_adjustment;
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
DROP POLICY IF EXISTS tenant_isolation ON purchase_order;
CREATE POLICY tenant_isolation ON purchase_order
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- purchase_order_item (direct tenant_id)
ALTER TABLE purchase_order_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_order_item;
CREATE POLICY tenant_isolation ON purchase_order_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- purchase_order_item_allocation (direct tenant_id)
ALTER TABLE purchase_order_item_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_order_item_allocation;
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
DROP POLICY IF EXISTS tenant_isolation ON goods_receipt;
CREATE POLICY tenant_isolation ON goods_receipt
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- goods_receipt_item (direct tenant_id)
ALTER TABLE goods_receipt_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON goods_receipt_item;
CREATE POLICY tenant_isolation ON goods_receipt_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- goods_receipt_item_allocation (direct tenant_id)
ALTER TABLE goods_receipt_item_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON goods_receipt_item_allocation;
CREATE POLICY tenant_isolation ON goods_receipt_item_allocation
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 2 Part 13 RLS
-- ============================================================

-- ============================================================
-- Sprint 2 Part 14 — Cost (ADR 0014)
-- ============================================================
-- Only one new table: stock_cost_declaration. Product cost itself is computed by
-- replaying stock_movement and is stored nowhere (ADR 0014 Q2/Q4), so there is
-- no cost table to isolate — the ledger's own policy already covers the inputs.
--
-- Still inert until Sprint 7 (ADR 0004) — this is RLS-prep.
-- ============================================================

-- stock_cost_declaration (direct tenant_id)
ALTER TABLE stock_cost_declaration ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_cost_declaration;
CREATE POLICY tenant_isolation ON stock_cost_declaration
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 2 Part 14 RLS
-- ============================================================

-- ============================================================
-- Sprint 3 Part 15 — Stock Count (ADR 0015)
-- ============================================================
-- Three tables, each carrying tenant_id directly (ADR 0004/0013 pattern):
-- app-layer isolation filters tenantId explicitly, and a column that is not
-- there cannot be filtered.
--
-- Still inert until Sprint 7 (ADR 0004) — this is RLS-prep.
-- ============================================================

ALTER TABLE stock_count ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_count;
CREATE POLICY tenant_isolation ON stock_count
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE stock_count_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_count_item;
CREATE POLICY tenant_isolation ON stock_count_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE stock_count_entry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_count_entry;
CREATE POLICY tenant_isolation ON stock_count_entry
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 3 Part 15 RLS
-- ============================================================

-- ============================================================
-- Sprint 3 Part 16 — Expense (ADR 0016)
-- ============================================================
-- Three tables, each carrying tenant_id directly (ADR 0004 pattern).
-- Still inert until Sprint 7 — this is RLS-prep.
-- ============================================================

ALTER TABLE expense ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expense;
CREATE POLICY tenant_isolation ON expense
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE expense_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expense_item;
CREATE POLICY tenant_isolation ON expense_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE recurring_expense ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recurring_expense;
CREATE POLICY tenant_isolation ON recurring_expense
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 3 Part 16 RLS
-- ============================================================

-- ============================================================
-- Sprint 3 Part 17 — Waste + par level (ADR 0017)
-- ============================================================
-- Two tables, each carrying tenant_id directly (ADR 0004 pattern).
-- Still inert until Sprint 7 — this is RLS-prep.
-- ============================================================

ALTER TABLE waste_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON waste_log;
CREATE POLICY tenant_isolation ON waste_log
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE par_level ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON par_level;
CREATE POLICY tenant_isolation ON par_level
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 3 Part 17 RLS
-- ============================================================

-- ============================================================
-- Sprint 3 Part 18 — Inter-branch transfer (ADR 0018)
-- ============================================================
-- Two tables, each carrying tenant_id directly (ADR 0004 pattern).
-- Still inert until Sprint 7 — this is RLS-prep.
--
-- Worth noting for Sprint 7: this is the first document whose two halves belong
-- to two different BRANCHES, so tenant isolation alone will not be the whole
-- story here. A per-branch rule has to let the receiving branch see a document
-- the sending branch created — the "รอรับ" box (Q8) depends on exactly that.
-- ============================================================

ALTER TABLE stock_transfer ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_transfer;
CREATE POLICY tenant_isolation ON stock_transfer
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE stock_transfer_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_transfer_item;
CREATE POLICY tenant_isolation ON stock_transfer_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 3 Part 18 RLS
-- ============================================================

-- ============================================================
-- Sprint 4 Part 19 — POS sales import (ADR 0019)
-- ============================================================
-- Eight tables, each carrying tenant_id directly (ADR 0004 pattern).
-- Still inert until Sprint 7 — this is RLS-prep.
--
-- Worth noting for Sprint 7: sales_line is the first table whose rows are
-- written by an IMPORT rather than by a person filling a form, so the Sprint 7
-- rule has to answer a question no earlier Part raised — who may replace a day
-- of somebody else's branch's sales. The import batch names its uploader, and
-- sales_day names the batch that currently owns each day, so the audit trail
-- for that decision already exists; only the policy is missing.
-- ============================================================

ALTER TABLE pos_integration ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pos_integration;
CREATE POLICY tenant_isolation ON pos_integration
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE sales_import_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_import_profile;
CREATE POLICY tenant_isolation ON sales_import_profile
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE sales_import_batch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_import_batch;
CREATE POLICY tenant_isolation ON sales_import_batch
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE sales_day ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_day;
CREATE POLICY tenant_isolation ON sales_day
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE menu_category ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu_category;
CREATE POLICY tenant_isolation ON menu_category
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE menu ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu;
CREATE POLICY tenant_isolation ON menu
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE menu_alias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu_alias;
CREATE POLICY tenant_isolation ON menu_alias
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE sales_line ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_line;
CREATE POLICY tenant_isolation ON sales_line
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 4 Part 19 RLS
-- ============================================================

-- ============================================================
-- Sprint 5 Part 21 RLS (ADR 0021)
-- ============================================================

ALTER TABLE recipe ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recipe;
CREATE POLICY tenant_isolation ON recipe
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE recipe_ingredient ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recipe_ingredient;
CREATE POLICY tenant_isolation ON recipe_ingredient
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE recipe_branch ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recipe_branch;
CREATE POLICY tenant_isolation ON recipe_branch
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 5 Part 21 RLS
-- ============================================================

-- ============================================================
-- Sprint 5 Part 22 RLS (ADR 0022)
-- ============================================================

ALTER TABLE sales_consumption_run ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_consumption_run;
CREATE POLICY tenant_isolation ON sales_consumption_run
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE sales_consumption_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales_consumption_item;
CREATE POLICY tenant_isolation ON sales_consumption_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 5 Part 22 RLS
-- ============================================================

-- ============================================================
-- Sprint 5 Part 25 RLS (ADR 0026)
-- ============================================================

ALTER TABLE menu_merge ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON menu_merge;
CREATE POLICY tenant_isolation ON menu_merge
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 5 Part 25 RLS
-- ============================================================

-- ============================================================
-- Sprint 5 Part 26 RLS (ADR 0028)
-- ============================================================

ALTER TABLE staff_member ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_member;
CREATE POLICY tenant_isolation ON staff_member
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE staff_meal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_meal;
CREATE POLICY tenant_isolation ON staff_meal
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

ALTER TABLE staff_meal_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON staff_meal_item;
CREATE POLICY tenant_isolation ON staff_meal_item
USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- ============================================================
-- End Sprint 5 Part 26 RLS
-- ============================================================
