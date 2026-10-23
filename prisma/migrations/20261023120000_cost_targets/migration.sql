-- ============================================================
-- Kong 2026-10-23 — /cost redesign (question-first). Five numbers a shop sets
-- for itself; every one changes what /cost says, so all five are listed in
-- docs/settings-register.md. tenant already has RLS.
--   food_cost_target_pct       ต้นทุนอาหาร ไม่เกิน x % ของยอดขาย
--   prime_cost_target_pct      ต้นทุนอาหาร + ค่าแรง ไม่เกิน x %
--   count_variance_target_pct  นับได้ไม่ตรงกับระบบ ไม่เกิน x % ของยอดขาย
--   cost_coverage_min_pct      below this share of sales posted to stock, a
--                              cost % is not compared with a target or with
--                              the period before (rule CO-COV)
--   slow_stock_days            stock older than this many days is "ค้างนาน"
-- ============================================================

ALTER TABLE "tenant"
  ADD COLUMN "food_cost_target_pct"      DECIMAL(4,1) NOT NULL DEFAULT 35,
  ADD COLUMN "prime_cost_target_pct"     DECIMAL(4,1) NOT NULL DEFAULT 65,
  ADD COLUMN "count_variance_target_pct" DECIMAL(4,1) NOT NULL DEFAULT 2,
  ADD COLUMN "cost_coverage_min_pct"     INTEGER      NOT NULL DEFAULT 90,
  ADD COLUMN "slow_stock_days"           INTEGER      NOT NULL DEFAULT 45;
