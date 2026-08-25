-- ============================================================
-- Part 24 — the draft recipe, and the price you may type  (ADR 0025)
-- ============================================================
-- Two columns on `recipe`. No new table and no relaxed constraint:
-- `recipe_target_check` still requires every recipe to point at a menu or a
-- product, and a draft for a dish that does not exist yet gets a `menu` row of
-- its own with source = 'MISE' (ADR 0025 Q3).
--
-- WHY A FLAG AND NOT A `recipe_draft` TABLE (Q4): `recipe-cost.ts` holds the
-- only recursive, yield-correct cost walk in the system. A draft with a shape of
-- its own would need a second one, and two cost engines drift — the day the
-- figure in Menu Lab stops matching the figure on the recipe page, nothing
-- reports it. A flag keeps one engine and moves the risk to two filters that a
-- test can pin.
--
-- WHERE THE FLAG IS ENFORCED: `recipe-resolve.ts`, the single route by which a
-- recipe reaches `stock_movement`, and `recipe-guards.ts`, or drafting a change
-- to a live dish collides with that dish's own published recipe under
-- RecipeAlreadyExistsError. Both are covered by tests; a read elsewhere that
-- forgets shows a draft in a list, which is visible and harmless.
-- ============================================================

ALTER TABLE "recipe"
  ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false;

-- ราคาที่ตั้งใจ — the price being considered while designing, NEVER ราคา.
--
-- ADR 0021 Q10 refused `menu.sale_price` because a typed price goes stale the
-- day the POS price changes, and that argument bites hardest on Menu Lab's own
-- success: if the lab works, the dish gets sold. On a draft the number means
-- something that cannot go stale — a fact about a design session rather than a
-- claim about today — so it never competes with the price read from sales.
--
-- Nullable, and kept after publishing: "planned ฿89, selling at ฿85" is worth
-- knowing. Once the dish has sales, the SOLD price is the price (ADR 0025 Q2).
ALTER TABLE "recipe"
  ADD COLUMN "planned_price" DECIMAL(15,2);

-- A price is a price. The scale allows satang; nothing here is negative, and a
-- free dish is a real thing to model, so zero is allowed and negative is not.
ALTER TABLE "recipe"
  ADD CONSTRAINT "recipe_planned_price_check"
  CHECK ("planned_price" IS NULL OR "planned_price" >= 0);

-- Menu Lab lists a shop's own drafts, which are a small minority of the table.
-- Partial, so it costs nothing for the published rows every other read wants.
CREATE INDEX "recipe_draft_idx" ON "recipe"("tenant_id") WHERE "is_draft";
