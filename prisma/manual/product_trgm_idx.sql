-- ============================================================
-- Mise — Product fuzzy-search trigram indexes (Sprint 1 Part 8.5, Q1/Q2 / L1)
-- ============================================================
-- Backs the restore-on-recreate fuzzy search (ADR 0010): a pg_trgm similarity
-- lookup over SOFT-DELETED products only, scored
--   GREATEST(similarity(name, $term), similarity(sku, $term))  (threshold 0.4).
--
--   - pg_trgm        -> trigram similarity + GIN operator class (gin_trgm_ops).
--                       Verified runnable on this Neon project before L1
--                       (no CREATE EXTENSION permission block).
--   - WHERE deleted_at IS NOT NULL -> PARTIAL indexes covering only the
--                       soft-deleted target set (the search scope). Smaller +
--                       faster than full-table trgm indexes; live products are
--                       never fuzzy-searched (they are caught by the
--                       product_tenant_id_sku_unique partial unique instead).
--
-- Why manual SQL: Prisma 5.22 cannot express CREATE EXTENSION, a GIN index,
-- gin_trgm_ops, nor a partial (WHERE) index in schema.prisma, so they live
-- here in prisma/manual/.
--
-- Idempotent: IF NOT EXISTS on the extension + both indexes — safe to re-run.
--
-- Apply to Neon via DIRECT_URL (unpooled):
--   pnpm exec prisma db execute --file prisma/manual/product_trgm_idx.sql --schema prisma/schema.prisma
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
ON product USING gin (name gin_trgm_ops)
WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_sku_trgm_idx
ON product USING gin (sku gin_trgm_ops)
WHERE deleted_at IS NOT NULL;
