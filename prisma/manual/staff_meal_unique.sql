-- ============================================================
-- Mise — staff_meal_item partial unique
-- Sprint 5 Part 26 (ADR 0028)
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The model carries a ///-comment pointing here.
--
-- Apply with DIRECT_URL (not the pooled endpoint — Pitfall #18):
--   pnpm prisma db execute --file prisma/manual/staff_meal_unique.sql --schema prisma/schema.prisma
-- ============================================================

-- ONE REVERSAL PER ITEM (ADR 0028 Q8).
-- The waste_log_reversal_unique / sales_consumption_item_reversal_unique rule,
-- applied to the same shape for the same reason: without it a double-submitted
-- void credits the stock back twice, and the branch ends the day with more pork
-- than it started with — with every row in the ledger looking perfectly
-- ordinary, because each one IS ordinary. Only the pair is wrong.
--
-- PARTIAL because reversal_of_item_id is NULL on every original, and NULLs are
-- distinct in Postgres anyway — the WHERE clause says so out loud and keeps the
-- index small.
CREATE UNIQUE INDEX IF NOT EXISTS staff_meal_item_reversal_unique
  ON staff_meal_item (reversal_of_item_id)
  WHERE reversal_of_item_id IS NOT NULL;

-- ONE ITEM PER PRODUCT PER MEAL (ADR 0028 Q8).
-- A meal's explosion is summed per product before it is written, so two
-- original rows for the same product means the sum was applied twice — the
-- shape sales_consumption_item_product_unique guards, at the grain this table
-- actually uses.
--
-- Note this is NOT the day-level guard that sales_consumption_run has. There is
-- deliberately no "one live staff meal per branch per day": ten people eating
-- ten dishes on one day is the normal case, not a duplicate, and the whole
-- reason this table is not aggregated is to keep those ten apart.
--
-- PARTIAL on the originals only: a void appends its reversal items into the
-- SAME document, and a reversal legitimately repeats its original's product.
CREATE UNIQUE INDEX IF NOT EXISTS staff_meal_item_product_unique
  ON staff_meal_item (staff_meal_id, product_id)
  WHERE reversal_of_item_id IS NULL;
