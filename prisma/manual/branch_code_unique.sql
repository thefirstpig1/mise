-- ============================================================
-- Mise — branch.code PARTIAL unique (Sprint 2 Part 11 L1, ADR 0012 Q8b)
-- ============================================================
-- Why manual: Prisma 5.22 can only express a FULL @@unique. A FULL unique here
-- would let a SOFT-DELETED branch reserve its code forever — Pitfall #22/#23,
-- the same trap already closed this way for supplier.code, product.sku and
-- supplier_product_mapping. Precedent: prisma/manual/supplier_code_unique.sql.
--
-- Scope: per tenant, live rows only. `code` itself became NOT NULL in the
-- Part 11 migration (it prefixes every po_number of the branch).
--
-- Pre-flight (run BEFORE applying; both must return 0 rows):
--   SELECT tenant_id, code FROM branch WHERE deleted_at IS NULL
--     GROUP BY tenant_id, code HAVING COUNT(*) > 1;
--   SELECT id FROM branch WHERE code IS NULL;
-- Verified PASS on 2026-08-16 (2 branch rows, no NULLs, no duplicates).
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/branch_code_unique.sql --schema prisma/schema.prisma
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS branch_code_unique
  ON branch (tenant_id, code)
  WHERE deleted_at IS NULL;
