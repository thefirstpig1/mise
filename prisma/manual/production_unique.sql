-- ============================================================
-- Mise — production / trim recipe / shortfall partial uniques
-- ADR 0040
-- ============================================================
-- Why manual SQL: Prisma 5.22 cannot express a PARTIAL unique index (WHERE
-- clause) in schema.prisma. The models carry ///-comments pointing here.
-- Every statement is IF NOT EXISTS, so the release command may run it on every
-- deploy (ADR 0033 Q6).
-- ============================================================

-- ONE REVERSAL PER ITEM — the waste_log / staff_meal_item rule, for the same
-- reason: a double-submitted void would give the inputs back twice, and every
-- row in the ledger would look perfectly ordinary. Only the pair is wrong.
CREATE UNIQUE INDEX IF NOT EXISTS production_item_reversal_unique
  ON production_item (reversal_of_item_id)
  WHERE reversal_of_item_id IS NOT NULL;

-- ONE ORIGINAL LINE PER PRODUCT PER ROLE PER DOCUMENT. Lines are summed per
-- product before they are written, so two means the sum was applied twice.
-- PARTIAL on originals: a void repeats its original's product.
CREATE UNIQUE INDEX IF NOT EXISTS production_item_product_unique
  ON production_item (production_id, product_id, role)
  WHERE reversal_of_item_id IS NULL;

-- A PRODUCT IS A PART OF AT MOST ONE LIVE TRIM RECIPE (ADR 0040, extending
-- ADR 0021 Q1's "one way to make it"). The explosion walks from a part back to
-- the whole thing it was cut from (Q8); two parents would make that walk a
-- guess. `deleted_at` is written onto the parts with the recipe's, which is
-- what lets this index see a deleted recipe at all.
CREATE UNIQUE INDEX IF NOT EXISTS trim_recipe_part_product_unique
  ON trim_recipe_part (product_id)
  WHERE product_id IS NOT NULL AND deleted_at IS NULL;

-- ONE SHORTFALL ROW PER DOCUMENT PER PREPPED PRODUCT — summed before writing.
CREATE UNIQUE INDEX IF NOT EXISTS prepped_shortfall_run_product_unique
  ON prepped_shortfall (sales_consumption_run_id, product_id)
  WHERE sales_consumption_run_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS prepped_shortfall_staff_meal_product_unique
  ON prepped_shortfall (staff_meal_id, product_id)
  WHERE staff_meal_id IS NOT NULL;
