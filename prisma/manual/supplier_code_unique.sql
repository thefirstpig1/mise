-- ============================================================
-- Mise — Supplier.code partial unique index (Sprint 1 Part 5, Q5a)
-- ============================================================
-- Partial unique index: supplier.code must be unique PER TENANT,
-- but only for rows that are (a) not soft-deleted AND (b) have a code.
--   - deleted_at IS NULL  -> soft-deleted rows are ignored (code can be
--                            "reused" after a supplier is soft-deleted)
--   - code IS NOT NULL     -> NULL code = "no code", many suppliers may
--                            have no code without colliding
--
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index
-- (WHERE clause) in schema.prisma, so it lives here in prisma/manual/.
-- The Prisma schema (Supplier.code) has NO @@unique — see comment there.
--
-- Apply to Neon via DIRECT_URL (unpooled):
--   pnpm exec prisma db execute --file prisma/manual/supplier_code_unique.sql --schema prisma/schema.prisma
--
-- Logic layer catches Prisma P2002 (unique violation) -> Thai error.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS supplier_tenant_code_unique
ON supplier (tenant_id, code)
WHERE deleted_at IS NULL AND code IS NOT NULL;
