-- ============================================================
-- Mise — SupplierProductMapping composite partial unique index (Sprint 1 Part 8, Q1/Q7/Q10)
-- ============================================================
-- Partial unique index: one price row per
--   (tenant_id, supplier_id, product_id, branch_id, effective_from)
-- but only among rows that are not soft-deleted, with NULL branch_id
-- (the tenant-default scope) treated as a single value:
--   - deleted_at IS NULL  -> soft-deleted rows are ignored, so a key can be
--                            re-created after a mapping (or its parent supplier/
--                            product) is soft-deleted (Pitfall #22/#23 family).
--   - NULLS NOT DISTINCT  -> branch_id NULL = "tenant default"; without this,
--                            Postgres treats each NULL as distinct and would let
--                            TWO tenant-default rows collide-free. With it, only
--                            ONE live tenant-default exists per
--                            (tenant, supplier, product, effective_from).
-- effective_from is NOT NULL (Part 8 L1 migration), so it never widens the key.
--
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE) nor
-- NULLS NOT DISTINCT in schema.prisma, so it lives here in prisma/manual/.
-- The Prisma schema (SupplierProductMapping) has NO @@unique — see the
-- ///-comment there pointing at this file.
--
-- ORDER: run the Part 8 migration FIRST (it DROPs the old full unique index
-- supplier_product_mapping_tenant_id_supplier_id_product_id_b_key and makes
-- effective_from NOT NULL + DATE), THEN apply this file.
--
-- Apply to Neon via DIRECT_URL (unpooled):
--   pnpm exec prisma db execute --file prisma/manual/supplier_product_mapping_unique.sql --schema prisma/schema.prisma
--
-- Logic layer catches Prisma P2002 (unique violation) -> Thai error.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS supplier_product_mapping_unique
ON supplier_product_mapping (tenant_id, supplier_id, product_id, branch_id, effective_from)
NULLS NOT DISTINCT
WHERE deleted_at IS NULL;
