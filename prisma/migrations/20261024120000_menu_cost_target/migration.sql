-- ============================================================
-- Kong 2026-10-24 — "desired ingredient cost": each menu may carry its own
-- food-cost target (a bottle of beer bought to resell is not judged by the
-- kitchen's 35%). NULL = follow the shop's food_cost_target_pct, so a shop
-- that never sets one sees no change. Read by การผันผวนราคาวัตถุดิบ (rule
-- PV-ALLOW). menu already has RLS.
-- ============================================================

ALTER TABLE "menu" ADD COLUMN "food_cost_target_pct" DECIMAL(4,1);
