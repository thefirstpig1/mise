-- ============================================================
-- Mise — stock_cost_declaration: one LIVE declaration per movement
-- Sprint 2 Part 14 (ADR 0014 Q6)
-- ============================================================
-- A declaration series is append + supersede (ADR 0009's pattern): correcting a
-- cost opens a new row and closes the previous one by stamping superseded_at.
-- At most ONE row per movement may be open at a time — that open row IS the
-- current cost, and two of them would make "the current cost" ambiguous with no
-- rule to break the tie.
--
-- PARTIAL, not full: a full unique on movement_id would let the first superseded
-- row block every correction after it — the Pitfall #22/#23 family, the same trap
-- product_sku_unique and supplier_product_mapping_unique already avoid this way.
--
-- Why manual SQL: Prisma 5.22 cannot express a partial unique index (WHERE
-- clause) in schema.prisma. The model carries a ///-comment pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/stock_cost_declaration_live_unique.sql --schema prisma/schema.prisma
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS stock_cost_declaration_live_unique
  ON stock_cost_declaration (movement_id)
  WHERE superseded_at IS NULL;
