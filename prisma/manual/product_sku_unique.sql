-- ============================================================
-- Mise — Product.sku partial unique index (Sprint 1 Part 8.5, Q5 / L1)
-- ============================================================
-- Partial unique index: product.sku must be unique PER TENANT,
-- but only for rows that are not soft-deleted.
--   - deleted_at IS NULL  -> soft-deleted rows are ignored, so a sku can be
--                            re-created / restored after a product is
--                            soft-deleted (closes Pitfall #23, the FULL-unique
--                            soft-delete trap — the #22/#23 ghost-row family).
-- product.sku is NOT NULL, so (unlike supplier_code_unique.sql) there is no
-- "code IS NOT NULL" clause — every product always has a sku.
--
-- NOTE: this index does not by itself fix Pitfall #25 (generateSku
-- concurrent-scan race) — it only catches the loser. The race itself was closed
-- in Part 13.5 by an advisory lock inside the generator
-- (src/server/counter-lock.ts, key `product_sku:{tenantId}`); this index remains
-- as the backstop and must not be dropped.
--
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma, so it lives here in prisma/manual/.
-- The Prisma schema (Product) has NO @@unique — see the ///-comments on the
-- sku field and the model footer pointing at this file.
--
-- ORDER: run the Part 8.5 migration FIRST (it DROPs the old full unique index
-- product_tenant_id_sku_key), THEN apply this file. The DROP below is a
-- self-contained idempotent safety net (the migration normally drops it first).
--
-- Apply to Neon via DIRECT_URL (unpooled):
--   pnpm exec prisma db execute --file prisma/manual/product_sku_unique.sql --schema prisma/schema.prisma
--
-- Logic layer catches Prisma P2002 (unique violation) -> Thai error
-- (ProductSkuConflictError, unchanged from Sprint 1 Part 7a).
-- ============================================================

DROP INDEX IF EXISTS product_tenant_id_sku_key;

CREATE UNIQUE INDEX IF NOT EXISTS product_tenant_id_sku_unique
ON product (tenant_id, sku)
WHERE deleted_at IS NULL;
